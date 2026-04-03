import fs from 'fs';
import path from 'path';
import { TraceRecord, TraceInsight, ImpactSimulation } from './types';
import { generateInsights } from './insights';

/**
 * Analyze a TraceRecord and return refreshed insights + simulations.
 * This is a convenience wrapper over the internal generateInsights engine
 * so consumers (e.g. the VSCode extension) can re-analyze any trace
 * without reimplementing the rules engine.
 */
export function analyzeTrace(trace: TraceRecord): {
  insights: TraceInsight[];
  simulations: ImpactSimulation[];
} {
  return generateInsights(
    trace.breakdown,
    trace.totalTokens,
    trace.cacheHits,
    trace.model
  );
}

/**
 * Read all stored traces from a .prompttrace directory using JSON lines backward streaming fallback.
 * @param dir - The directory containing traces.jsonl.
 * @returns Array of TraceRecord sorted newest-first limit to last 50.
 */
export function readTraces(dir?: string): TraceRecord[] {
  const tracesDir = dir || path.join(process.cwd(), '.prompttrace');
  const filePath = path.join(tracesDir, 'traces.jsonl');

  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const traces: TraceRecord[] = [];
    
    // Reverse memory parsing safely
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
        try { traces.push(JSON.parse(lines[i])); } catch {}
    }
    
    return traces;
  } catch {
    return [];
  }
}
