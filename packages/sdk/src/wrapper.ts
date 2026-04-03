import crypto from 'crypto';
import { PrompttraceConfig, TraceRecord } from './types';
import { estimateTokens } from './tokenizer';
import { calculateCost } from './cost';
import { generateInsights } from './insights';
import { StorageEngine } from './storage';
import { analyzePromptAI } from './ai-analysis';

export function traceLLM(client: any, config: PrompttraceConfig = {}) {
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  const storage = new StorageEngine();

  client.chat.completions.create = async (params: any) => {
    const startTime = Date.now();
    const model = params.model;
    const messages = params.messages || [];

    // Create a hash of the prompt for redundancy checking
    const promptString = JSON.stringify(messages);
    const promptHash = crypto.createHash('sha256').update(promptString).digest('hex');
    const cacheHits = storage.registerAndGetHitCount(promptHash);

    try {
      const response = await originalCreate(params);
      const latency = Date.now() - startTime;

      const outputText = response.choices?.[0]?.message?.content || "";
      const apiUsage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const breakdown = estimateTokens(messages, model, outputText);

      const inputTokens = apiUsage.prompt_tokens || (breakdown.systemTokens + breakdown.historyTokens + breakdown.userTokens);
      const outputTokens = apiUsage.completion_tokens || breakdown.outputTokens;
      const totalTokens = apiUsage.total_tokens || (inputTokens + outputTokens);

      const cost = calculateCost(model, inputTokens, outputTokens);
      const projectedMonthlyCost = cost * 10000;

      const { insights, simulations } = generateInsights(breakdown, totalTokens, cacheHits, model);

      const traceParams: TraceRecord = {
        id: response.id || crypto.randomUUID(),
        model,
        messages,
        inputTokens,
        outputTokens,
        totalTokens,
        cost,
        projectedMonthlyCost,
        latency,
        timestamp: Date.now(),
        breakdown,
        insights,
        impactSimulations: simulations,
        cacheHits,
        promptHash
      };

      if (config.aiAnalysis) {
        const aiAnalysis = await analyzePromptAI(client, messages, breakdown);
        if (aiAnalysis) traceParams.aiAnalysis = aiAnalysis;
      }

      // Weaponized Console Error Logging
      if (config.log !== false) {
        console.log(`\n[Prompttrace] 🔬 Trace Log`);
        console.log(`Model:      ${model}`);
        console.log(`Tokens:     ${totalTokens} (input: ${inputTokens}, output: ${outputTokens})`);
        console.log(`Cost:       $${cost.toFixed(5)}`);
        console.log(`\x1b[31mProjected:  $${projectedMonthlyCost.toFixed(2)} / month (at 10k calls)\x1b[0m`);

        console.log(`\nBreakdown:`);
        console.log(`- System:  ${breakdown.systemTokens}${breakdown.systemTokens > 500 ? ' ⚠️' : ''}`);
        console.log(`- History: ${breakdown.historyTokens}${breakdown.historyTokens > 1000 ? ' ⚠️' : ''}`);
        console.log(`- User:    ${breakdown.userTokens}`);
        console.log(`- Cache:   ${cacheHits > 0 ? `${cacheHits} previous hits 🔁` : 'First seen'}`);

        if (insights.length > 0) {
          console.log(`\nInsights:`);
          insights.forEach(insight => console.log(`- ${insight.message}`));
        }

        if (simulations.length > 0) {
          console.log(`\n\x1b[32mImpact Simulation:\x1b[0m`);
          simulations.forEach(sim => {
            console.log(`- ${sim.scenario}: Save $${sim.projectedMonthlySavings.toFixed(2)}/mo`);
          });
        }
        console.log('\n');
      }

      if (config.store !== "none") {
        storage.saveTrace(traceParams);
      }

      return response;
    } catch (error) {
      console.error("[Prompttrace] Error intercepting chat completion", error);
      throw error;
    }
  };

  return client;
}
