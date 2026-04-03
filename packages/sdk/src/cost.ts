export const PRICING_MAP: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4": { input: 0.03, output: 0.06 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "gpt-3.5-turbo-0125": { input: 0.0005, output: 0.0015 },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match, otherwise try to substring map
  const pricing = PRICING_MAP[model] || Object.values(PRICING_MAP).find((_, idx) => model.includes(Object.keys(PRICING_MAP)[idx]));

  if (!pricing) {
    return 0;
  }

  // Cost map is usually per 1K tokens
  const costInput = (inputTokens / 1000) * pricing.input;
  const costOutput = (outputTokens / 1000) * pricing.output;
  return Number((costInput + costOutput).toFixed(6));
}
