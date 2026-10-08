import { estimateCostMicroUsd } from './ai-pricing';

describe('estimateCostMicroUsd', () => {
  it('prices gemini-3.5-flash-lite at $0.30 / $2.50 per 1M tokens', () => {
    // 1.5k in + 300 out = 450 + 750 micro-USD = $0.0012
    expect(estimateCostMicroUsd('google', 'gemini-3.5-flash-lite', 1500, 300)).toBe(1200);
  });

  it('prices gemini-3.1-flash-lite at $0.25 / $1.50 per 1M tokens', () => {
    expect(estimateCostMicroUsd('google', 'gemini-3.1-flash-lite', 1000, 200)).toBe(550);
  });

  it('is null for an unknown model or missing usage', () => {
    expect(estimateCostMicroUsd('google', 'gemini-9', 10, 10)).toBeNull();
    expect(estimateCostMicroUsd('google', 'gemini-3.5-flash-lite', undefined, 10)).toBeNull();
    expect(estimateCostMicroUsd('google', 'gemini-3.5-flash-lite', 10, null)).toBeNull();
  });
});
