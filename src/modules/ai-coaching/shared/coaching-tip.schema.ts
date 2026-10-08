import { z } from 'zod';

/** Output length limits. They live in the prompt and the safety filter, not in the schema (plan 0018 Q5.2). */
export const HEADLINE_MAX = 80;
export const BODY_MAX = 600;
export const TRY_THIS_MAX_ITEMS = 3;
export const TRY_THIS_ITEM_MAX = 200;

/** What the model must return. Deliberately plain: strings and an array, no unions or records. */
export const coachingTipSchema = z.object({
  headline: z.string(),
  body: z.string(),
  tryThis: z.array(z.string()),
});

export type CoachingTipContent = z.infer<typeof coachingTipSchema>;
