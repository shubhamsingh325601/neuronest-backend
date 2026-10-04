import { validate } from 'class-validator';
import { IsDateOnlyNotFuture, isDateOnlyNotFuture } from './is-date-only-not-future.decorator';

describe('isDateOnlyNotFuture', () => {
  // 2026-10-04T22:00Z — in UTC+14 it is already 2026-10-05 12:00.
  const now = new Date('2026-10-04T22:00:00Z');

  it.each(['2019-05-14', '2026-10-04', '1990-01-01'])('accepts %s', (value) => {
    expect(isDateOnlyNotFuture(value, now)).toBe(true);
  });

  it('accepts "tomorrow" in UTC when it is already today at UTC+14', () => {
    expect(isDateOnlyNotFuture('2026-10-05', now)).toBe(true);
  });

  it('rejects a date beyond the UTC+14 allowance', () => {
    expect(isDateOnlyNotFuture('2026-10-06', now)).toBe(false);
    expect(isDateOnlyNotFuture('2999-01-01', now)).toBe(false);
  });

  it('applies the allowance by the clock, not a whole day', () => {
    // 09:00Z + 14h = 23:00 same UTC day, so the 5th is still the future.
    expect(isDateOnlyNotFuture('2026-10-05', new Date('2026-10-04T09:00:00Z'))).toBe(false);
  });

  it.each([
    '2019-05-14T00:00:00Z',
    '2019-05-14T10:00:00',
    '2019-05-14 ',
    '14-05-2019',
    '2019-5-14',
    '2019-02-30',
    '2019-13-01',
    '',
    'not-a-date',
  ])('rejects %j', (value) => {
    expect(isDateOnlyNotFuture(value, now)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isDateOnlyNotFuture(20190514 as unknown, now)).toBe(false);
    expect(isDateOnlyNotFuture(undefined, now)).toBe(false);
  });
});

describe('@IsDateOnlyNotFuture', () => {
  class Probe {
    @IsDateOnlyNotFuture()
    dob!: string;
  }
  const check = async (dob: string) => validate(Object.assign(new Probe(), { dob }));

  it('passes a past date', async () => {
    expect(await check('2019-05-14')).toHaveLength(0);
  });

  it('fails a datetime and a far-future date with a readable message', async () => {
    const [datetime] = await check('2019-05-14T00:00:00Z');
    expect(datetime.constraints?.isDateOnlyNotFuture).toMatch(/YYYY-MM-DD/);
    expect(await check('2999-01-01')).toHaveLength(1);
  });
});
