import { BLOCKLIST, type SafetyVerdict } from '@modules/ai-coaching/shared/coaching-safety.filter';
import { containsName } from '@modules/ai-coaching/shared/text-safety.util';

/**
 * The assistant must never sound like a clinician (plan 0019 section 6.2 rule 1). These add to the
 * coaching blocklist, which already covers medication, diagnosis, promises, links and markup.
 */
export const PERSONA_BREACH: { code: string; pattern: RegExp }[] = [
  {
    code: 'CLAIMS_CLINICIAN',
    pattern:
      /\b(?:as\s+(?:your|a|the)\s+(?:doctor|clinician|therapist|psychologist|psychiatrist|paediatrician|pediatrician|expert)|i\s*(?:am|'m)\s+(?:a|an|your)\s+(?:doctor|clinician|therapist|psychologist|psychiatrist|paediatrician|pediatrician|expert)|in\s+my\s+(?:clinical|medical|professional)\s+(?:opinion|experience|judgement|judgment))\b/i,
  },
];

/**
 * Deterministic check of one piece of a streamed reply. Fail closed: a hit means the piece is never
 * shown. The caller passes the piece together with the tail of the one before it, so a phrase split
 * across two sentences is still seen. The list is the engineering draft; clinician sign-off on it is
 * launch gate G3.
 */
export function checkChatChunk(text: string, nameTokens: string[]): SafetyVerdict {
  if (containsName(text, nameTokens)) return { reject: 'NAME_LEAK' };
  for (const { code, pattern } of BLOCKLIST) {
    if (pattern.test(text)) return { reject: code };
  }
  for (const { code, pattern } of PERSONA_BREACH) {
    if (pattern.test(text)) return { reject: code };
  }
  return 'ok';
}
