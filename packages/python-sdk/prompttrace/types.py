from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field

@dataclass
class TokenBreakdown:
    systemTokens: int = 0
    userTokens: int = 0
    historyTokens: int = 0
    outputTokens: int = 0

@dataclass
class TraceInsight:
    type: str  # "warning", "info", "success"
    message: str
    severity: int

@dataclass
class ImpactSimulation:
    scenario: str
    potentialSavingsTokens: int
    potentialSavingsCost: float
    projectedMonthlySavings: float

@dataclass
class TraceRecord:
    id: str
    model: str
    messages: List[Dict[str, str]]
    inputTokens: int
    outputTokens: int
    totalTokens: int
    cost: float
    projectedMonthlyCost: float
    latency: int
    timestamp: int
    breakdown: dict  # To easily serialize to dict
    insights: List[dict]
    impactSimulations: List[dict]
    cacheHits: int
    promptHash: str
    aiAnalysis: Optional[str] = None
