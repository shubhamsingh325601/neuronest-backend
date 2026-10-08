const PACIFIC_TZ = 'America/Los_Angeles';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function wallClock(instant: Date): { y: number; m: number; d: number; ms: number } {
  const parts: Record<string, number> = {};
  for (const p of formatter.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
  }
  return {
    y: parts.year,
    m: parts.month,
    d: parts.day,
    ms: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  };
}

/** The Pacific wall clock expressed as if it were UTC, minus the real instant: Pacific's UTC offset. */
function pacificOffsetMs(instant: Date): number {
  return wallClock(instant).ms - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * UTC instant of 00:00 America/Los_Angeles for the Pacific calendar day containing `now`.
 * Google resets free-tier daily quotas at midnight Pacific, so provider-request budgets count
 * from here (plan 0018 Q2.9). Handles DST: the offset is re-evaluated at the candidate instant.
 */
export function pacificDayStart(now: Date = new Date()): Date {
  const { y, m, d } = wallClock(now);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  let guess = new Date(midnightAsUtc - pacificOffsetMs(now));
  guess = new Date(midnightAsUtc - pacificOffsetMs(guess));
  return guess;
}

/** The Pacific calendar date (`YYYY-MM-DD`) containing `now`. */
export function pacificDateString(now: Date = new Date()): string {
  const { y, m, d } = wallClock(now);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
