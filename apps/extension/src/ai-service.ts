import * as vscode from 'vscode';
import { refinePromptWithAI } from 'prompttrace';
import { estimateTokensFromText } from './inline-analyzer';

/**
 * Calls an LLM to refine a prompt using the user's VS Code settings.
 * Supports OpenAI-compatible endpoints (Groq, Ollama, OpenRouter, etc.)
 */
export async function getAIRefinedPrompt(text: string, logger?: vscode.OutputChannel): Promise<{ text: string; reasoning: string; tokens: number; savingsPercent: number } | undefined> {
  const log = (msg: string) => logger?.appendLine(`[AI-Service] ${msg}`);
  
  const config = vscode.workspace.getConfiguration('prompttrace');
  const apiKey = config.get<string>('apiKey') || '';
  const apiUrl = config.get<string>('apiUrl') || 'https://api.openai.com/v1';
  const model = config.get<string>('aiModel') || 'gpt-4o-mini';

  log(`Initializing AI refinement pass...`);
  log(`- API URL: ${apiUrl}`);
  log(`- Model: ${model}`);
  log(`- Key: ${apiKey ? `Present (${apiKey.substring(0, 8)}...)` : 'MISSING'}`);

  if (!apiKey && apiUrl.includes('openai.com')) {
    log('❌ Aborting: No API key provided for OpenAI-based refinement.');
    return undefined;
  }

  try {
    const mockClient = {
      chat: {
        completions: {
          create: async (params: any) => {
            const finalUrl = `${apiUrl}/chat/completions`.replace(/\/+chat\/completions$/, '/chat/completions');
            log(`- Calling: ${finalUrl}`);
            
            log(`- Payload: ${JSON.stringify(params)}`);
            const response = await fetch(finalUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify(params),
            });

            if (!response.ok) {
              const errBody = await response.text();
              log(`❌ API Error (${response.status}): ${errBody}`);
              throw new Error(`API returned ${response.status}: ${errBody}`);
            }

            log(`✅ AI Response received.`);
            return await response.json();
          }
        }
      }
    };

    const sdkRefinement = await refinePromptWithAI(
      mockClient,
      text,
      model,
      log
    );

    if (sdkRefinement) {
      const originalTokens = estimateTokensFromText(text);
      const refinedTokens = estimateTokensFromText(sdkRefinement.refinedContent);
      const savingsPercent = originalTokens > 0 
        ? Math.round(((originalTokens - refinedTokens) / originalTokens) * 100)
        : 0;

      log(`✅ Refinement complete: -${savingsPercent}% savings.`);
      return {
        text: sdkRefinement.refinedContent,
        reasoning: sdkRefinement.reasoning,
        tokens: refinedTokens,
        savingsPercent
      };
    } else {
      log('⚠️ SDK returned no refinement (likely model decided it was already optimal).');
    }
  } catch (err: any) {
    log(`❌ AI refinement exception: ${err.message}`);
  }

  return undefined;
}
