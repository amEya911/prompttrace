import { get_encoding, encoding_for_model } from 'tiktoken';
import { TraceMessage, TokenBreakdown } from './types';

export function estimateTokens(messages: TraceMessage[], model: string, outputText: string = ''): TokenBreakdown {
  try {
    // Attempt to get encoding for the specific model, fallback to cl100k_base
    let enc;
    try {
      enc = encoding_for_model(model as any);
    } catch {
      enc = get_encoding('cl100k_base');
    }

    let systemTokens = 0;
    let userTokens = 0;
    let historyTokens = 0;

    messages.forEach((msg, index) => {
      // Simple approximation for tokens (role + content)
      const tokenCount = enc.encode(msg.role + msg.content).length + 4; // Add format tokens

      if (msg.role === 'system') {
        systemTokens += tokenCount;
      } else if (msg.role === 'user' && index === messages.length - 1) {
        userTokens += tokenCount;
      } else {
        historyTokens += tokenCount;
      }
    });

    const outputTokens = enc.encode(outputText).length;
    
    // Remember to free the encoding!
    enc.free();

    return {
      systemTokens,
      userTokens,
      historyTokens,
      outputTokens
    };
  } catch (error) {
    console.error('[Prompttrace] Tokenizer error:', error);
    return {
      systemTokens: 0,
      userTokens: 0,
      historyTokens: 0,
      outputTokens: 0
    };
  }
}
