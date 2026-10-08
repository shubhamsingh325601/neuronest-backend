import { pacificDateString, pacificDayStart } from './pacific-day.util';

describe('pacificDayStart', () => {
  it('is 08:00 UTC during standard time (PST, UTC-8)', () => {
    expect(pacificDayStart(new Date('2026-01-15T20:30:00Z')).toISOString()).toBe(
      '2026-01-15T08:00:00.000Z',
    );
  });

  it('is 07:00 UTC during daylight time (PDT, UTC-7)', () => {
    expect(pacificDayStart(new Date('2026-07-15T20:30:00Z')).toISOString()).toBe(
      '2026-07-15T07:00:00.000Z',
    );
  });

  it('belongs to the previous Pacific day just after UTC midnight', () => {
    // 2026-10-05T03:00Z is 20:00 on Oct 4 in Pacific (PDT).
    const now = new Date('2026-10-05T03:00:00Z');
    expect(pacificDayStart(now).toISOString()).toBe('2026-10-04T07:00:00.000Z');
    expect(pacificDateString(now)).toBe('2026-10-04');
  });

  it('rolls over exactly at Pacific midnight', () => {
    expect(pacificDayStart(new Date('2026-10-05T06:59:59Z')).toISOString()).toBe(
      '2026-10-04T07:00:00.000Z',
    );
    expect(pacificDayStart(new Date('2026-10-05T07:00:00Z')).toISOString()).toBe(
      '2026-10-05T07:00:00.000Z',
    );
  });

  it('handles the spring-forward day (2026-03-08): midnight is still PST, afternoon is PDT', () => {
    expect(pacificDayStart(new Date('2026-03-08T22:00:00Z')).toISOString()).toBe(
      '2026-03-08T08:00:00.000Z',
    );
  });

  it('handles the fall-back day (2026-11-01): midnight is PDT, evening is PST', () => {
    expect(pacificDayStart(new Date('2026-11-01T20:00:00Z')).toISOString()).toBe(
      '2026-11-01T07:00:00.000Z',
    );
  });
});
