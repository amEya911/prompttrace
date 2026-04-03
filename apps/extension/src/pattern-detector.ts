import { TraceRecord } from 'prompttrace';

export interface PatternInfo {
  hash: string;
  count: number;
  totalCost: number;
  model: string;
  /** First few chars of the system prompt for labeling */
  label: string;
  /** Percentage of total cost this pattern represents */
  costPercent: number;
}

/**
 * Detects repeated patterns across traces.
 * Groups by promptHash and by system prompt content.
 */
export function detectPatterns(traces: TraceRecord[]): {
  repeatedPrompts: PatternInfo[];
  repeatedSystemPrompts: PatternInfo[];
  topCostContributors: PatternInfo[];
} {
  if (traces.length === 0) {
    return { repeatedPrompts: [], repeatedSystemPrompts: [], topCostContributors: [] };
  }

  const totalCost = traces.reduce((s, t) => s + t.cost, 0);

  // ─── Group by promptHash ──────────────────────────────
  const hashMap = new Map<string, { count: number; cost: number; model: string; label: string }>();
  traces.forEach((t) => {
    const existing = hashMap.get(t.promptHash);
    const userMsg = t.messages.find((m) => m.role === 'user');
    const label = userMsg
      ? userMsg.content.slice(0, 40).replace(/\n/g, ' ')
      : t.model;

    if (existing) {
      existing.count++;
      existing.cost += t.cost;
    } else {
      hashMap.set(t.promptHash, { count: 1, cost: t.cost, model: t.model, label });
    }
  });

  const repeatedPrompts: PatternInfo[] = [];
  const topCostContributors: PatternInfo[] = [];

  hashMap.forEach((v, hash) => {
    const info: PatternInfo = {
      hash,
      count: v.count,
      totalCost: v.cost,
      model: v.model,
      label: v.label,
      costPercent: totalCost > 0 ? Math.round((v.cost / totalCost) * 100) : 0,
    };
    topCostContributors.push(info);
    if (v.count > 1) {
      repeatedPrompts.push(info);
    }
  });

  // Sort by cost descending
  topCostContributors.sort((a, b) => b.totalCost - a.totalCost);
  repeatedPrompts.sort((a, b) => b.count - a.count);

  // ─── Group by system prompt content ───────────────────
  const sysMap = new Map<string, { count: number; cost: number; model: string; content: string }>();
  traces.forEach((t) => {
    const sysMsg = t.messages.find((m) => m.role === 'system');
    if (!sysMsg) return;
    const key = sysMsg.content.slice(0, 200); // Use first 200 chars as key
    const existing = sysMap.get(key);
    if (existing) {
      existing.count++;
      existing.cost += t.cost;
    } else {
      sysMap.set(key, { count: 1, cost: t.cost, model: t.model, content: sysMsg.content });
    }
  });

  const repeatedSystemPrompts: PatternInfo[] = [];
  sysMap.forEach((v, key) => {
    if (v.count > 1) {
      repeatedSystemPrompts.push({
        hash: key.slice(0, 20),
        count: v.count,
        totalCost: v.cost,
        model: v.model,
        label: `System: "${key.slice(0, 50)}..."`,
        costPercent: totalCost > 0 ? Math.round((v.cost / totalCost) * 100) : 0,
      });
    }
  });
  repeatedSystemPrompts.sort((a, b) => b.count - a.count);

  return {
    repeatedPrompts,
    repeatedSystemPrompts,
    topCostContributors: topCostContributors.slice(0, 5),
  };
}
