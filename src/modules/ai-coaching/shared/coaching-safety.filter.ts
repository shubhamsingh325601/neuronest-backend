import {
  BODY_MAX,
  HEADLINE_MAX,
  TRY_THIS_ITEM_MAX,
  TRY_THIS_MAX_ITEMS,
  type CoachingTipContent,
} from './coaching-tip.schema';
import { containsName } from './text-safety.util';

export type SafetyVerdict = 'ok' | { reject: string };

/**
 * Deterministic output checks (plan 0018 Q4/Q5). Fail closed: a hit means the tip is never shown.
 * The list is the engineering draft of the blocklist; clinician sign-off on it is launch gate G3,
 * and it is English-only until that review decides on Hindi/Hinglish coverage.
 */
const BLOCKLIST: { code: string; pattern: RegExp }[] = [
  {
    code: 'MEDICATION',
    pattern:
      /\b(medicat\w*|medicines?|drugs?|doses?|dosages?|dosing|mg|ml|prescri\w*|pills?|tablets?|supplements?|vitamins?|melatonin|ritalin|methylphenidate|adderall|risperidone|aripiprazole|atomoxetine|stimulants?|dawa|dawai|dawaiyan|goli|golee)\b/i,
  },
  {
    code: 'DIAGNOSIS',
    pattern:
      /\b(diagnos\w*|symptoms?|disorders?|(?:has|have|having|suffers?\s+from|suffering\s+from)\s+(?:an?\s+)?(?:autism|autistic|adhd|asd))\b/i,
  },
  {
    code: 'PROMISE',
    pattern:
      /\b(guarantee[ds]?|cures?|cured|100\s?%|will\s+(?:definitely|certainly|surely|always)|always\s+works?|will\s+(?:be\s+)?(?:cured|fixed))\b/i,
  },
  {
    code: 'INJECTION_ECHO',
    pattern: /\b(system\s+prompt|ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above)|my\s+instructions)\b/i,
  },
  { code: 'MARKUP', pattern: /[<>`]|\*\*|__|\[[^\]]*\]\([^)]*\)|^\s{0,3}#{1,6}\s/m },
  { code: 'EMAIL', pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { code: 'URL', pattern: /(https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|io)\b)/i },
  { code: 'PHONE', pattern: /\+?\d(?:[\s().-]?\d){6,}/ },
];

export interface CoachingTipCheckOptions {
  /**
   * Whether at least one step is required. False only when the prompt context holds nothing to
   * derive a step from (no plan day and no clinician tips), where "nothing scheduled today" is the
   * correct note and an empty list is allowed (prompt v2).
   */
  stepsRequired?: boolean;
}

export function checkCoachingTip(
  output: CoachingTipContent,
  childNameTokens: string[],
  { stepsRequired = true }: CoachingTipCheckOptions = {},
): SafetyVerdict {
  const headline = output.headline.trim();
  const body = output.body.trim();
  const steps = output.tryThis.map((s) => s.trim());

  if (headline.length === 0 || headline.length > HEADLINE_MAX) return { reject: 'HEADLINE_LENGTH' };
  if (body.length === 0 || body.length > BODY_MAX) return { reject: 'BODY_LENGTH' };
  if (steps.length < (stepsRequired ? 1 : 0) || steps.length > TRY_THIS_MAX_ITEMS) {
    return { reject: 'STEP_COUNT' };
  }
  if (steps.some((s) => s.length === 0 || s.length > TRY_THIS_ITEM_MAX)) {
    return { reject: 'STEP_LENGTH' };
  }

  const all = [headline, body, ...steps].join('\n');
  if (containsName(all, childNameTokens)) return { reject: 'NAME_LEAK' };
  for (const { code, pattern } of BLOCKLIST) {
    if (pattern.test(all)) return { reject: code };
  }
  return 'ok';
}
