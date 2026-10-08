const TOKEN_SPLIT = /[\s,.'’-]+/u;
const CHILD_PLACEHOLDER = 'the child';

/** Name parts worth matching: the child's name split into words of at least two letters. */
export function nameTokens(name: string): string[] {
  const tokens = name
    .split(TOKEN_SPLIT)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)].sort((a, b) => b.length - a.length);
}

function nameRegex(tokens: string[]): RegExp | null {
  if (tokens.length === 0) return null;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // `\b` is ASCII-only; these lookarounds also bound words written in other scripts.
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** Pseudonymise: replace the child's name parts (case-insensitive, whole words) with "the child". */
export function scrubName(text: string, tokens: string[]): string {
  const re = nameRegex(tokens);
  return re ? text.replace(re, CHILD_PLACEHOLDER) : text;
}

export function containsName(text: string, tokens: string[]): boolean {
  const re = nameRegex(tokens);
  return re ? re.test(text) : false;
}

/** Stops untrusted text from closing or opening a prompt tag such as `</plan_day>`. */
export function escapeTags(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('');
}
