import { TraceRecord, TraceInsight } from 'prompttrace';

export interface SmartSuggestion {
  icon: string;
  title: string;
  description: string;
  savingsEstimate: string;
  priority: number; // Higher = more important
}

/**
 * Maps detected trace issues to specific, actionable suggestions.
 * Returns suggestions sorted by priority (highest first).
 */
export function generateSuggestions(trace: TraceRecord): SmartSuggestion[] {
  const suggestions: SmartSuggestion[] = [];
  const { breakdown, totalTokens, cacheHits, impactSimulations } = trace;

  const sysPct = totalTokens > 0 ? breakdown.systemTokens / totalTokens : 0;
  const histPct = totalTokens > 0 ? breakdown.historyTokens / totalTokens : 0;

  // ─── System Prompt Bloat ──────────────────────────────
  if (breakdown.systemTokens > 500) {
    suggestions.push({
      icon: '✂️',
      title: 'Trim System Prompt',
      description: `Your system prompt uses ${breakdown.systemTokens} tokens (${Math.round(sysPct * 100)}% of total). Remove redundant instructions, examples, or constraints that the model already follows.`,
      savingsEstimate: `~${Math.round(breakdown.systemTokens * 0.4)} tokens (${Math.round(sysPct * 40)}% cost reduction)`,
      priority: breakdown.systemTokens > 1000 ? 10 : 7,
    });
  }

  // ─── History Bloat ────────────────────────────────────
  if (breakdown.historyTokens > 500 || histPct > 0.4) {
    suggestions.push({
      icon: '📜',
      title: 'Summarize Conversation History',
      description: `History is ${breakdown.historyTokens} tokens (${Math.round(histPct * 100)}% of total). Use a summarization step to compress past messages, or limit to the last N turns.`,
      savingsEstimate: `~${Math.round(breakdown.historyTokens * 0.5)} tokens`,
      priority: histPct > 0.6 ? 9 : 6,
    });
  }

  // ─── Caching Opportunity ──────────────────────────────
  if (cacheHits > 0) {
    suggestions.push({
      icon: '💾',
      title: 'Cache This Response',
      description: `This exact prompt has been sent ${cacheHits + 1} times. Implement local caching (Redis, in-memory, or file-based) to avoid redundant API calls.`,
      savingsEstimate: `100% of repeat calls ($${(trace.cost * cacheHits).toFixed(4)} so far)`,
      priority: cacheHits >= 3 ? 10 : 5,
    });
  }

  // ─── Model Downgrade ──────────────────────────────────
  if (trace.model.includes('gpt-4') && !trace.model.includes('mini') && totalTokens < 1000) {
    suggestions.push({
      icon: '🔄',
      title: 'Switch to a Smaller Model',
      description: `You're using ${trace.model} for a ${totalTokens}-token request. For simple tasks, gpt-4o-mini is 30× cheaper with comparable quality.`,
      savingsEstimate: `~90% cost reduction per request`,
      priority: 8,
    });
  }

  // ─── Large Request Splitting ──────────────────────────
  if (totalTokens > 4000) {
    suggestions.push({
      icon: '🔪',
      title: 'Split Into Smaller Requests',
      description: `This is a large request (${totalTokens.toLocaleString()} tokens). Consider breaking it into focused sub-tasks — this often improves both cost and output quality.`,
      savingsEstimate: `Variable (typically 20-40%)`,
      priority: 4,
    });
  }

  // ─── Output-Heavy Request ─────────────────────────────
  if (trace.outputTokens > trace.inputTokens * 2) {
    suggestions.push({
      icon: '📏',
      title: 'Constrain Output Length',
      description: `Output (${trace.outputTokens} tokens) is ${Math.round(trace.outputTokens / trace.inputTokens)}× your input. Add max_tokens or explicit length instructions to control generation.`,
      savingsEstimate: `~${Math.round(trace.outputTokens * 0.3)} output tokens`,
      priority: 3,
    });
  }

  // Sort by priority, highest first
  return suggestions.sort((a, b) => b.priority - a.priority);
}
