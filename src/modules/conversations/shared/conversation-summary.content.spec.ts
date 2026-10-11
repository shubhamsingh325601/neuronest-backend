import {
  checkSummary,
  conversationSummarySchema,
  type ConversationSummaryOutput,
} from './conversation-summary.content';

const input = {
  nameTokens: ['zorya', 'quill', 'meera', 'dev'],
  sourceTexts: [
    'my child wakes up three times every night and then cannot go back to sleep at all',
  ],
};

const good: ConversationSummaryOutput = {
  overview: 'The parent described broken sleep. The expert suggested a calmer bedtime routine.',
  themes: ['sleep', 'routines'],
  parentConcerns: ['Wakes several times each night'],
  guidanceGiven: ['Keep the same wind-down steps every evening'],
  openQuestions: ['Whether naps are too long'],
  followUpSuggested: true,
};

const verdict = (patch: Partial<ConversationSummaryOutput>) =>
  checkSummary({ ...good, ...patch }, input);

describe('conversationSummarySchema', () => {
  it('accepts the allowed shape and rejects an unknown theme', () => {
    expect(conversationSummarySchema.safeParse(good).success).toBe(true);
    expect(conversationSummarySchema.safeParse({ ...good, themes: ['football'] }).success).toBe(
      false,
    );
  });
});

describe('checkSummary', () => {
  it('accepts a clean summary', () => {
    expect(checkSummary(good, input)).toBe('ok');
  });

  it('accepts a summary that reports medicine, doses or a tablet computer being discussed', () => {
    expect(
      verdict({
        overview: 'The parent asked about risperidone 0.5 mg and about tablet time before dinner.',
        guidanceGiven: ['The expert said medication questions go to the clinician'],
      }),
    ).toBe('ok');
  });

  it('accepts a summary that says the parent asked about a diagnosis or symptoms', () => {
    expect(
      verdict({ parentConcerns: ['Asked whether a diagnosis is needed', 'Asked about symptoms'] }),
    ).toBe('ok');
  });

  it.each<[string, Partial<ConversationSummaryOutput>, string]>([
    ['an empty overview', { overview: '   ' }, 'OVERVIEW_LENGTH'],
    ['a long overview', { overview: 'a'.repeat(601) }, 'OVERVIEW_LENGTH'],
    ['too many concerns', { parentConcerns: Array(6).fill('x') }, 'CONCERNS_COUNT'],
    ['a long guidance item', { guidanceGiven: ['x'.repeat(141)] }, 'GUIDANCE_LENGTH'],
    ['too many questions', { openQuestions: Array(4).fill('x') }, 'QUESTIONS_COUNT'],
    ['an empty question', { openQuestions: [' '] }, 'QUESTIONS_LENGTH'],
    [
      'too many themes',
      { themes: ['sleep', 'meltdowns', 'sensory', 'routines', 'transitions', 'school'] },
      'THEME_COUNT',
    ],
    ['the child name', { overview: 'Zorya sleeps badly.' }, 'NAME_LEAK'],
    ['the parent name', { parentConcerns: ['meera is tired'] }, 'NAME_LEAK'],
    ['the expert name', { guidanceGiven: ['Dev suggested a routine'] }, 'NAME_LEAK'],
    ['an email', { overview: 'Contact a@b.com for more.' }, 'EMAIL'],
    ['a link', { overview: 'See www.example.com.' }, 'URL'],
    ['a phone number', { overview: 'Call 98765 43210.' }, 'PHONE'],
    ['markdown', { overview: 'This is **important**.' }, 'MARKUP'],
    [
      'a diagnosis stated as fact',
      { overview: 'The child has autism and sleeps badly.' },
      'DIAGNOSIS_AS_FACT',
    ],
    [
      'a reported diagnosis stated as fact',
      { overview: 'He was diagnosed with ADHD last year.' },
      'DIAGNOSIS_AS_FACT',
    ],
    ['an exact age', { overview: 'The 6 year old sleeps badly.' }, 'AGE'],
    ['a date', { overview: 'Born on 14/05/2019.' }, 'DATE'],
    [
      'a copied run of nine words',
      { parentConcerns: ['Wakes up three times every night and then cannot go back'] },
      'VERBATIM_QUOTE',
    ],
  ])('rejects %s', (_name, patch, code) => {
    expect(verdict(patch)).toEqual({ reject: code });
  });

  it('allows a copied run of eight words or fewer', () => {
    expect(verdict({ parentConcerns: ['wakes up three times every night and then'] })).toBe('ok');
  });
});
