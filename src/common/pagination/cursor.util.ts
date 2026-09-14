import { BadRequestException } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wrap a row id as an opaque cursor. The client treats it as a blob. */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

/**
 * Resolve a cursor back to the row id it anchors to. The only cursor this codebase
 * issues wraps a UUID primary key; anything else is a client error.
 */
export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!UUID_RE.test(decoded)) {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'The pagination cursor is malformed.',
    });
  }
  return decoded;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * Trim a row set fetched with `take: limit + 1` down to `limit`, and derive
 * `nextCursor` from the last kept row. `nextCursor` is `null` on the final page.
 */
export function toCursorPage<T>(
  rows: T[],
  limit: number,
  getId: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && data.length > 0 ? encodeCursor(getId(data[data.length - 1])) : null;
  return { data, nextCursor };
}
