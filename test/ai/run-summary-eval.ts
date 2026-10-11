import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { AiModelFactory, parseModelSpec } from '@common/ai/ai-model.factory';
import type { AiRunRecordInput } from '@common/ai/ai-run.recorder';
import { AiRunError } from '@common/ai/ai.service';
import { VercelAiService } from '@common/ai/vercel-ai.service';
import { nameTokens } from '@modules/ai-coaching/shared/text-safety.util';
import { conversationSummaryPromptV1 } from '@modules/conversations/prompts/conversation-summary.v1';
import type { ConversationSummaryOutput } from '@modules/conversations/shared/conversation-summary.content';
import {
  buildSummaryRequest,
  SUMMARY_MAX_OUTPUT_TOKENS,
} from '@modules/conversations/shared/conversation-summary.request';
import { containsName } from '@modules/ai-coaching/shared/text-safety.util';

/**
 * Manual, live eval of the conversation-summary pipeline (plan 0019 §11): `npm run ai:eval:summary [-- S01 S05]`.
 *
 * - Without `AI_EVAL_LIVE=1` it is a dry run: fixtures are validated and requests built, nothing is sent.
 *   With it, one real request per case goes to `AI_MODEL` (the fallback model is ignored). Refuses to run in CI.
 * - Sends exactly the request the summary job sends (`buildSummaryRequest`), with the database and Sentry
 *   stubbed out. These requests do not count against the app's daily budget; account for them yourself.
 * - Fixtures are synthetic only. The free Gemini tier may train on prompts: never add real data.
 * - Output is ids, counts and reason codes. It never prints a prompt, a fixture or model text.
 */

const fixtureSchema = z.strictObject({
  id: z.string().regex(/^S\d{2}-[a-z0-9-]+$/),
  description: z.string().min(1),
  kind: z.enum(['AI', 'HUMAN']),
  names: z.strictObject({
    child: z.string(),
    parent: z.string(),
    expert: z.string().optional(),
    clinician: z.string().optional(),
  }),
  messages: z
    .array(z.strictObject({ sender: z.enum(['PARENT', 'EXPERT', 'AI']), text: z.string().min(1) }))
    .min(1),
  expect: z.strictObject({
    /** Each group is "any of": at least one phrase per group must appear in the summary. */
    mentions: z.array(z.array(z.string().min(1)).min(1)).default([]),
    /** None of these may appear. */
    mustNotContain: z.array(z.string().min(1)).default([]),
  }),
});
type Fixture = z.infer<typeof fixtureSchema>;

function loadFixtures(): Fixture[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'summary-chats.json'), 'utf8'),
  );
  const parsed = z.array(fixtureSchema).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid summary fixtures at ${issue.path.join('.')}: ${issue.code}`);
  }
  return parsed.data;
}

function request(fixture: Fixture, maxOutputTokens: number) {
  const { names } = fixture;
  return buildSummaryRequest({
    kind: fixture.kind,
    childId: 'eval',
    names: [
      { tokens: nameTokens(names.child), placeholder: 'the child' },
      { tokens: nameTokens(names.parent), placeholder: 'the parent' },
      ...(names.expert ? [{ tokens: nameTokens(names.expert), placeholder: 'the expert' }] : []),
      ...(names.clinician
        ? [{ tokens: nameTokens(names.clinician), placeholder: 'the clinician' }]
        : []),
    ],
    messages: fixture.messages.map((m) => ({ sender: m.sender, body: m.text })),
    maxOutputTokens,
  });
}

function summaryText(s: ConversationSummaryOutput): string {
  return [s.overview, ...s.parentConcerns, ...s.guidanceGiven, ...s.openQuestions].join('\n');
}

function check(fixture: Fixture, summary: ConversationSummaryOutput): string[] {
  const text = summaryText(summary).toLowerCase();
  const reasons: string[] = [];
  fixture.expect.mentions.forEach((group, i) => {
    if (!group.some((p) => text.includes(p.toLowerCase()))) reasons.push(`NOT_MENTIONED[${i}]`);
  });
  fixture.expect.mustNotContain.forEach((p, i) => {
    if (text.includes(p.toLowerCase())) reasons.push(`FORBIDDEN_PHRASE[${i}]`);
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
  let problems = 0;
  for (const fixture of fixtures) {
    const req = request(fixture, SUMMARY_MAX_OUTPUT_TOKENS);
    const allNames = Object.values(fixture.names).flatMap((n) => nameTokens(n));
    const leaked = containsName(req.user, allNames);
    if (leaked) problems++;
    console.log(
      `${fixture.id}  prompt ${req.user.length} chars  name-in-prompt ${leaked ? 'YES' : 'no'}`,
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
      get: () => ({
        enabled: true,
        model: spec,
        fallbackModel: '',
        timeoutMs: envInt('AI_TIMEOUT_MS', 10000),
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      }),
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

  let passed = 0;
  let failed = 0;
  for (const [i, fixture] of fixtures.entries()) {
    if (i > 0) await sleep(delayMs);
    const req = request(fixture, SUMMARY_MAX_OUTPUT_TOKENS);
    let rejection: string | undefined;
    const safetyCheck = req.postCheck!;
    req.postCheck = (output) => {
      const verdict = safetyCheck(output);
      if (verdict !== 'ok') rejection = verdict.reject;
      return verdict;
    };

    let outcome: string;
    try {
      const { output } = await service.generateStructured(req);
      const reasons = check(fixture, output);
      outcome = reasons.length === 0 ? 'PASS' : `FAIL  ${reasons.join(', ')}`;
    } catch (err) {
      if (!(err instanceof AiRunError)) {
        outcome = `ERROR  UNEXPECTED:${err instanceof Error ? err.name : 'unknown'}`;
      } else if (err.code === 'AI_INVALID_OUTPUT') {
        outcome = `FAIL  ${rejection ? `SAFETY_CHECK:${rejection}` : 'SCHEMA_INVALID'}`;
      } else {
        outcome = `ERROR  ${err.code}${err.httpStatus ? `:${err.httpStatus}` : ''}`;
      }
    }
    if (outcome === 'PASS') passed++;
    else failed++;
    console.log(`${fixture.id}  ${outcome}`);
  }

  const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  console.log(
    `\nModel ${spec}, prompt v${conversationSummaryPromptV1.version}: ${passed} passed, ${failed} failed of ${fixtures.length}.` +
      `\nRequests ${runs.length}, input tokens ${runs.reduce((n, r) => n + (r.inputTokens ?? 0), 0)}, ` +
      `output tokens ${runs.reduce((n, r) => n + (r.outputTokens ?? 0), 0)}, ` +
      `median latency ${latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0} ms.`,
  );
  if (failed > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const fixtures = select(loadFixtures(), process.argv.slice(2));
  if (process.env.AI_EVAL_LIVE !== '1') return dryRun(fixtures);
  if (process.env.CI) throw new Error('Refusing to run the live eval in CI');
  await liveRun(fixtures);
}

main().catch((err: unknown) => {
  console.error(`ai:eval:summary failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
