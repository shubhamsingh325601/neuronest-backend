import { endsWithSentenceEnd, SentenceSplitter } from './sentence-splitter';

/** Pushes `text` in chunks of `size` characters, then flushes. */
function split(text: string, size = text.length): string[] {
  const splitter = new SentenceSplitter();
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size)
    pieces.push(...splitter.push(text.slice(i, i + size)));
  const rest = splitter.flush();
  if (rest !== '') pieces.push(rest);
  return pieces;
}

const CHUNK_SIZES = [1, 2, 3, 7, 1000];

describe('SentenceSplitter', () => {
  const cases: [string, string, string[]][] = [
    [
      'English sentences',
      'Start small. Keep it calm! Is it working? Yes.',
      ['Start small. ', 'Keep it calm! ', 'Is it working? ', 'Yes.'],
    ],
    [
      'decimals stay whole',
      'Aim for 3.5 minutes. Then stop.',
      ['Aim for 3.5 minutes. ', 'Then stop.'],
    ],
    [
      'abbreviations do not end a sentence',
      'Ask Dr. Rao or Mrs. Iyer, e.g. at the call. Then wait.',
      ['Ask Dr. Rao or Mrs. Iyer, e.g. at the call. ', 'Then wait.'],
    ],
    [
      'numbered steps stay with their text',
      'Do these:\n1. Dim the lights.\n2. Read a story.',
      ['Do these:\n1. Dim the lights.\n', '2. Read a story.'],
    ],
    [
      'closing quotes and brackets stay with the sentence',
      'She said "stop." Then (quietly) left. Ok',
      ['She said "stop." ', 'Then (quietly) left. ', 'Ok'],
    ],
    [
      'an ellipsis is one boundary',
      'Well... maybe later. Fine.',
      ['Well... maybe later. ', 'Fine.'],
    ],
    [
      'a lower-case word after a full stop continues the sentence',
      'Try a timer. then relax. Next.',
      ['Try a timer. then relax. ', 'Next.'],
    ],
    [
      'link-like tokens are not cut',
      'See a.b.c for more. Done.',
      ['See a.b.c for more. ', 'Done.'],
    ],
    [
      'emoji and Hinglish in Roman script',
      'Bachche ko Rs. 50 do. Phir ruko 😊 Theek hai.',
      ['Bachche ko Rs. 50 do. ', 'Phir ruko 😊 Theek hai.'],
    ],
    [
      'Devanagari danda',
      'आज थोड़ा खेलें। फिर आराम करें। ठीक है',
      ['आज थोड़ा खेलें। ', 'फिर आराम करें। ', 'ठीक है'],
    ],
    [
      'a blank line ends a paragraph',
      'First idea\n\nSecond idea',
      ['First idea\n\n', 'Second idea'],
    ],
  ];

  it.each(cases)('%s', (_name, text, expected) => {
    expect(split(text)).toEqual(expected);
  });

  it.each(cases)('gives the same pieces for any chunking: %s', (_name, text, expected) => {
    for (const size of CHUNK_SIZES) expect(split(text, size)).toEqual(expected);
  });

  it('is lossless: the pieces joined are the text pushed', () => {
    for (const [, text] of cases) {
      for (const size of CHUNK_SIZES) expect(split(text, size).join('')).toBe(text);
    }
  });

  it('holds a sentence until the next one begins, so it never cuts too early', () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push('One idea.')).toEqual([]);
    expect(splitter.push(' ')).toEqual([]);
    expect(splitter.push('Two')).toEqual(['One idea. ']);
    expect(splitter.flush()).toBe('Two');
  });

  it('cuts a very long run with no sentence end at a space', () => {
    const text = `${'word '.repeat(80)}end.`;
    const pieces = split(text, 10);

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= 241)).toBe(true);
    expect(pieces.join('')).toBe(text);
  });

  it('flush returns nothing twice', () => {
    const splitter = new SentenceSplitter();
    splitter.push('Half a sentence');
    expect(splitter.flush()).toBe('Half a sentence');
    expect(splitter.flush()).toBe('');
  });
});

describe('endsWithSentenceEnd', () => {
  it.each([
    ['A whole sentence.', true],
    ['A question?  ', true],
    ['She said "stop."', true],
    ['आराम करें।', true],
    ['cut in the mid', false],
    ['', false],
  ])('%j -> %s', (text, expected) => {
    expect(endsWithSentenceEnd(text)).toBe(expected);
  });
});
