import { chatThinking } from './thinking-options';

describe('chatThinking', () => {
  it.each(['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'])(
    'limits %s with thinkingLevel minimal (never thinkingBudget, which the 3.5 models refuse)',
    (id) => {
      expect(chatThinking('google', id)).toEqual({
        providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal' } } },
        headroomTokens: 128,
      });
    },
  );

  it('uses low for Gemini 3 Pro, whose floor is low', () => {
    expect(chatThinking('google', 'gemini-3.1-pro-preview').providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'low' } },
    });
    expect(chatThinking('google', 'gemini-3.1-pro-preview', 'minimal').providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'low' } },
    });
  });

  it('uses a token budget on Gemini 2.5: 0 for Flash, 128 (the minimum) for Pro', () => {
    expect(chatThinking('google', 'gemini-2.5-flash').providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(chatThinking('google', 'gemini-2.5-pro').providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 128 } },
    });
  });

  it('lets the override raise the level, with matching headroom for the output limit', () => {
    const t = chatThinking('google', 'gemini-3.5-flash', 'medium');
    expect(t.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: 'medium' } } });
    expect(t.headroomTokens).toBe(2048);
  });

  it('sends nothing for other providers and unknown Gemini ids', () => {
    expect(chatThinking('anthropic', 'claude-x')).toEqual({ headroomTokens: 0 });
    expect(chatThinking('openai', 'gpt-x')).toEqual({ headroomTokens: 0 });
    expect(chatThinking('google', 'gemini-flash-latest')).toEqual({ headroomTokens: 0 });
  });
});
