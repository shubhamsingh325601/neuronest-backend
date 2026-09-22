const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * UTC date-only day offset from a plan's `startDate`: `1` on the start date,
 * incrementing daily. No per-child/per-user timezone support this phase (§6 of plan
 * 0006) — both inputs are truncated to UTC midnight before differencing.
 */
export function computeDayNumber(startDate: Date, today: Date): number {
  const startUtc = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((todayUtc - startUtc) / MS_PER_DAY) + 1;
}
