import 'dotenv/config';
import { setTimeout as sleep } from 'node:timers/promises';
import { AiModelFactory, parseModelSpec } from '@common/ai/ai-model.factory';
import type { AiRunRecordInput } from '@common/ai/ai-run.recorder';
import { AiRunError } from '@common/ai/ai.service';
import { VercelAiService } from '@common/ai/vercel-ai.service';
import { assembleCoachingContext } from '@modules/ai-coaching/shared/coaching-context.builder';
import {
  buildCoachingTipRequest,
  coachingTipPrompt,
} from '@modules/ai-coaching/shared/coaching-tip.request';
import { containsName } from '@modules/ai-coaching/shared/text-safety.util';
import {
  checkExpectations,
  formatReport,
  loadFixtures,
  summarise,
  type CaseResult,
  type EvalFixture,
} from './eval-core';

/**
 * Manual, live eval of the coaching-tip pipeline (plan 0018 Q10.4): `npm run ai:eval [-- G01 I02]`.
 *
 * - Without `AI_EVAL_LIVE=1` it is a dry run: fixtures are validated and prompts built, no
 *   request is made. With it, one real request per case goes to `AI_MODEL` (the fallback model is
 *   ignored so a result belongs to exactly one model). Refuses to run when `CI` is set.
 * - Calls the production `VercelAiService` and request builder, with the database and Sentry
 *   stubbed out: nothing is written, and these requests do not count against the app's daily
 *   budget, so account for them against the provider quota yourself.
 * - Fixtures are synthetic only. The free Gemini tier may train on prompts: never add real data.
 * - Output is ids, counts and reason codes. It never prints a prompt, a fixture or model text.
 */

const KEY_ENV: Record<string, string> = {
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

function envInt(name: string, fallback: number): number {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function select(fixtures: EvalFixture[], ids: string[]): EvalFixture[] {
  if (ids.length === 0) return fixtures;
  const unknown = ids.filter((id) => !fixtures.some((f) => f.id.startsWith(id)));
  if (unknown.length > 0) throw new Error(`No fixture matches: ${unknown.join(', ')}`);
  return fixtures.filter((f) => ids.some((id) => f.id.startsWith(id)));
}

function dryRun(fixtures: EvalFixture[]): void {
  let problems = 0;
  for (const fixture of fixtures) {
    const built = assembleCoachingContext(fixture.input);
    const req = buildCoachingTipRequest(built, { userId: 'eval' }, 700);
    const leaked = containsName(req.user, built.nameTokens);
    if (leaked) problems++;
    console.log(`${fixture.id}  prompt ${req.user.length} chars  name-in-prompt ${leaked ? 'YES' : 'no'}`);
  }
  console.log(`\nDry run: ${fixtures.length} cases, ${problems} with the child's name in the prompt.`);
  console.log('Set AI_EVAL_LIVE=1 to send them to the model.');
  if (problems > 0) process.exitCode = 1;
}

async function liveRun(fixtures: EvalFixture[]): Promise<void> {
  const spec = process.env.AI_MODEL ?? 'google:gemini-3.5-flash-lite';
  const { provider } = parseModelSpec(spec);
  const keyName = KEY_ENV[provider];
  if (!keyName) throw new Error(`Unsupported provider "${provider}"`);
  if (!process.env[keyName]) throw new Error(`${keyName} is not set`);

  const maxOutputTokens = envInt('AI_MAX_OUTPUT_TOKENS', 700);
  const delayMs = envInt('AI_EVAL_DELAY_MS', 4500); // stays under the free tier's 15 requests/minute
  const runs: AiRunRecordInput[] = [];
  const service = new VercelAiService(
    {
      get: () => ({
        enabled: true,
        model: spec,
        fallbackModel: '',
        timeoutMs: envInt('AI_TIMEOUT_MS', 10000),
        maxOutputTokens,
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

  const results: CaseResult[] = [];
  for (const [i, fixture] of fixtures.entries()) {
    if (i > 0) await sleep(delayMs);
    const built = assembleCoachingContext(fixture.input);
    const req = buildCoachingTipRequest(built, { userId: 'eval' }, maxOutputTokens);
    let rejection: string | undefined;
    const safetyCheck = req.postCheck!;
    req.postCheck = (tip) => {
      const verdict = safetyCheck(tip);
      if (verdict !== 'ok') rejection = verdict.reject;
      return verdict;
    };

    let result: CaseResult;
    try {
      const { output } = await service.generateStructured(req);
      const reasons = checkExpectations(fixture, output);
      result = { id: fixture.id, outcome: reasons.length === 0 ? 'PASS' : 'FAIL', reasons };
    } catch (err) {
      if (!(err instanceof AiRunError)) {
        result = {
          id: fixture.id,
          outcome: 'ERROR',
          reasons: [`UNEXPECTED:${err instanceof Error ? err.name : 'unknown'}`],
        };
      } else if (err.code === 'AI_INVALID_OUTPUT') {
        result = {
          id: fixture.id,
          outcome: 'FAIL',
          reasons: [rejection ? `SAFETY_FILTER:${rejection}` : 'SCHEMA_INVALID'],
        };
      } else if (err.code === 'AI_BLOCKED') {
        result = { id: fixture.id, outcome: 'FAIL', reasons: ['PROVIDER_CONTENT_FILTER'] };
      } else {
        const status = err.httpStatus ? `:${err.httpStatus}` : '';
        result = { id: fixture.id, outcome: 'ERROR', reasons: [`${err.code}${status}`] };
      }
    }
    results.push(result);
    console.log(`${fixture.id}  ${result.outcome}${result.reasons.length ? '  ' + result.reasons.join(', ') : ''}`);
  }

  const summary = summarise(spec, coachingTipPrompt.version, results, {
    requests: runs.length,
    inputTokens: runs.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: runs.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    latenciesMs: runs.map((r) => r.latencyMs),
  });
  console.log(`\n${formatReport(summary)}`);
  if (summary.failed > 0 || summary.errors > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const fixtures = select(loadFixtures(), process.argv.slice(2));
  if (process.env.AI_EVAL_LIVE !== '1') return dryRun(fixtures);
  if (process.env.CI) throw new Error('Refusing to run the live eval in CI');
  await liveRun(fixtures);
}

main().catch((err: unknown) => {
  console.error(`ai:eval failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
