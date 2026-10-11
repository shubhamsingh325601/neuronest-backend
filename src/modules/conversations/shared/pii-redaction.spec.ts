import { nameTokens } from '@modules/ai-coaching/shared/text-safety.util';
import { redactPii } from './pii-redaction';

const names = [
  { tokens: nameTokens('Zorya Quill'), placeholder: 'the child' },
  { tokens: nameTokens('Meera Rao'), placeholder: 'the parent' },
  { tokens: nameTokens('Dev Anand'), placeholder: 'the expert' },
];

describe('redactPii', () => {
  it.each([
    ['an email', 'write to meera.rao@example.com please', 'write to an email address please'],
    ['a link', 'see https://example.com/page?id=7 now', 'see a link now'],
    ['a bare web address', 'visit www.example.org today', 'visit a link today'],
    ['an Indian mobile number', 'call 98765 43210 after five', 'call a phone number after five'],
    ['a +91 number', 'my number is +91-98765-43210.', 'my number is a phone number.'],
    ['a long digit run', 'her id is 482910', 'her id is a number'],
    ['a 7-digit run (read as a phone number)', 'her id is 4829105', 'her id is a phone number'],
  ])('replaces %s', (_name, input, expected) => {
    expect(redactPii(input, [])).toBe(expected);
  });

  it('leaves short numbers alone', () => {
    expect(redactPii('he sleeps 9 hours, woke up 3 times', [])).toBe(
      'he sleeps 9 hours, woke up 3 times',
    );
  });

  it('replaces each known name with its own plain words, whole words and any case', () => {
    expect(redactPii('ZORYA hit Dev Anand; Meera said Zoryas bag is gone', names)).toBe(
      'the child hit the expert; the parent said Zoryas bag is gone',
    );
  });

  it('removes a name inside an email before it can be matched as a name', () => {
    expect(redactPii('mail zorya@example.com', names)).toBe('mail an email address');
  });

  it('works on Hinglish text', () => {
    expect(redactPii('Zorya raat ko so nahi pata, 9876543210 pe call karo', names)).toBe(
      'the child raat ko so nahi pata, a phone number pe call karo',
    );
  });
});
