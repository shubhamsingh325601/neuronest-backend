/** Capability name recorded on `ai_runs` and used as the `ai_outputs` cache key. */
export const COACHING_TIP_CAPABILITY = 'coaching-tip';

/** Job that finishes a generation the request could not (plan 0018 Q9.4). Payload: `{ outputId }`. */
export const COACHING_TIP_JOB = 'ai.coaching-tip.generate';
/** Recurring retention job for `ai_outputs` and `ai_runs`. */
export const AI_PRUNE_JOB = 'ai.prune';

/** At most this many generations per child per day (first + one regeneration; plan 0018 Q8.2). */
export const MAX_GENERATIONS_PER_DAY = 2;
/** Each job attempt can spend provider quota, so keep it small (plan 0018 Q9.4). */
export const COACHING_TIP_JOB_MAX_ATTEMPTS = 3;
/** A `PENDING` row older than this is treated as abandoned (its job died). */
export const PENDING_STALE_MS = 15 * 60_000;
/** `ai_runs` are metadata only, but still not kept forever. */
export const AI_RUN_RETENTION_DAYS = 90;

/** Shown with every tip; a server constant so a model can never talk its way out of it. */
export const AI_DISCLAIMER =
  "General guidance, not medical advice. Talk to your child's clinician about anything you're unsure of.";

/** Internal, enum-like reasons stored in `ai_outputs.failureReason` (never provider text). */
export type FailureReason =
  | 'DISABLED'
  | 'CAPACITY'
  | 'PROVIDER'
  | 'BLOCKED'
  | 'NO_PLAN'
  | 'ACCESS'
  | 'USER_INACTIVE';
