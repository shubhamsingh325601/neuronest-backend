import { Prisma } from '@prisma/client';

/**
 * Bind a JS Date as a `timestamp` (no tz) holding the UTC wall-clock — the way Prisma
 * stores `DateTime`. Raw SQL must never use `now()` for these columns: it would be
 * rendered in the session time zone, which is not guaranteed to be UTC.
 */
export function utc(date: Date): Prisma.Sql {
  return Prisma.sql`${date.toISOString()}::timestamp`;
}
