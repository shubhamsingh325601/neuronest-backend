import { z } from 'zod';
import { BLOCKLIST, type SafetyVerdict } from '@modules/ai-coaching/shared/coaching-safety.filter';
import { containsName } from '@modules/ai-coaching/shared/text-safety.util';

/** Fixed taxonomy (plan 0019 §7). Clinician sign-off on it is launch gate G3. */
export const SUMMARY_THEMES = [
  'sleep',
  'meltdowns',
  'sensory',
  'routines',
  'transitions',
  'school',
  'parent-wellbeing',
  'other',
] as const;

export const OVERVIEW_MAX = 600;
export const THEMES_MAX = 5;
export const ITEM_MAX = 140;
export const CONCERNS_MAX_ITEMS = 5;
export const GUIDANCE_MAX_ITEMS = 5;
export const QUESTIONS_MAX_ITEMS = 3;
/** No run of more than this many words may be copied from the conversation. */
export const QUOTE_MAX_WORDS = 8;

/** What the model returns. Plain strings, lists and one enum; limits live in the prompt and in `checkSummary`. */
export const conversationSummarySchema = z.object({
  overview: z.string(),
  themes: z.array(z.enum(SUMMARY_THEMES)),
  parentConcerns: z.array(z.string()),
  guidanceGiven: z.array(z.string()),
  openQuestions: z.array(z.string()),
  followUpSuggested: z.boolean(),
});

export type ConversationSummaryOutput = z.infer<typeof conversationSummarySchema>;

/** What is stored: the model output plus the kind, which the code knows better than the model. */
export type ConversationSummaryContent = ConversationSummaryOutput & {
  participantsKind: 'AI' | 'HUMAN';
};

// A summary may say the parent asked about a diagnosis or symptoms; it may not state one as fact.
// Markup, contact details and links are blocked with the same patterns as coaching tips. Medication is
// deliberately not: a summary must say what was discussed (owner decision, 2026-10-11).
const REUSED_CODES = new Set(['MARKUP', 'EMAIL', 'URL', 'PHONE', 'INJECTION_ECHO']);
const SUMMARY_BLOCKLIST: { code: string; pattern: RegExp }[] = [
  ...BLOCKLIST.filter(({ code }) => REUSED_CODES.has(code)),
  {
    code: 'DIAGNOSIS_AS_FACT',
    pattern:
      /\b(?:has|have|having|suffers?\s+from|suffering\s+from|diagnosed\s+with)\s+(?:an?\s+)?(?:autism|autistic|adhd|asd)\b/i,
  },
  { code: 'AGE', pattern: /\b\d{1,2}[\s-]*(?:years?|yrs?)[\s-]*old\b|\baged?\s+\d{1,2}\b/i },
  { code: 'DATE', pattern: /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/ },
];

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);

function windows(list: string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + size <= list.length; i++) out.push(list.slice(i, i + size).join(' '));
  return out;
}

export interface SummaryCheckInput {
  /** Name parts of the child, parent, expert and clinicians. */
  nameTokens: string[];
  /** The (already redacted) message texts the model was given. */
  sourceTexts: string[];
}

/** Deterministic checks on a schema-valid summary (plan 0019 §7). Fails closed. */
export function checkSummary(
  output: ConversationSummaryOutput,
  { nameTokens, sourceTexts }: SummaryCheckInput,
): SafetyVerdict {
  const overview = output.overview.trim();
  if (overview.length === 0 || overview.length > OVERVIEW_MAX) return { reject: 'OVERVIEW_LENGTH' };
  if (new Set(output.themes).size > THEMES_MAX) return { reject: 'THEME_COUNT' };

  const lists: [string[], number, string][] = [
    [output.parentConcerns, CONCERNS_MAX_ITEMS, 'CONCERNS'],
    [output.guidanceGiven, GUIDANCE_MAX_ITEMS, 'GUIDANCE'],
    [output.openQuestions, QUESTIONS_MAX_ITEMS, 'QUESTIONS'],
  ];
  for (const [items, maxItems, label] of lists) {
    if (items.length > maxItems) return { reject: `${label}_COUNT` };
    if (items.some((s) => s.trim().length === 0 || s.trim().length > ITEM_MAX)) {
      return { reject: `${label}_LENGTH` };
    }
  }

  const strings = [
    overview,
    ...output.parentConcerns,
    ...output.guidanceGiven,
    ...output.openQuestions,
  ];
  const all = strings.join('\n');
  if (containsName(all, nameTokens)) return { reject: 'NAME_LEAK' };
  for (const { code, pattern } of SUMMARY_BLOCKLIST) {
    if (pattern.test(all)) return { reject: code };
  }

  const size = QUOTE_MAX_WORDS + 1;
  const copied = new Set(sourceTexts.flatMap((text) => windows(words(text), size)));
  if (strings.some((s) => windows(words(s), size).some((w) => copied.has(w)))) {
    return { reject: 'VERBATIM_QUOTE' };
  }
  return 'ok';
}
