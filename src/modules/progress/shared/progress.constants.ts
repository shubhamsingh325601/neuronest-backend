/**
 * Provisional scales (plan 0013 §3 row 1, pending product decision D-7). Mirrored by the
 * `CHECK` constraints in migration add_progress_entries — change both together.
 */
export const MOOD_MIN = 1;
export const MOOD_MAX = 5;
export const BEHAVIOUR_MIN = 1;
export const BEHAVIOUR_MAX = 5;
export const SLEEP_MIN_MINUTES = 0;
export const SLEEP_MAX_MINUTES = 1440;
export const NOTE_MAX_LENGTH = 1000;
/** How far back a parent may log or correct an entry (plan 0013 §3 row 4). */
export const BACKFILL_WINDOW_DAYS = 30;
/** Combined mood+behaviour average must move by at least this much to count as UP/DOWN. */
export const TREND_FLAT_THRESHOLD = 0.25;
