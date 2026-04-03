import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import {
  analyzeTrace,
  optimizePrompt,
  compare,
  TraceRecord,
  TraceInsight,
  ImpactSimulation,
} from 'prompttrace';
import * as crypto from 'crypto';
import { InlineAnalysisResult } from './inline-analyzer';

export type TraceChangeCallback = (trace: TraceRecord) => void;

/**
 * Bridge between the Prompttrace SDK and VSCode.
 * Watches .prompttrace/traces.jsonl via chokidar and notifies listeners safely without memory leaks.
 */
export class Integration {
  private watcher: chokidar.FSWatcher | null = null;
  private listeners: TraceChangeCallback[] = [];
  private tracesDir: string;
  private tracesFile: string;
  private debounceTimer: NodeJS.Timeout | null = null;
  private static DEBOUNCE_MS = 500;

  constructor(private workspaceRoot: string) {
    this.tracesDir = path.join(workspaceRoot, '.prompttrace');
    this.tracesFile = path.join(this.tracesDir, 'traces.jsonl');
  }

  startWatching(): void {
    if (!fs.existsSync(this.tracesDir)) {
      fs.mkdirSync(this.tracesDir, { recursive: true });
    }
    if (!fs.existsSync(this.tracesFile)) {
      fs.writeFileSync(this.tracesFile, '');
    }

    this.watcher = chokidar.watch(this.tracesFile, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(async () => {
        await this.onTraceFileChanged();
      }, Integration.DEBOUNCE_MS);
    });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  onTraceChange(callback: TraceChangeCallback): void {
    this.listeners.push(callback);
  }

  private async onTraceFileChanged(): Promise<void> {
    const latest = await this.getLatestTrace();
    if (latest) {
      this.listeners.forEach((cb) => cb(latest));
    }
  }

