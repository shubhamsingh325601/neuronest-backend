import { addDays, formatDateOnly, mondayOf, parseDateOnly, previousFullWeekStart } from './date.util';

describe('progress date util', () => {
  it('finds the Monday of any weekday, including Sunday', () => {
    expect(formatDateOnly(mondayOf(parseDateOnly('2026-10-05')))).toBe('2026-10-05'); // Mon
    expect(formatDateOnly(mondayOf(parseDateOnly('2026-10-07')))).toBe('2026-10-05'); // Wed
    expect(formatDateOnly(mondayOf(parseDateOnly('2026-10-11')))).toBe('2026-10-05'); // Sun
  });

  it('previous full week is the week before the one containing "now"', () => {
    expect(formatDateOnly(previousFullWeekStart(new Date('2026-10-04T10:00:00Z')))).toBe(
      '2026-09-21',
    );
    expect(formatDateOnly(previousFullWeekStart(new Date('2026-10-05T00:00:00Z')))).toBe(
      '2026-09-28',
    );
  });

  it('adds days across a month boundary', () => {
    expect(formatDateOnly(addDays(parseDateOnly('2026-09-30'), 2))).toBe('2026-10-02');
  });
});
