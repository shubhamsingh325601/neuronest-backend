import { weekOfDay } from './week.util';

describe('weekOfDay', () => {
  it.each([
    [1, 1],
    [7, 1],
    [8, 2],
    [14, 2],
    [15, 3],
  ])('day %i is week %i', (day, week) => {
    expect(weekOfDay(day)).toBe(week);
  });
});
