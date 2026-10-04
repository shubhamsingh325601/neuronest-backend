import { registerDecorator, type ValidationOptions } from 'class-validator';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Furthest-ahead timezone is UTC+14, so a user's own "today" may be UTC-tomorrow. */
const MAX_UTC_OFFSET_MS = 14 * 3_600_000;

/**
 * True for a real calendar date written `YYYY-MM-DD` (no time component) that is not
 * later than the UTC date of `now + 14h` — so a parent in UTC+14 entering their own
 * "today" is accepted, while anything further ahead is rejected.
 */
export function isDateOnlyNotFuture(value: unknown, now: Date = new Date()): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const match = DATE_ONLY.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!isRealDate) {
    return false;
  }
  const latestAllowed = new Date(now.getTime() + MAX_UTC_OFFSET_MS).toISOString().slice(0, 10);
  return value <= latestAllowed;
}

/** class-validator decorator wrapping {@link isDateOnlyNotFuture}. */
export function IsDateOnlyNotFuture(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isDateOnlyNotFuture',
      target: object.constructor,
      propertyName: propertyName as string,
      options: {
        message: '$property must be a real date in YYYY-MM-DD format and not in the future',
        ...options,
      },
      validator: { validate: (value: unknown) => isDateOnlyNotFuture(value) },
    });
  };
}
