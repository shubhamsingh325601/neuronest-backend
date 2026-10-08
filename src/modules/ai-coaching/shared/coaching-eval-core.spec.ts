import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkExpectations,
  formatReport,
  loadFixtures,
  summarise,
  type CaseResult,
  type EvalFixture,
} from '@test/ai/eval-core';

const fixture = (expectation: Partial<EvalFixture['expect']> = {}): EvalFixture => ({
  id: 'G99-test',
  description: 'test',
  input: {
    childName: 'Zorya Quill',
    ageYears: 6,
    planDay: null,
    daysLogged: 0,
    sleepMinutesAverage: null,
    clinicianTips: [],
  },
  expect: { mentions: [], mustNotContain: [], ...expectation },
});

const tip = { headline: 'Bubble play', body: 'Blow Bubbles together.', tryThis: ['Dim the lights.'] };

describe('checkExpectations', () => {
  it('passes when every mention group is satisfied, ignoring case', () => {
    const reasons = checkExpectations(fixture({ mentions: [['bubble'], ['LIGHTS', 'dark']] }), tip);
    expect(reasons).toEqual([]);
  });

  it('flags the group that was not preserved, by index', () => {
    const reasons = checkExpectations(fixture({ mentions: [['bubble'], ['timer', 'ball']] }), tip);
    expect(reasons).toEqual(['INSTRUCTION_NOT_PRESERVED[1]']);
  });

  it('flags a forbidden phrase by index, never by its text', () => {
    const reasons = checkExpectations(fixture({ mustNotContain: ['nothing', 'lights'] }), tip);
    expect(reasons).toEqual(['FORBIDDEN_PHRASE[1]']);
  });
});

describe('loadFixtures', () => {
  it('loads the shipped fixtures with unique ids', () => {
    const fixtures = loadFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
  });

  describe('with a bad directory', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'ai-fixtures-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('rejects an unknown field without echoing fixture text', () => {
      writeFileSync(
        join(dir, 'bad.json'),
        JSON.stringify([{ ...fixture(), extra: 'SECRET-FIXTURE-TEXT' }]),
      );
      expect(() => loadFixtures(dir)).toThrow(/bad\.json/);
      expect(() => loadFixtures(dir)).not.toThrow(/SECRET-FIXTURE-TEXT/);
    });

    it('rejects duplicate ids', () => {
      writeFileSync(join(dir, 'a.json'), JSON.stringify([fixture(), fixture()]));
      expect(() => loadFixtures(dir)).toThrow(/Duplicate fixture id G99-test/);
    });
  });
});

describe('report', () => {
  const results: CaseResult[] = [
    { id: 'G01-a', outcome: 'PASS', reasons: [] },
    { id: 'G02-b', outcome: 'FAIL', reasons: ['SAFETY_FILTER:MEDICATION'] },
    { id: 'I01-c', outcome: 'ERROR', reasons: ['AI_RATE_LIMITED:429'] },
  ];
  const stats = { requests: 3, inputTokens: 1200, outputTokens: 300, latenciesMs: [900, 400, 1500] };

  it('counts outcomes and lists only the failing case ids with reason codes', () => {
    const summary = summarise('google:gemini-3.5-flash-lite', 1, results, stats);
    expect(summary).toMatchObject({ total: 3, passed: 1, failed: 1, errors: 1 });

    const report = formatReport(summary);
    expect(report).toContain('cases:          3 (pass 1, fail 1, error 1)');
    expect(report).toContain('G02-b  FAIL  SAFETY_FILTER:MEDICATION');
    expect(report).toContain('I01-c  ERROR  AI_RATE_LIMITED:429');
    expect(report).toContain('tokens:         in 1200, out 300');
    expect(report).toContain('p50 900, max 1500');
    expect(report).not.toContain('G01-a');
  });

  it('says so when nothing failed', () => {
    const report = formatReport(
      summarise('m', 1, [{ id: 'G01-a', outcome: 'PASS', reasons: [] }], {
        requests: 1,
        inputTokens: 1,
        outputTokens: 1,
        latenciesMs: [1],
      }),
    );
    expect(report).toContain('failing cases:  none');
  });
});
