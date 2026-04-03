import tiktoken
from typing import List, Dict, Any
from .types import TokenBreakdown

def estimate_tokens(messages: List[Dict[str, str]], model: str, output_text: str = '') -> TokenBreakdown:
    try:
        try:
            enc = tiktoken.encoding_for_model(model)
        except KeyError:
            enc = tiktoken.get_encoding('cl100k_base')

        system_tokens = 0
        user_tokens = 0
        history_tokens = 0

        for idx, msg in enumerate(messages):
            role = msg.get("role", "")
            content = msg.get("content", "")
            
            # Simple approximation (role + content + 4 format tokens)
            token_count = len(enc.encode(role + content)) + 4

            if role == 'system':
                system_tokens += token_count
            elif role == 'user' and idx == len(messages) - 1:
                user_tokens += token_count
            else:
                history_tokens += token_count

        output_tokens = len(enc.encode(output_text))

        return TokenBreakdown(
            systemTokens=system_tokens,
            userTokens=user_tokens,
            historyTokens=history_tokens,
            outputTokens=output_tokens
        )
    except Exception as e:
        print(f"[Prompttrace] Tokenizer error: {e}")
        return TokenBreakdown(0, 0, 0, 0)
