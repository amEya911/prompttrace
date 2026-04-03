import { TraceMessage, TokenBreakdown } from "./types";

/**
 * Standard AI analysis (Post-Send) — why is this prompt expensive?
 */
export async function analyzePromptAI(
  client: any,
  messages: TraceMessage[],
  breakdown: TokenBreakdown,
  model: string = "llama-3.1-8b-instant"
): Promise<string | undefined> {
  try {
    const analysisPrompt = `
You are a developer tool analyzing an LLM prompt for optimization.
Here is the prompt breakdown:
System Tokens: ${breakdown.systemTokens}
History Tokens: ${breakdown.historyTokens}
User Tokens: ${breakdown.userTokens}

Messages:
${JSON.stringify(messages, null, 2)}

Provide a very brief analysis (max 3 sentences) suggesting how to optimize this prompt for cost or performance.
`;

    const response = await client.chat.completions.create({
      model: model,
      messages: [{ role: "system", content: analysisPrompt }],
      max_tokens: 150,
      temperature: 0.1
    });

    return response.choices[0]?.message?.content || "No AI feedback generated.";
  } catch (error) {
    console.error('[Prompttrace] Post-send AI analysis failed:', error);
    return undefined;
  }
}

/**
 * Intelligent AI Refinement (Pre-Send / Recommendation)
 * 
 * Takes a raw prompt and uses an LLM to prune, deduplicate, and refine it
 * while preserving the core intent.
 */
export async function refinePromptWithAI(
  client: any,
  text: string,
  model: string,
  logger?: (msg: string) => void
): Promise<{ refinedContent: string; reasoning: string } | undefined> {
  const log = (msg: string) => logger?.(`[SDK-AI] ${msg}`);
  
  if (!model) {
    log('❌ Error: No model provided to refinePromptWithAI');
    return undefined;
  }

  try {
    log(`Sending refinement request to [${model}] for text: "${text.substring(0, 50)}..."`);
    
    const refinementPrompt = `
You are an expert Prompt Engineer for Prompttrace.
The user has provided a prompt that may have context bloat or repetitions.

IMPORTANT: You MUST return a JSON object. The response should only contain the JSON.

TASK:
1. Identify inline repetitions and redundant instructions.
2. Rewrite the prompt to be maximally efficient for token cost.
3. Keep ALL core variables (e.g. {{name}}).
4. Output ONLY a valid JSON object with:
   - "refinedContent": The new, optimized text.
   - "reasoning": A 1-sentence explanation of what you removed and why (e.g., "Collapsed 18 repetitions to reduce context window").

JSON SCHEMA:
{
  "refinedContent": "...",
  "reasoning": "..."
}
`;

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: refinementPrompt },
        { role: "user", content: `PROMPT TO OPTIMIZE:\n"""\n${text}\n"""` }
      ],
      max_tokens: 2000,
      temperature: 0.0
    });

    const rawContent = response.choices[0]?.message?.content || "{}";
    log(`Raw Response: ${rawContent.substring(0, 500)}${rawContent.length > 500 ? '...' : ''}`);
    
    // Surgical JSON extraction
    let cleanedContent = rawContent;
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedContent = jsonMatch[0];
    }
    
    let result: any = {};
    try {
      result = JSON.parse(cleanedContent);
    } catch (e) {
      log(`❌ JSON Parse Error: ${e instanceof Error ? e.message : 'Unknown Error'}`);
      return undefined;
    }

    // Key Aliasing for resilient extraction
    const refinedText = result.refinedContent || result.text || result.content || result.refined_content;
    const explanation = result.reasoning || result.explanation || result.reason || result.message || "Intelligently optimized for cost.";

    if (refinedText && (refinedText !== text)) {
      log(`✅ Refined prompt generated (${refinedText.length} chars).`);
      return {
        refinedContent: refinedText,
        reasoning: explanation
      };
    }

    log(`⚠️ No significant refinement suggested by the model.`);
    return undefined;
  } catch (error) {
    log(`❌ Error calling AI refinement model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return undefined;
  }
}
