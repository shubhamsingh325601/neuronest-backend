export interface BackoffOptions {
  baseSec: number;
  capSec: number;
}

/**
 * Equal-jitter exponential backoff: `d = min(cap, base·2^attempts)`, then a delay in
 * `[d/2, d)`. Half the delay is guaranteed (no thundering herd of near-zero retries),
 * half is random. `attempts` is the number of attempts already made (>= 1 on a retry).
 * `rng` is injectable so the function is deterministic under test.
 */
export function computeBackoffMs(
  attempts: number,
  { baseSec, capSec }: BackoffOptions,
  rng: () => number = Math.random,
): number {
  const exp = Math.min(Math.max(attempts, 0), 30); // keep 2**n finite
  const d = Math.min(capSec, baseSec * 2 ** exp) * 1000;
  return Math.floor(d / 2 + rng() * (d / 2));
}