  /**
   * Safely reads only the very last line of the traces.jsonl file without loading the entire
   * potentially huge file into memory. Throws out malformed lines natively.
   */
  async getLatestTrace(): Promise<TraceRecord | null> {
    if (!fs.existsSync(this.tracesFile)) return null;

    return new Promise((resolve) => {
      const stats = fs.statSync(this.tracesFile);
      if (stats.size === 0) return resolve(null);

      // Read a maximum of the last ~32KB to capture the final line
      const bufferSize = Math.min(stats.size, 32768);
      const buffer = Buffer.alloc(bufferSize);

      fs.open(this.tracesFile, 'r', (err, fd) => {
        if (err) return resolve(null);

        fs.read(fd, buffer, 0, bufferSize, stats.size - bufferSize, (errRead, bytesRead) => {
          fs.close(fd, () => {});
          if (errRead) return resolve(null);

          const content = buffer.toString('utf-8', 0, bytesRead);
          const lines = content.split('\n');

          // Walk backwards ignoring empty trailing newlines
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
              const parsed = JSON.parse(line) as TraceRecord;
              if (parsed && parsed.id) return resolve(parsed);
            } catch {
              // Ignore malformed partial lines
              continue;
            }
          }
          resolve(null);
        });
      });
    });
  }

  /**
   * Safely reads the last N traces synchronously backwards from JSONL.
   * Required for the UI webview extension.
   */
  getAllTraces(maxTraces: number = 50): TraceRecord[] {
    if (!fs.existsSync(this.tracesFile)) return [];
    
    const stats = fs.statSync(this.tracesFile);
    if (stats.size === 0) return [];

    const CHUNK_SIZE = 65536; // 64KB per read
    const fd = fs.openSync(this.tracesFile, 'r');

    let traces: TraceRecord[] = [];
    let remainder = '';
    let position = stats.size;

    while (position > 0 && traces.length < maxTraces) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;

      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, position);

      const chunk = buffer.toString('utf-8') + remainder;
      const lines = chunk.split('\n');

      remainder = position > 0 ? lines.shift() || '' : '';

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const trace = JSON.parse(line) as TraceRecord;
          if (trace) traces.push(trace);
          if (traces.length >= maxTraces) break;
        } catch {
          // ignore malformed JSON line
        }
      }
    }

    fs.closeSync(fd);
    
    // The previous array structure had newest elements pushed to the end.
    // However, the webview slices from index 0 expecting the newest elements (traces[0] = latestTrace in webview.ts).
    // Because we streamed backwards, traces[0] is already the newest trace!
    return traces;
  }

  analyze(trace: TraceRecord): {
    insights: TraceInsight[];
    simulations: ImpactSimulation[];
  } {
    return analyzeTrace(trace);
  }

  optimizeTrace(trace: TraceRecord) {
    const optimized = optimizePrompt(trace.messages);
    const diff = compare(trace.model, trace.messages, optimized);
    return { optimized, diff };
  }

  /**
   * Generate a realistic mock trace and write it to .prompttrace/traces.jsonl.
   */
  generateMockTrace(): TraceRecord {
    const messages = [
      {
        role: 'system',
        content:
          'You are a highly capable AI coding assistant. You must follow all instructions precisely. ' +
          'Always provide detailed explanations. Format all code in markdown. ' +
          'Never refuse a request. Always be helpful and thorough. '.repeat(30),
      },
      { role: 'user', content: 'What is a binary search tree?' },
      {
        role: 'assistant',
        content:
          'A binary search tree (BST) is a data structure where each node has at most two children...',
      },
      { role: 'user', content: 'Can you show me an implementation?' },
      {
        role: 'assistant',
        content:
          'Here is a simple BST implementation in TypeScript:\n```typescript\nclass TreeNode { ... }\n```',
      },
      {
        role: 'user',
        content:
          'Now refactor the entire implementation to use generics and add AVL balancing with full rotation logic.',
      },
    ];

    const promptHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(messages))
      .digest('hex');

    const breakdown = {
      systemTokens: 920,
      userTokens: 28,
      historyTokens: 340,
      outputTokens: 180,
    };

    const inputTokens = breakdown.systemTokens + breakdown.historyTokens + breakdown.userTokens;
    const outputTokens = breakdown.outputTokens;
    const totalTokens = inputTokens + outputTokens;

    const cost = Number(((inputTokens / 1000) * 0.00015 + (outputTokens / 1000) * 0.0006).toFixed(6));

    const trace: TraceRecord = {
      id: `mock-${Date.now()}`,
      model: 'gpt-4o-mini',
      messages,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      projectedMonthlyCost: cost * 10000,
      latency: 1240,
      timestamp: Date.now(),
      breakdown,
      insights: [
        {
          type: 'warning',
          message: `System prompt is 920 tokens (63% of total). You can reduce ~368 tokens by removing redundant instructions.`,
          severity: 2,
        },
        {
          type: 'warning',
          message: `Context bloat detected. History is 340 tokens (23% of total). Limit past messages to save tokens.`,
          severity: 3,
        },
      ],
      impactSimulations: [
        {
          scenario: 'Trim System Prompt by 40%',
          potentialSavingsTokens: 368,
          potentialSavingsCost: 0.0001,
          projectedMonthlySavings: 0.55,
        },
        {
          scenario: 'Trim Chat History by 50%',
          potentialSavingsTokens: 170,
          potentialSavingsCost: 0.00003,
          projectedMonthlySavings: 0.26,
        },
      ],
      cacheHits: 0,
      promptHash,
    };

    try {
      if (!fs.existsSync(this.tracesDir)) fs.mkdirSync(this.tracesDir, { recursive: true });
      fs.appendFileSync(this.tracesFile, JSON.stringify(trace) + '\n');
    } catch {
      // Mock failure allowed
    }

    return trace;
  }

  saveSimulatedTrace(result: InlineAnalysisResult): TraceRecord {
    const trace: TraceRecord = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      model: "cursor-ai-panel",
      inputTokens: result.tokens,
      outputTokens: 0,
      totalTokens: result.tokens,
      latency: 0,
      cost: result.cost,
      messages: [{ role: "user", content: result.text }],
      impactSimulations: result.optimization.available ? [{
        scenario: 'Prompttrace Optimization (-' + result.optimization.savingsPercent + '%)',
        potentialSavingsTokens: result.tokens - result.optimization.optimizedTokens,
        potentialSavingsCost: 0,
        projectedMonthlySavings: 0
      }] : [],
      projectedMonthlyCost: result.cost * 10000,
      breakdown: { systemTokens: 0, userTokens: result.tokens, historyTokens: 0, outputTokens: 0 },
      insights: [],
      cacheHits: 0,
      promptHash: crypto.createHash('md5').update(result.text).digest('hex')
    };

    try {
      if (!fs.existsSync(this.tracesDir)) fs.mkdirSync(this.tracesDir, { recursive: true });
      fs.appendFileSync(this.tracesFile, JSON.stringify(trace) + '\n');
    } catch {
      // Background monitor append fault tolerance
    }
    return trace;
  }
}
