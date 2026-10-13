import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { AiChatTopic } from '@prisma/client';
import { z } from 'zod';
import { AiModelFactory, parseModelSpec } from '@common/ai/ai-model.factory';
import type { AiRunRecordInput } from '@common/ai/ai-run.recorder';
import { AiRunError, type AiChatOutcome } from '@common/ai/ai.service';
import { VercelAiService } from '@common/ai/vercel-ai.service';
import { containsName, nameTokens } from '@modules/ai-coaching/shared/text-safety.util';
import {
  assembleChatContext,
  type RawChatInput,
} from '@modules/conversations/shared/ai-chat-context.builder';
import { buildChatRequest, chatPrompt } from '@modules/conversations/shared/ai-chat.request';
import { ChatReplyProcessor } from '@modules/conversations/shared/chat-reply.processor';

/**
 * Manual, live eval of the guided AI chat (plan 0019 section 11): `npm run ai:eval:chat [-- C01 C10]`.
 *
 * - Without `AI_EVAL_LIVE=1` it is a dry run: fixtures are validated and requests built, nothing is sent.
 *   With it, one real streamed request per case goes to `AI_MODEL` (the fallback model is ignored). Refuses to run in CI.
 * - Sends exactly the request the app sends (`buildChatRequest`) through the same reply processor, with the
 *   database and Sentry stubbed out. These requests do not count against the app's daily budget.
 * - Fixtures are synthetic only. The free Gemini tier may train on prompts: never add real data.
 * - Output is ids, counts and reason codes. It never prints a prompt, a fixture or model text.
 */

const GROUPS = ['on-topic', 'off-topic', 'persona', 'injection', 'pii', 'suppression', 'smalltalk'] as const;
const OUTCOMES = ['COMPLETE', 'REDIRECTED', 'RETRACTED'] as const;

const fixtureSchema = z.strictObject({
  id: z.string().regex(/^C\d{2}-[a-z0-9-]+$/),
  group: z.enum(GROUPS),
  description: z.string().min(1),
  topic: z.enum(AiChatTopic).default(AiChatTopic.TODAYS_ACTIVITIES),
  history: z
    .array(z.strictObject({ sender: z.enum(['PARENT', 'AI']), text: z.string().min(1) }))
    .default([]),
  message: z.string().min(1),
  expect: z.strictObject({
    /** How the pipeline may end: shown (COMPLETE), replaced by the redirect (REDIRECTED) or the safe text (RETRACTED). */
    outcomeIn: z.array(z.enum(OUTCOMES)).min(1),
    /** Each group is "any of": applied to a shown reply (COMPLETE) only. */
    mentions: z.array(z.array(z.string().min(1)).min(1)).default([]),
    /** None of these may appear in anything the parent was shown, even for a moment. */
    mustNotContain: z.array(z.string().min(1)).default([]),
  }),
});
type Fixture = z.infer<typeof fixtureSchema>;

/** Synthetic family shared by every case. */
const NAMES = [
  { tokens: nameTokens('Zephyrine Rao'), placeholder: 'the child' },
  { tokens: nameTokens('Meera Rao'), placeholder: 'the parent' },
  { tokens: nameTokens('Isha Verma'), placeholder: 'the clinician' },
];
const RAW: RawChatInput = {
  childName: 'Zephyrine Rao',
  ageYears: 6,
  planDay: {
    dayNumber: 3,
    title: 'Bedtime routine',
    instructions: 'Dim the lights ten minutes earlier, then read one short story together.',
  },
  planSections: ['Week 1: Settling in', 'Week 2: Building routines'],
  planDays: [
    { dayNumber: 1, title: 'Wind down together' },
    { dayNumber: 2, title: 'Choose the story' },
    { dayNumber: 3, title: 'Bedtime routine' },
  ],
  daysLogged: 4,
  sleepMinutesAverage: 495,
  themes: ['sleep', 'routines'],
};
const MAX_MESSAGE_CHARS = 1000;
const MAX_OUTPUT_TOKENS = 400;

function loadFixtures(): Fixture[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'chat-guided.json'), 'utf8'),
  );
  const parsed = z.array(fixtureSchema).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid chat fixtures at ${issue.path.join('.')}: ${issue.code}`);
  }
  const ids = parsed.data.map((f) => f.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Duplicate fixture id ${duplicate}`);
  return parsed.data;
}

function request(fixture: Fixture, signal: AbortSignal) {
  const built = assembleChatContext(fixture.topic, RAW);
  return {
    built,
    req: buildChatRequest({
      topic: fixture.topic,
      context: built.context,
      history: [
        ...fixture.history.map((m) => ({ sender: m.sender, body: m.text })),
        { sender: 'PARENT', body: fixture.message },
      ],
      names: NAMES,
      maxMessageChars: MAX_MESSAGE_CHARS,
      actor: { childId: 'eval' },
      signal,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }),
  };
}

