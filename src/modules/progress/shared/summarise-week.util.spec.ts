import { computeTrend, summariseWeek } from './summarise-week.util';

const day = (mood: number | null, behaviour: number | null, sleepMinutes: number | null) => ({
  mood,
  behaviour,
  sleepMinutes,
});

describe('summariseWeek', () => {
  it('returns zero days and null stats for an empty week', () => {
    expect(summariseWeek([])).toEqual({
      daysLogged: 0,
      mood: { average: null, min: null, max: null },
      behaviour: { average: null, min: null, max: null },
      sleepMinutes: { average: null, min: null, max: null },
    });
  });

  it('averages, mins and maxes each metric over only the days that logged it', () => {
    const week = summariseWeek([day(2, 4, 480), day(5, null, 540), day(null, 3, null)]);
    expect(week.daysLogged).toBe(3);
    expect(week.mood).toEqual({ average: 3.5, min: 2, max: 5 });
    expect(week.behaviour).toEqual({ average: 3.5, min: 3, max: 4 });
    expect(week.sleepMinutes).toEqual({ average: 510, min: 480, max: 540 });
  });
});

describe('computeTrend', () => {
  const week = (mood: number, behaviour: number) => summariseWeek([day(mood, behaviour, null)]);

  it('is UP / DOWN / FLAT by the combined mood+behaviour delta', () => {
    expect(computeTrend(week(4, 4), week(3, 3))).toBe('UP');
    expect(computeTrend(week(2, 2), week(4, 4))).toBe('DOWN');
    expect(computeTrend(week(3, 3), week(3, 3.2 as number))).toBe('FLAT');
  });

  it('is null when either week has no mood/behaviour data', () => {
    expect(computeTrend(week(3, 3), summariseWeek([]))).toBeNull();
    expect(computeTrend(summariseWeek([day(null, null, 400)]), week(3, 3))).toBeNull();
  });
});
