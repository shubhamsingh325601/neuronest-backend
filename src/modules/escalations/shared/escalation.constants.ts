export const ESCALATION_CATEGORIES = [
  'sensory_overload',
  'meltdown_safety',
  'sleep_routine_crisis',
  'parent_exhaustion',
  'transition_crisis',
] as const;
export type EscalationCategory = (typeof ESCALATION_CATEGORIES)[number];

/** A clinician should respond within this long. */
export const ESCALATION_RESPONSE_MS = 24 * 60 * 60 * 1000;
