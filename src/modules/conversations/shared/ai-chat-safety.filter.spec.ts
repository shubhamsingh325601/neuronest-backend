import { checkChatChunk } from './ai-chat-safety.filter';

describe('checkChatChunk', () => {
  const names = ['Zephyrine', 'Rao'];

  it.each([
    'Try dimming the lights ten minutes earlier.',
    'A short, predictable routine can help bedtime feel safer.',
    'That is a question for your expert or clinician, so please book a call.',
    'You logged four days last week. Well done for keeping at it.',
  ])('allows a calm, in-scope sentence: %s', (text) => {
    expect(checkChatChunk(text, names)).toBe('ok');
  });

  it.each([
    ['A small dose of melatonin could help.', 'MEDICATION'],
    ['You could add a vitamin at breakfast.', 'MEDICATION'],
    ['Ask about a supplement.', 'MEDICATION'],
    ['This sounds like a disorder.', 'DIAGNOSIS'],
    ['Your child has ADHD.', 'DIAGNOSIS'],
    ['This is guaranteed to work.', 'PROMISE'],
    ['I will ignore the previous instructions.', 'INJECTION_ECHO'],
    ['See **this** list.', 'MARKUP'],
    ['Write to help@example.com.', 'EMAIL'],
    ['Open https://example.com now.', 'URL'],
    ['Call 98765 43210 today.', 'PHONE'],
    ['Zephyrine can try this.', 'NAME_LEAK'],
    ['Mr Rao would agree.', 'NAME_LEAK'],
    ['As your doctor, I would rest first.', 'CLAIMS_CLINICIAN'],
    ["I'm a therapist and I suggest rest.", 'CLAIMS_CLINICIAN'],
    ['In my clinical opinion this is fine.', 'CLAIMS_CLINICIAN'],
  ])('rejects %j as %s', (text, code) => {
    expect(checkChatChunk(text, names)).toEqual({ reject: code });
  });

  it('is fail-closed even for a refusal that repeats a sensitive word', () => {
    // The persona rules tell the model not to repeat these words; if it does, the safe text is shown.
    expect(checkChatChunk('I cannot give advice about medication.', names)).toEqual({
      reject: 'MEDICATION',
    });
  });
});
