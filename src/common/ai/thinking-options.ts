export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface ChatThinking {
  /** Passed to `streamText` as `providerOptions`; undefined for a model with nothing to limit. */
  providerOptions?: { google: { thinkingConfig: Record<string, number | string> } };
  /**
   * Tokens added to `maxOutputTokens`. Gemini counts thinking tokens inside the output limit, so a limit of 400
   * for the visible reply can be spent entirely on thinking and leave no text (`finishReason: length`).
   */
  headroomTokens: number;
}

/** Thinking tokens a level may use on a model that takes a budget (Gemini 2.5), and the headroom for both kinds. */
const BUDGET: Record<ThinkingLevel, number> = { minimal: 0, low: 512, medium: 2048, high: 8192 };
const HEADROOM: Record<ThinkingLevel, number> = {
  minimal: 128,
  low: 512,
  medium: 2048,
  high: 4096,
};
/** The 2.5 Pro model cannot switch thinking off; 128 is its documented minimum. */
const PRO_25_MIN_BUDGET = 128;

/**
 * Per-model thinking limit for the guided chat (plan 0019 section 14). A chat reply is three to five plain
 * sentences: thinking only adds seconds and spends the output limit. Measured on `gemini-3.5-flash`: a bare "hi"
 * used 407 thinking tokens of a 400-token limit and returned no text at all. The two Gemini families take
 * different knobs, and the wrong one is an HTTP 400 (`thinkingBudget: 0` is refused by `gemini-3.5-flash-lite`):
 *
 * - `gemini-3*` takes `thinkingLevel`; `minimal` is the floor, except Pro, whose floor is `low`.
 * - `gemini-2.5*` takes `thinkingBudget` (tokens); Pro cannot go below 128.
 *
 * `override` (env `AI_CHAT_THINKING_LEVEL`) replaces the default level. Other providers and unknown Gemini ids
 * get no options: sending a field a model does not know is worse than leaving its default.
 */
export function chatThinking(
  provider: string,
  modelId: string,
  override?: ThinkingLevel,
): ChatThinking {
  if (provider !== 'google') return { headroomTokens: 0 };
  const id = modelId.toLowerCase();
  const pro = id.includes('-pro');

  if (/^gemini-3(\.\d+)?-/.test(id)) {
    const level: ThinkingLevel = override ?? (pro ? 'low' : 'minimal');
    const floor: ThinkingLevel = pro && level === 'minimal' ? 'low' : level;
    return {
      providerOptions: { google: { thinkingConfig: { thinkingLevel: floor } } },
      headroomTokens: HEADROOM[floor],
    };
  }
  if (/^gemini-2\.5-/.test(id)) {
    const level: ThinkingLevel = override ?? 'minimal';
    const budget = pro ? Math.max(BUDGET[level], PRO_25_MIN_BUDGET) : BUDGET[level];
    return {
      providerOptions: { google: { thinkingConfig: { thinkingBudget: budget } } },
      headroomTokens: Math.max(HEADROOM[level], budget),
    };
  }
  return { headroomTokens: 0 };
}
