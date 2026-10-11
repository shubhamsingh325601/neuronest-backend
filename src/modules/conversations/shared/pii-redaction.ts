import { scrubName } from '@modules/ai-coaching/shared/text-safety.util';

/** Name parts to replace, and the plain words to put in their place (e.g. "the parent"). */
export interface NameGroup {
  tokens: string[];
  placeholder: string;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL = /(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|in)\b\S*/gi;
// Same shape as the output filter's PHONE check; covers +91 and 10-digit Indian numbers with spaces or dashes.
const PHONE = /\+?\d(?:[\s().-]?\d){6,}/g;
const LONG_DIGITS = /\d{5,}/g;

/**
 * Deterministic redaction of text before it reaches a model (plan 0019 §6.3). Emails, links, phone
 * numbers and long digit runs (ID-like) become plain words, then the given names are replaced.
 * Best effort: it cannot find a name it was not given, or a school or place name.
 */
export function redactPii(text: string, names: NameGroup[]): string {
  let out = text
    .replace(EMAIL, 'an email address')
    .replace(URL, 'a link')
    .replace(PHONE, 'a phone number')
    .replace(LONG_DIGITS, 'a number');
  for (const { tokens, placeholder } of names) {
    out = scrubName(out, tokens, placeholder);
    // "Dev Anand" is two name parts: keep one placeholder, not "the expert the expert".
    out = out.replace(new RegExp(`(?:${placeholder})(?:\\s+${placeholder})+`, 'gi'), placeholder);
  }
  return out;
}