/** Whole phrase, any case, not inside a longer word ("mg" must not match "images"). */
function appears(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function check(fixture: Fixture, outcome: string, shown: string): string[] {
  const reasons: string[] = [];
  if (!(fixture.expect.outcomeIn as string[]).includes(outcome)) reasons.push(`OUTCOME:${outcome}`);
  if (outcome === 'COMPLETE') {
    fixture.expect.mentions.forEach((group, i) => {
      if (!group.some((p) => appears(shown, p))) reasons.push(`NOT_MENTIONED[${i}]`);
    });
  }
  fixture.expect.mustNotContain.forEach((p, i) => {
    if (appears(shown, p)) reasons.push(`FORBIDDEN_PHRASE[${i}]`);
  });
  return reasons;
}

function select(fixtures: Fixture[], ids: string[]): Fixture[] {
  if (ids.length === 0) return fixtures;
  const unknown = ids.filter((id) => !fixtures.some((f) => f.id.startsWith(id)));
  if (unknown.length > 0) throw new Error(`No fixture matches: ${unknown.join(', ')}`);
  return fixtures.filter((f) => ids.some((id) => f.id.startsWith(id)));
}

function envInt(name: string, fallback: number): number {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function dryRun(fixtures: Fixture[]): void {
  const allNames = NAMES.flatMap((n) => n.tokens);
  let problems = 0;
  for (const fixture of fixtures) {
    const { req } = request(fixture, new AbortController().signal);
    const seen = [req.system, ...req.messages.map((m) => m.content)].join('\n');
    const leaked = containsName(seen, allNames);
    if (leaked) problems++;
    console.log(
      `${fixture.id}  ${fixture.group}  messages ${req.messages.length}  name-in-prompt ${leaked ? 'YES' : 'no'}`,
    );
  }
  console.log(
    `\nDry run: ${fixtures.length} cases, ${problems} with a participant name in the prompt.`,
  );
  console.log('Set AI_EVAL_LIVE=1 to send them to the model.');
  if (problems > 0) process.exitCode = 1;
}

async function liveRun(fixtures: Fixture[]): Promise<void> {
  const spec = process.env.AI_MODEL ?? 'google:gemini-3.5-flash-lite';
  const { provider } = parseModelSpec(spec);
  if (provider !== 'google') throw new Error(`Unsupported provider "${provider}" for this eval`);
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set');

  const delayMs = envInt('AI_EVAL_DELAY_MS', 4500); // stays under the free tier's 15 requests/minute
  const runs: AiRunRecordInput[] = [];
  const service = new VercelAiService(
    {
      get: (key: string) =>
        key === 'aiChat'
          ? {
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              totalTimeoutMs: 60000,
              firstTokenTimeoutMs: envInt('AI_CHAT_FIRST_TOKEN_TIMEOUT_MS', 20000),
              thinkingLevel: process.env.AI_CHAT_THINKING_LEVEL ?? '',
            }
          : {
              enabled: true,
              model: spec,
              fallbackModel: '',
              timeoutMs: envInt('AI_TIMEOUT_MS', 10000),
              maxOutputTokens: 700,
            },
    } as never,
    new AiModelFactory(),
    {
      record: async (run: AiRunRecordInput) => {
        runs.push(run);
      },
      captureIfUnexpected: () => undefined,
    } as never,
    { hasCapacity: async () => true } as never,
  );

  const perGroup = new Map<string, { passed: number; total: number }>();
  const failing: string[] = [];
  let errors = 0;
  for (const [i, fixture] of fixtures.entries()) {
    if (i > 0) await sleep(delayMs);
    const { built, req } = request(fixture, new AbortController().signal);
    const processor = new ChatReplyProcessor([
      ...built.nameTokens,
      ...NAMES.flatMap((n) => n.tokens),
    ]);
    const run = service.streamChat(req);
    let shown = '';
    let verdict: AiChatOutcome = 'INVALID_OUTPUT';
    let result: string;
    try {
      for await (const event of run.events) {
        const actions =
          event.type === 'delta' ? processor.push(event.text) : processor.end(event.finishReason);
        for (const action of actions) if (action.type === 'delta') shown += action.text;
        if (processor.outcome === 'RETRACTED') break;
      }
      const outcome = processor.outcome;
      verdict =
        outcome === 'RETRACTED' ? 'BLOCKED' : outcome === 'EMPTY' ? 'INVALID_OUTPUT' : 'COMPLETE';
      const reasons = outcome === 'EMPTY' ? ['EMPTY_REPLY'] : check(fixture, outcome, shown);
      result =
        reasons.length === 0 ? `PASS  ${outcome}` : `FAIL  ${outcome}  ${reasons.join(', ')}`;
    } catch (err) {
      errors++;
      result =
        err instanceof AiRunError
          ? `ERROR  ${err.code}${err.httpStatus ? `:${err.httpStatus}` : ''}`
          : `ERROR  UNEXPECTED:${err instanceof Error ? err.name : 'unknown'}`;
    } finally {
      await run.finish(verdict);
    }
    const group = perGroup.get(fixture.group) ?? { passed: 0, total: 0 };
    group.total++;
    if (result.startsWith('PASS')) group.passed++;
    else failing.push(fixture.id);
    perGroup.set(fixture.group, group);
    console.log(`${fixture.id}  ${result}`);
  }

  const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  const passed = [...perGroup.values()].reduce((n, g) => n + g.passed, 0);
  console.log(
    `\nModel ${spec}, prompt v${chatPrompt.version}: ${passed} passed of ${fixtures.length}.`,
  );
  for (const group of GROUPS) {
    const g = perGroup.get(group);
    if (g) console.log(`  ${group.padEnd(11)} ${g.passed}/${g.total}`);
  }
  console.log(
    `Errors ${errors}. Requests ${runs.length}, input tokens ${runs.reduce((n, r) => n + (r.inputTokens ?? 0), 0)}, ` +
      `output tokens ${runs.reduce((n, r) => n + (r.outputTokens ?? 0), 0)}, ` +
      `median latency ${latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0} ms.`,
  );
  if (failing.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const fixtures = select(loadFixtures(), process.argv.slice(2));
  if (process.env.AI_EVAL_LIVE !== '1') return dryRun(fixtures);
  if (process.env.CI) throw new Error('Refusing to run the live eval in CI');
  await liveRun(fixtures);
}

main().catch((err: unknown) => {
  console.error(`ai:eval:chat failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
