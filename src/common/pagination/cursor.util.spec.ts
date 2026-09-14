import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor, toCursorPage } from './cursor.util';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

describe('cursor.util', () => {
  it('round-trips a uuid through encode/decode', () => {
    expect(decodeCursor(encodeCursor(UUID_A))).toBe(UUID_A);
  });

  it('produces an opaque (non-plaintext) cursor', () => {
    expect(encodeCursor(UUID_A)).not.toContain(UUID_A);
  });

  it('rejects a malformed cursor with INVALID_CURSOR', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
    try {
      decodeCursor('not-a-cursor');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'INVALID_CURSOR',
      });
    }
  });

  describe('toCursorPage', () => {
    const rows = [{ id: UUID_A }, { id: UUID_B }, { id: 'x' }];
    const getId = (r: { id: string }) => r.id;

    it('trims the over-fetched row and returns a nextCursor', () => {
      const page = toCursorPage(rows, 2, getId);
      expect(page.data).toEqual([{ id: UUID_A }, { id: UUID_B }]);
      expect(page.nextCursor).toBe(encodeCursor(UUID_B));
    });

    it('returns a null nextCursor on the last page', () => {
      const page = toCursorPage(rows.slice(0, 2), 2, getId);
      expect(page.data).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('handles an empty result set', () => {
      expect(toCursorPage([], 2, getId)).toEqual({ data: [], nextCursor: null });
    });
  });
});
