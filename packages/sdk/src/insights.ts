import { TokenBreakdown, TraceInsight, ImpactSimulation } from "./types";
import { calculateCost } from "./cost";

export function generateInsights(
  breakdown: TokenBreakdown,
  totalTokens: number,
  cacheHits: number,
  model: string
): { insights: TraceInsight[], simulations: ImpactSimulation[] } {
  const insights: TraceInsight[] = [];
  const simulations: ImpactSimulation[] = [];

  const sysPct = totalTokens > 0 ? (breakdown.systemTokens / totalTokens) : 0;
  const histPct = totalTokens > 0 ? (breakdown.historyTokens / totalTokens) : 0;

  if (breakdown.systemTokens > 500) {
    const tokensToRemove = Math.floor(breakdown.systemTokens * 0.4); // Assuming 40% bloat
    const costSavings = calculateCost(model, tokensToRemove, 0);

    insights.push({
      type: "warning",
      message: `System prompt is ${breakdown.systemTokens} tokens (${(sysPct * 100).toFixed(0)}% of total). You can reduce ~${tokensToRemove} tokens by removing redundant instructions.`,
      severity: 2
    });

    simulations.push({
      scenario: "Trim System Prompt by 40%",
      potentialSavingsTokens: tokensToRemove,
      potentialSavingsCost: costSavings,
      projectedMonthlySavings: costSavings * 10000
    });
  }

  if (breakdown.historyTokens > 1000 || histPct > 0.6) {
    const tokensToRemove = Math.floor(breakdown.historyTokens * 0.5); // Trim half history
    const costSavings = calculateCost(model, tokensToRemove, 0);

    insights.push({
      type: "warning",
      message: `Context bloat detected. History is ${breakdown.historyTokens} tokens (${(histPct * 100).toFixed(0)}% of total). Limit past messages to save tokens.`,
      severity: 3
    });

    simulations.push({
      scenario: "Trim Chat History by 50%",
      potentialSavingsTokens: tokensToRemove,
      potentialSavingsCost: costSavings,
      projectedMonthlySavings: costSavings * 10000
    });
  }

  if (cacheHits > 1) {
    insights.push({
      type: "warning",
      message: `Prompt sent ${cacheHits + 1} times. Caching this response could save 100% of the cost for repeat runs.`,
      severity: 3
    });
  }

  if (totalTokens > 4000) {
    insights.push({
      type: "info",
      message: `Large prompt detected (${totalTokens} tokens). Splitting or routing to a smaller model could reduce costs.`,
      severity: 1
    });
  }

  return { insights, simulations };
}
