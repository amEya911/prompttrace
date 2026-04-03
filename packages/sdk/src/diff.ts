import { TraceMessage, DiffResult } from "./types";
import { estimateTokens } from "./tokenizer";
import { calculateCost } from "./cost";

export function compare(model: string, oldMessages: TraceMessage[], newMessages: TraceMessage[]): DiffResult {
  const oldBreakdown = estimateTokens(oldMessages, model, "");
  const newBreakdown = estimateTokens(newMessages, model, "");

  const oldTotal = oldBreakdown.systemTokens + oldBreakdown.historyTokens + oldBreakdown.userTokens;
  const newTotal = newBreakdown.systemTokens + newBreakdown.historyTokens + newBreakdown.userTokens;

  const oldCost = calculateCost(model, oldTotal, 0);
  const newCost = calculateCost(model, newTotal, 0);

  return {
    originalTokens: oldTotal,
    newTokens: newTotal,
    diffTokens: oldTotal - newTotal,
    originalCost: oldCost,
    newCost: newCost,
    diffCost: oldCost - newCost,
    projectedMonthlySavings: (oldCost - newCost) * 10000
  };
}
