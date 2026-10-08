import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CoachingTipContent } from '@modules/ai-coaching/shared/coaching-tip.schema';

/**
 * Pure parts of the coaching-tip eval (plan 0018 Q10.4): fixture schema and loader, the
 * per-case expectation checks, and the report. The report is built from ids, counts and reason
 * codes only, so it can be pasted into a PR without leaking fixture or model text.
 */

const tipInput = z.strictObject({ title: z.string(), body: z.string() });

const fixtureSchema = z.strictObject({
  id: z.string().regex(/^[GI]\d{2}-[a-z0-9-]+$/),
  description: z.string().min(1),
  input: z.strictObject({
    childName: z.string().min(1),
    ageYears: z.number().int().nonnegative().nullable(),
    planDay: z
      .strictObject({
        dayNumber: z.number().int().positive(),
        title: z.string(),
        instructions: z.string(),
      })
      .nullable(),
    daysLogged: z.number().int().min(0).max(7),
    sleepMinutesAverage: z.number().nonnegative().nullable(),
    clinicianTips: z.array(tipInput),
  }),
  expect: z.strictObject({
    /** Each group is "any of": at least one phrase per group must appear (the instruction is preserved). */
    mentions: z.array(z.array(z.string().min(1)).min(1)).default([]),
    /** None of these may appear (the model did not follow an injected command). */
    mustNotContain: z.array(z.string().min(1)).default([]),
  }),
});

export type EvalFixture = z.infer<typeof fixtureSchema>;

export const FIXTURE_DIR = join(__dirname, 'fixtures');

export function loadFixtures(dir: string = FIXTURE_DIR): EvalFixture[] {
  const fixtures: EvalFixture[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const parsed = z.array(fixtureSchema).safeParse(raw);
    if (!parsed.success) {
      // Path and rule only: a fixture problem should be fixable without echoing fixture text.
      const issue = parsed.error.issues[0];
      throw new Error(`Invalid fixture file ${file} at ${issue.path.join('.')}: ${issue.code}`);
    }
    fixtures.push(...parsed.data);
  }
  const ids = fixtures.map((f) => f.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Duplicate fixture id ${duplicate}`);
  return fixtures;
}

export function tipText(tip: CoachingTipContent): string {
  return [tip.headline, tip.body, ...tip.tryThis].join('\n');
}

/** Checks a schema-valid, safety-filter-clean tip against the fixture's expectations. */
export function checkExpectations(fixture: EvalFixture, tip: CoachingTipContent): string[] {
  const text = tipText(tip).toLowerCase();
  const reasons: string[] = [];
  fixture.expect.mentions.forEach((group, i) => {
    if (!group.some((phrase) => text.includes(phrase.toLowerCase()))) {
      reasons.push(`INSTRUCTION_NOT_PRESERVED[${i}]`);
    }
  });
  fixture.expect.mustNotContain.forEach((phrase, i) => {
    if (text.includes(phrase.toLowerCase())) reasons.push(`FORBIDDEN_PHRASE[${i}]`);
  });
  return reasons;
}

export type CaseOutcome = 'PASS' | 'FAIL' | 'ERROR';

export interface CaseResult {
  id: string;
  outcome: CaseOutcome;
  /** Reason codes only: safety-filter codes, expectation codes, or an AiRunError code. */
  reasons: string[];
}

export interface RunStats {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  latenciesMs: number[];
}

export interface EvalSummary {
  model: string;
  promptVersion: number;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  failing: CaseResult[];
  stats: RunStats;
}

export function summarise(
  model: string,
  promptVersion: number,
  results: CaseResult[],
  stats: RunStats,
): EvalSummary {
  return {
    model,
    promptVersion,
    total: results.length,
    passed: results.filter((r) => r.outcome === 'PASS').length,
    failed: results.filter((r) => r.outcome === 'FAIL').length,
    errors: results.filter((r) => r.outcome === 'ERROR').length,
    failing: results.filter((r) => r.outcome !== 'PASS'),
    stats,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function formatReport(s: EvalSummary): string {
  const latencies = [...s.stats.latenciesMs].sort((a, b) => a - b);
  const lines = [
    `model:          ${s.model}`,
    `prompt version: ${s.promptVersion}`,
    `cases:          ${s.total} (pass ${s.passed}, fail ${s.failed}, error ${s.errors})`,
    `requests:       ${s.stats.requests}`,
    `tokens:         in ${s.stats.inputTokens}, out ${s.stats.outputTokens}`,
    `latency ms:     p50 ${percentile(latencies, 0.5)}, max ${latencies[latencies.length - 1] ?? 0}`,
  ];
  if (s.failing.length === 0) {
    lines.push('failing cases:  none');
  } else {
    lines.push('failing cases:');
    for (const f of s.failing) lines.push(`  ${f.id}  ${f.outcome}  ${f.reasons.join(', ')}`);
  }
  return lines.join('\n');
}
