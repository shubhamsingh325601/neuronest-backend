const TERMINATORS = new Set(['.', '!', '?', '…', '।', '॥']);
const CLOSERS = new Set(['"', "'", ')', ']', '”', '’', '»']);
const ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'no',
  'rs',
]);
/** A reply with no sentence end for this long is cut at a space so the filter still sees it in pieces. */
const MAX_PIECE_CHARS = 240;

/**
 * Index just past the first sentence that the text already confirms, or -1. A sentence is confirmed by
 * its end mark, the whitespace after it, and the first character of what follows (so `Dr. Rao`, `3.5`
 * and `1. Do this` are not cut). The returned index is after the whitespace, so no piece starts with it.
 */
function findBoundary(buf: string): number {
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    const paragraph = c === '\n' && buf[i + 1] === '\n';
    if (!TERMINATORS.has(c) && !paragraph) continue;

    let j = i + 1;
    while (j < buf.length && (TERMINATORS.has(buf[j]) || CLOSERS.has(buf[j]))) j++;
    let k = j;
    while (k < buf.length && /\s/.test(buf[k])) k++;
    if (j >= buf.length) return -1; // nothing after the mark yet
    if (k === j) {
      i = j - 1; // glued to the next character, like "3.5"
      continue;
    }
    if (k >= buf.length) return -1; // wait for the first character of the next sentence
    if (c === '.' && !endsSentence(buf, i, buf[k])) {
      i = j - 1;
      continue;
    }
    return k;
  }
  return -1;
}

/** Whether a single `.` at `index` ends a sentence, given the first character after the gap. */
function endsSentence(buf: string, index: number, next: string): boolean {
  const before = buf.slice(0, index);
  const word = /[\p{L}.]+$/u.exec(before)?.[0] ?? '';
  if (ABBREVIATIONS.has(word.toLowerCase())) return false;
  if (word.length === 1 && /\p{Lu}/u.test(word)) return false; // an initial, like "A. Kumar"
  if (/(^|\n)\s*\d{1,2}$/.test(before)) return false; // "1. Do this"
  return !/[a-z]/.test(next); // a lower-case word after a full stop is the same sentence
}

/**
 * Cuts a streamed reply into sentence-sized pieces (plan 0019 section 6.5). Lossless: the pieces
 * joined are exactly the text pushed, whatever the chunking. A piece keeps its trailing whitespace.
 */
export class SentenceSplitter {
  private buf = '';

  push(text: string): string[] {
    this.buf += text;
    const pieces: string[] = [];
    for (;;) {
      let end = findBoundary(this.buf);
      if (end === -1 && this.buf.length >= MAX_PIECE_CHARS) {
        const space = this.buf.lastIndexOf(' ', MAX_PIECE_CHARS);
        end = space > 0 ? space + 1 : MAX_PIECE_CHARS;
      }
      if (end === -1) return pieces;
      pieces.push(this.buf.slice(0, end));
      this.buf = this.buf.slice(end);
    }
  }

  /** Whatever is left once the reply is over (possibly an unfinished sentence). */
  flush(): string {
    const rest = this.buf;
    this.buf = '';
    return rest;
  }
}

/** Whether the text stops at the end of a sentence rather than in the middle of one. */
export function endsWithSentenceEnd(text: string): boolean {
  let end = text.trimEnd();
  while (end.length > 0 && CLOSERS.has(end[end.length - 1])) end = end.slice(0, -1);
  return end.length > 0 && TERMINATORS.has(end[end.length - 1]);
}
