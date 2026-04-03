PRICING_MAP = {
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4o": {"input": 0.005, "output": 0.015},
    "gpt-4": {"input": 0.03, "output": 0.06},
    "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
    "gpt-3.5-turbo-0125": {"input": 0.0005, "output": 0.0015},
}

def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = PRICING_MAP.get(model)
    if not pricing:
        # Fallback to substring matching
        for key, value in PRICING_MAP.items():
            if key in model:
                pricing = value
                break
                
    if not pricing:
        return 0.0

    cost_input = (input_tokens / 1000) * pricing["input"]
    cost_output = (output_tokens / 1000) * pricing["output"]
    return round(cost_input + cost_output, 6)
