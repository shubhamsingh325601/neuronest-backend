/** USD per 1M tokens, paid tier (plan 0018 Q2.5/Q2.6). The free tier still records the paid-equivalent. */
interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const PRICES: Record<string, ModelPrice> = {
  'google:gemini-3.5-flash-lite': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'google:gemini-3.1-flash-lite': { inputPerMTok: 0.25, outputPerMTok: 1.5 },
};

/**
 * Cost estimate in micro-USD (1 USD = 1,000,000). With prices quoted per 1M tokens, the price
 * in USD per 1M tokens is numerically the micro-USD price per token. Null for an unknown model
 * or when the provider returned no usage.
 */
export function estimateCostMicroUsd(
  provider: string,
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  const price = PRICES[`${provider}:${model}`];
  if (!price || inputTokens == null || outputTokens == null) return null;
  return Math.round(inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok);
}
