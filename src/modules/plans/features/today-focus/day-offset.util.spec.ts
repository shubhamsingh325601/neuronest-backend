import { computeDayNumber } from './day-offset.util';

describe('computeDayNumber', () => {
  it('is 1 on the start date itself', () => {
    expect(computeDayNumber(new Date('2026-09-22T00:00:00Z'), new Date('2026-09-22T15:30:00Z'))).toBe(
      1,
    );
  });

  it('increments by 1 per elapsed day', () => {
    expect(computeDayNumber(new Date('2026-09-22'), new Date('2026-09-25'))).toBe(4);
  });

  it('is non-positive before the start date', () => {
    expect(computeDayNumber(new Date('2026-09-22'), new Date('2026-09-20'))).toBe(-1);
  });

  it('ignores time-of-day — only the UTC calendar date matters', () => {
    expect(
      computeDayNumber(new Date('2026-09-22T23:59:00Z'), new Date('2026-09-23T00:01:00Z')),
    ).toBe(2);
  });
});
