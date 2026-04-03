import math
from typing import Tuple, List
from .types import TokenBreakdown, TraceInsight, ImpactSimulation
from .cost import calculate_cost

def generate_insights(
    breakdown: TokenBreakdown, 
    total_tokens: int, 
    cache_hits: int,
    model: str
) -> Tuple[List[dict], List[dict]]:
    
    insights = []
    simulations = []

    sys_pct = float(breakdown.systemTokens) / total_tokens if total_tokens > 0 else 0.0
    hist_pct = float(breakdown.historyTokens) / total_tokens if total_tokens > 0 else 0.0

    if breakdown.systemTokens > 500:
        tokens_to_remove = math.floor(breakdown.systemTokens * 0.4)
        cost_savings = calculate_cost(model, tokens_to_remove, 0)
        
        insights.append(TraceInsight(
            type="warning",
            message=f"System prompt is {breakdown.systemTokens} tokens ({int(sys_pct * 100)}% of total). You can reduce ~{tokens_to_remove} tokens by removing redundant instructions.",
            severity=2
        ).__dict__)

        simulations.append(ImpactSimulation(
            scenario="Trim System Prompt by 40%",
            potentialSavingsTokens=tokens_to_remove,
            potentialSavingsCost=cost_savings,
            projectedMonthlySavings=cost_savings * 10000
        ).__dict__)

    if breakdown.historyTokens > 1000 or hist_pct > 0.6:
        tokens_to_remove = math.floor(breakdown.historyTokens * 0.5)
        cost_savings = calculate_cost(model, tokens_to_remove, 0)

        insights.append(TraceInsight(
            type="warning",
            message=f"Context bloat detected. History is {breakdown.historyTokens} tokens ({int(hist_pct * 100)}% of total). Limit past messages to save tokens.",
            severity=3
        ).__dict__)

        simulations.append(ImpactSimulation(
            scenario="Trim Chat History by 50%",
            potentialSavingsTokens=tokens_to_remove,
            potentialSavingsCost=cost_savings,
            projectedMonthlySavings=cost_savings * 10000
        ).__dict__)

    if cache_hits > 1:
        insights.append(TraceInsight(
            type="warning",
            message=f"Prompt sent {cache_hits + 1} times. Caching this response could save 100% of the cost for repeat runs.",
            severity=3
        ).__dict__)

    if total_tokens > 4000:
        insights.append(TraceInsight(
            type="info",
            message=f"Large prompt detected ({total_tokens} tokens). Splitting or routing to a smaller model could reduce costs.",
            severity=1
        ).__dict__)

    return insights, simulations
