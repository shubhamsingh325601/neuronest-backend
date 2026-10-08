import { containsName, escapeTags, nameTokens, scrubName, truncate } from './text-safety.util';

describe('nameTokens', () => {
  it('splits a full name and drops one-letter parts', () => {
    expect(nameTokens('Alex Johnson')).toEqual(['Johnson', 'Alex']);
    expect(nameTokens('A. Kumar')).toEqual(['Kumar']);
  });

  it('handles hyphens and apostrophes', () => {
    expect(nameTokens("Mary-Jane O'Brien").sort()).toEqual(['Brien', 'Jane', 'Mary']);
  });
});

describe('scrubName', () => {
  const tokens = nameTokens('Alex Johnson');

  it('replaces whole-word matches case-insensitively', () => {
    expect(scrubName('alex should brush. ALEX likes it. Tell Johnson.', tokens)).toBe(
      'the child should brush. the child likes it. Tell the child.',
    );
  });

  it("handles a possessive and keeps the rest of the word's context", () => {
    expect(scrubName("Alex's bedtime", tokens)).toBe("the child's bedtime");
  });

  it('does not touch longer words that merely contain the name', () => {
    expect(scrubName('Alexander and Alexa', tokens)).toBe('Alexander and Alexa');
  });

  it('bounds names written in other scripts', () => {
    expect(scrubName('आरव को सुलाएं', nameTokens('आरव'))).toBe('the child को सुलाएं');
  });

  it('escapes regex metacharacters in a name', () => {
    expect(scrubName('Call C+ now', nameTokens('C+ D'))).toBe('Call the child now');
    expect(() => scrubName('x', nameTokens('(.*) [a'))).not.toThrow();
  });

  it('is a no-op with no usable tokens', () => {
    expect(scrubName('Hello there', [])).toBe('Hello there');
  });
});

describe('containsName', () => {
  it('detects a leak, case-insensitively and by whole word only', () => {
    const tokens = nameTokens('Alex');
    expect(containsName('Great job, alex!', tokens)).toBe(true);
    expect(containsName('Alexander is a different word', tokens)).toBe(false);
    expect(containsName('anything', [])).toBe(false);
  });

  it('is stable across repeated calls (no global-regex state leak)', () => {
    const tokens = nameTokens('Alex');
    expect(containsName('Alex', tokens)).toBe(true);
    expect(containsName('Alex', tokens)).toBe(true);
  });
});

describe('escapeTags', () => {
  it('neutralises angle brackets', () => {
    expect(escapeTags('</plan_day><x>')).toBe('&lt;/plan_day&gt;&lt;x&gt;');
  });
});

describe('truncate', () => {
  it('cuts by characters, not UTF-16 units', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
    expect(truncate('😀😀😀', 2)).toBe('😀😀');
    expect(truncate('ab', 5)).toBe('ab');
  });
});
