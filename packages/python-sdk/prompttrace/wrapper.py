import time
import json
import hashlib
import uuid
import asyncio
from typing import Any, Dict, Optional

from .tokenizer import estimate_tokens
from .cost import calculate_cost
from .insights import generate_insights
from .storage import StorageEngine
from .types import TraceRecord

def _build_trace_and_save(params: dict, response: Any, latency: int, cache_hits: int, prompt_hash: str, config: dict, storage: StorageEngine):
    model = params.get("model", "unknown")
    messages = params.get("messages", [])
    
    # Parse output and usage from openai structure
    output_text = ""
    try:
        output_text = response.choices[0].message.content or ""
    except:
        pass

    api_usage = getattr(response, "usage", None)

    breakdown = estimate_tokens(messages, model, output_text)

    if api_usage and hasattr(api_usage, "prompt_tokens") and api_usage.prompt_tokens is not None:
        input_tokens = api_usage.prompt_tokens
        output_tokens = getattr(api_usage, "completion_tokens", breakdown.outputTokens)
        total_tokens = getattr(api_usage, "total_tokens", input_tokens + output_tokens)
    else:
        input_tokens = breakdown.systemTokens + breakdown.historyTokens + breakdown.userTokens
        output_tokens = breakdown.outputTokens
        total_tokens = input_tokens + output_tokens

    cost = calculate_cost(model, input_tokens, output_tokens)
    projected_monthly_cost = cost * 10000

    insights, simulations = generate_insights(breakdown, total_tokens, cache_hits, model)

    response_id = getattr(response, "id", str(uuid.uuid4()))

    trace = TraceRecord(
        id=response_id,
        model=model,
        messages=messages,
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        totalTokens=total_tokens,
        cost=cost,
        projectedMonthlyCost=projected_monthly_cost,
        latency=latency,
        timestamp=int(time.time() * 1000),
        breakdown=breakdown.__dict__,
        insights=insights,
        impactSimulations=simulations,
        cacheHits=cache_hits,
        promptHash=prompt_hash
    )

    trace_dict = trace.__dict__

    if config.get("log", True):
        print(f"\n[Prompttrace] 🔬 Trace Log")
        print(f"Model:      {model}")
        print(f"Tokens:     {total_tokens} (input: {input_tokens}, output: {output_tokens})")
        print(f"Cost:       ${cost:.5f}")
        print(f"\033[91mProjected:  ${projected_monthly_cost:.2f} / month (at 10k calls)\033[0m\n")

    if config.get("store") != "none":
        storage.save_trace(trace_dict)


def trace_llm(client: Any, config: Optional[Dict[str, Any]] = None):
    """
    Wraps the synchronous OpenAI Python client to trace completions locally.
    """
    config = config or {}
    storage = StorageEngine()
    
    original_create = client.chat.completions.create

    def sync_wrapper(*args, **kwargs):
        start_time = int(time.time() * 1000)
        messages = kwargs.get("messages", [])
        prompt_string = json.dumps(messages, sort_keys=True)
        prompt_hash = hashlib.sha256(prompt_string.encode('utf-8')).hexdigest()
        cache_hits = storage.register_and_get_hit_count(prompt_hash)
        
        try:
            response = original_create(*args, **kwargs)
            latency = int(time.time() * 1000) - start_time
            _build_trace_and_save(kwargs, response, latency, cache_hits, prompt_hash, config, storage)
            return response
        except Exception as e:
            print("[Prompttrace] Error intercepting chat completion", e)
            raise

    client.chat.completions.create = sync_wrapper
    return client

def trace_llm_async(client: Any, config: Optional[Dict[str, Any]] = None):
    """
    Wraps the AsyncOpenAI Python client to trace completions locally safely.
    """
    config = config or {}
    storage = StorageEngine()

    original_create = client.chat.completions.create

    async def async_wrapper(*args, **kwargs):
        start_time = int(time.time() * 1000)
        messages = kwargs.get("messages", [])
        prompt_string = json.dumps(messages, sort_keys=True)
        prompt_hash = hashlib.sha256(prompt_string.encode('utf-8')).hexdigest()
        cache_hits = storage.register_and_get_hit_count(prompt_hash)
        
        try:
            response = await original_create(*args, **kwargs)
            latency = int(time.time() * 1000) - start_time
            _build_trace_and_save(kwargs, response, latency, cache_hits, prompt_hash, config, storage)
            return response
        except Exception as e:
            print("[Prompttrace] Error intercepting async chat completion", e)
            raise
    
    client.chat.completions.create = async_wrapper
    return client
