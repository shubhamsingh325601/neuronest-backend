const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` -> a UTC-midnight Date (what Prisma stores for a `@db.Date`). */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** The Monday (UTC) of the ISO-style Monday–Sunday week containing `date`. */
export function mondayOf(date: Date): Date {
  const midnight = parseDateOnly(formatDateOnly(date));
  const sinceMonday = (midnight.getUTCDay() + 6) % 7;
  return addDays(midnight, -sinceMonday);
}

/** The most recent *complete* Monday–Sunday week (UTC) before `now`. */
export function previousFullWeekStart(now: Date): Date {
  return addDays(mondayOf(now), -7);
}
