import { TREND_FLAT_THRESHOLD } from './progress.constants';

export interface DayScores {
  mood: number | null;
  behaviour: number | null;
  sleepMinutes: number | null;
}

export interface MetricStats {
  average: number | null;
  min: number | null;
  max: number | null;
}

export type Trend = 'UP' | 'DOWN' | 'FLAT';

export interface WeekStats {
  daysLogged: number;
  mood: MetricStats;
  behaviour: MetricStats;
  sleepMinutes: MetricStats;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function stats(values: Array<number | null>): MetricStats {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return { average: null, min: null, max: null };
  }
  const sum = present.reduce((a, b) => a + b, 0);
  return { average: round2(sum / present.length), min: Math.min(...present), max: Math.max(...present) };
}

/** Aggregate one week's entries. An empty week yields `daysLogged: 0` and null stats. */
export function summariseWeek(entries: DayScores[]): WeekStats {
  return {
    daysLogged: entries.length,
    mood: stats(entries.map((e) => e.mood)),
    behaviour: stats(entries.map((e) => e.behaviour)),
    sleepMinutes: stats(entries.map((e) => e.sleepMinutes)),
  };
}

/** Mean of the mood and behaviour averages that exist; null if neither does. */
function wellbeing(week: WeekStats): number | null {
  const parts = [week.mood.average, week.behaviour.average].filter((v): v is number => v !== null);
  return parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0) / parts.length;
}

/**
 * Week-over-week direction of the combined mood+behaviour average. Sleep is excluded:
 * "more" is not unambiguously better. `null` when either week has no mood/behaviour data.
 */
export function computeTrend(current: WeekStats, prior: WeekStats): Trend | null {
  const now = wellbeing(current);
  const before = wellbeing(prior);
  if (now === null || before === null) {
    return null;
  }
  const delta = now - before;
  if (Math.abs(delta) < TREND_FLAT_THRESHOLD) {
    return 'FLAT';
  }
  return delta > 0 ? 'UP' : 'DOWN';
}
