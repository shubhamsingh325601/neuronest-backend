import { computeBackoffMs } from './backoff';

describe('computeBackoffMs', () => {
  const opts = { baseSec: 30, capSec: 3600 };

  it('returns at least half the exponential delay and below the full delay', () => {
    // attempts=1 -> d = 60s
    expect(computeBackoffMs(1, opts, () => 0)).toBe(30_000);
    expect(computeBackoffMs(1, opts, () => 0.999999)).toBeLessThan(60_000);
  });

  it('doubles per attempt', () => {
    expect(computeBackoffMs(2, opts, () => 0)).toBe(60_000);
    expect(computeBackoffMs(3, opts, () => 0)).toBe(120_000);
  });

  it('caps the delay', () => {
    expect(computeBackoffMs(20, opts, () => 0)).toBe(1_800_000);
    expect(computeBackoffMs(20, opts, () => 0.999999)).toBeLessThan(3_600_000);
  });

  it('stays finite for absurd attempt counts', () => {
    expect(Number.isFinite(computeBackoffMs(10_000, opts))).toBe(true);
  });
});
