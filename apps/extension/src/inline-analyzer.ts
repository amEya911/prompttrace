import { calculateCost, optimizePrompt } from 'prompttrace';

// ─── Types ──────────────────────────────────────────────

export type PromptIntent =
  | 'refactor'
  | 'explain'
  | 'generate'
  | 'fix'
  | 'review'
  | 'translate'
  | 'summarize'
  | 'general';

export type AnalysisSeverity = 'ok' | 'info' | 'warning' | 'critical';

export interface InlineAnalysisResult {
  /** Original text analyzed */
  text: string;
  /** Estimated token count */
  tokens: number;
  /** Estimated cost for a single request (input-only) */
  cost: number;
  /** Projected monthly cost at 10k calls */
  projectedMonthlyCost: number;
  /** Model used for cost estimation */
  model: string;
  /** Severity classification */
  severity: AnalysisSeverity;
  /** Detected prompt intent */
  intent: PromptIntent;
  /** Confidence that this is actually a prompt (0-1) */
  confidence: number;
  /** Actionable warnings */
  warnings: string[];
  /** Optimization available? */
  optimization: {
    available: boolean;
    /** Tokens after optimization */
    optimizedTokens: number;
    /** Savings percentage */
    savingsPercent: number;
    /** Optimized text preview (first 200 chars) */
    preview: string;
    /** Full optimized text */
    optimizedText: string;
  };
  /** Contextual suggestions based on intent + size */
  suggestions: string[];
  /** AI Refined prompt (added asynchronously) */
  refinedPrompt?: {
    text: string;
    reasoning: string;
    tokens: number;
    savingsPercent: number;
  };
  /** Timestamp */
  timestamp: number;
}

// ─── Intent Detection ───────────────────────────────────

const INTENT_PATTERNS: { intent: PromptIntent; patterns: RegExp[] }[] = [
  {
    intent: 'refactor',
    patterns: [
      /\b(refactor|restructure|reorganize|clean\s*up|rewrite|improve\s+the\s+code)\b/i,
    ],
  },
  {
    intent: 'explain',
    patterns: [
      /\b(explain|what\s+(is|does|are)|how\s+(does|do|to)|why\s+(does|is|do)|describe|walk\s*through)\b/i,
    ],
  },
  {
    intent: 'generate',
    patterns: [
      /\b(generate|create|write|build|make|implement|add|scaffold|set\s*up)\b/i,
    ],
  },
  {
    intent: 'fix',
    patterns: [
      /\b(fix|debug|solve|resolve|troubleshoot|not\s+working|error|bug|broken|issue)\b/i,
    ],
  },
  {
    intent: 'review',
    patterns: [
      /\b(review|check|audit|analyze|look\s+at|evaluate|assess|feedback)\b/i,
    ],
  },
  {
    intent: 'translate',
    patterns: [
      /\b(translate|convert|port|migrate|transform)\s+(to|from|into)\b/i,
    ],
  },
  {
    intent: 'summarize',
    patterns: [
      /\b(summarize|summary|tldr|tl;dr|condense|brief|overview)\b/i,
    ],
  },
];

function detectIntent(text: string): PromptIntent {
  const lower = text.toLowerCase();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (p.test(lower)) return intent;
    }
  }
  return 'general';
}

// ─── Shared Token Estimation ────────────────────────────
// This is the single source of truth for lightweight token
// estimation across the entire extension. token-counter.ts
// delegates to this function.

/**
 * Lightweight token estimation using word-based approximation.
 * Average GPT tokenizer ratio: ~1.33 tokens per English word.
 * Also accounts for code tokens (punctuation, brackets, etc.)
 */
export function estimateTokensFromText(text: string): number {
  if (!text || text.length === 0) return 0;

  // Count words
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;

  // Count special characters (each typically becomes its own token)
  const specials = (
    text.match(/[{}()\[\]<>;:,.\"'`~!@#$%^&*+=|\\/?-]/g) || []
  ).length;

  // Approximate: words * 1.33 + special chars * 0.5
  return Math.round(words * 1.33 + specials * 0.5);
}

// ─── Severity Classification ────────────────────────────

const THRESHOLDS = {
  /** Below this: don't even show analysis */
  MINIMUM_TOKENS: 0,
  /** Above this: ok / info */
  INFO_TOKENS: 500,
  /** Above this: warning */
  WARNING_TOKENS: 1500,
  /** Above this: critical — trigger intervention */
  CRITICAL_TOKENS: 3000,
  /** Cost threshold for warning */
  COST_WARNING: 0.005,
  /** Cost threshold for critical */
  COST_CRITICAL: 0.02,
};

function classifySeverity(tokens: number, cost: number): AnalysisSeverity {
  if (tokens >= THRESHOLDS.CRITICAL_TOKENS || cost >= THRESHOLDS.COST_CRITICAL) {
    return 'critical';
  }
  if (tokens >= THRESHOLDS.WARNING_TOKENS || cost >= THRESHOLDS.COST_WARNING) {
    return 'warning';
  }
  if (tokens >= THRESHOLDS.INFO_TOKENS) {
    return 'info';
  }
  return 'ok';
}

// ─── Suggestion Generator ───────────────────────────────

function generatePreSendSuggestions(
  tokens: number,
  intent: PromptIntent,
  text: string
): string[] {
  const suggestions: string[] = [];

  // Intent-specific suggestions
  if (intent === 'explain' && tokens > 800) {
    suggestions.push(
      '💡 For explanations, specificity reduces output. Pin down exactly what confuses you.'
    );
  }
  if (intent === 'generate' && tokens > 1200) {
    suggestions.push(
      '💡 Large generation prompts work better when split into focused sub-tasks.'
    );
  }
  if (intent === 'refactor' && tokens > 2000) {
    suggestions.push(
      '💡 Refactor requests with full file context are expensive. Highlight only the relevant section.'
    );
  }
  if (intent === 'fix' && tokens > 1500) {
    suggestions.push(
      '💡 Include only the error message + relevant code. Full files add cost without helping.'
    );
  }
  if (intent === 'review' && tokens > 2000) {
    suggestions.push(
      '💡 For code review, send focused diffs instead of entire files to cut cost by 60%+.'
    );
  }

  // Size-based suggestions
  if (tokens > 3000) {
    suggestions.push(
      '⚠️ Before sending: this prompt is in the top 5% by size. Consider trimming context.'
    );
  }
  if (tokens > 1500 && tokens <= 3000) {
    suggestions.push(
      '💸 You can likely trim ~30% without losing quality. Remove boilerplate instructions.'
    );
  }

  // Content-based heuristics
  const repeatedLines = detectRepeatedContent(text);
  if (repeatedLines > 0) {
    suggestions.push(
      `🔁 Found ~${repeatedLines} repeated/similar lines. Deduplicating saves tokens.`
    );
  }

  // Filler detection
  const fillerCount = countFillerPhrases(text);
  if (fillerCount > 2) {
    suggestions.push(
      `✂️ ${fillerCount} filler phrases detected ("please", "could you", etc.) — removing these saves ~${fillerCount * 3} tokens.`
    );
  }

  return suggestions;
}

function detectRepeatedContent(text: string): number {
  const lines = text.split('\n').filter((l) => l.trim().length > 20);
  const seen = new Set<string>();
  let dupes = 0;
  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    if (seen.has(normalized)) dupes++;
    seen.add(normalized);
  }
  return dupes;
}

function countFillerPhrases(text: string): number {
  const fillers = [
    'please',
    'could you',
    'would you mind',
    'thank you',
    'thanks in advance',
    'i was wondering',
    "i'm sorry",
    'hello there',
    'hi there',
    'kindly',
    'if possible',
  ];
  let count = 0;
  const lower = text.toLowerCase();
  for (const filler of fillers) {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi');
    const matches = lower.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

// ─── Core Analysis Function ─────────────────────────────

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Analyze raw text as if it were about to be sent as a prompt.
 * Returns token estimate, cost, severity, intent, optimization preview,
 * and actionable suggestions — all computed synchronously in <5ms.
 */
export function analyzeInlinePrompt(
  text: string,
  model: string = DEFAULT_MODEL
): InlineAnalysisResult | null {
  if (!text || text.trim().length === 0) return null;

  const trimmed = text.trim();
  const tokens = estimateTokensFromText(trimmed);

  // Skip trivially small inputs
  if (tokens < THRESHOLDS.MINIMUM_TOKENS) return null;

  const cost = calculateCost(model, tokens, 0);
  const projectedMonthlyCost = cost * 10000;
  const severity = classifySeverity(tokens, cost);
  const intent = detectIntent(trimmed);
  const confidence = computeConfidence(trimmed, tokens);

  // Run optimization
  const messages = [{ role: 'user', content: trimmed }];
  const optimizedMessages = optimizePrompt(messages);
  const optimizedText = optimizedMessages
    .map(m => m.content)
    .join('\n')
    .trim();
  const optimizedTokens = estimateTokensFromText(optimizedText);
  const savingsPercent =
    tokens > 0 ? Math.round(((tokens - optimizedTokens) / tokens) * 100) : 0;

  const warnings: string[] = [];
  if (severity === 'critical') {
    warnings.push(
      `🚨 This prompt will cost ~$${cost.toFixed(4)} per send — $${projectedMonthlyCost.toFixed(2)}/mo at scale`
    );
  }
  if (severity === 'warning') {
    warnings.push(
      `⚠️ ${tokens.toLocaleString()} tokens is heavier than necessary for most tasks`
    );
  }
  if (savingsPercent >= 15) {
    warnings.push(
      `✂️ Prompttrace can trim ${savingsPercent}% — saving ~${tokens - optimizedTokens} tokens per request`
    );
  }

  const suggestions = generatePreSendSuggestions(tokens, intent, trimmed);

  return {
    text: trimmed,
    tokens,
    cost,
    projectedMonthlyCost,
    model,
    severity,
    intent,
    confidence,
    warnings,
    optimization: {
      available: savingsPercent >= 5,
      optimizedTokens,
      savingsPercent,
      preview:
        optimizedText.length > 200
          ? optimizedText.slice(0, 200) + '…'
          : optimizedText,
      optimizedText,
    },
    suggestions,
    timestamp: Date.now(),
  };
}

// ─── Confidence Scoring ─────────────────────────────────

/**
 * Compute a confidence score (0-1) that this text is actually
 * a prompt intended for an LLM, not regular code or notes.
 *
 * Signals:
 * - Contains instruction verbs → +0.25
 * - Contains questions → +0.15
 * - Contains code blocks with surrounding text → +0.20
 * - Is in a "prompt-like" length range (50-5000 tokens) → +0.10
 * - Has role markers ("you are", "as a") → +0.20
 * - Contains output format instructions → +0.10
 */
function computeConfidence(text: string, tokens: number): number {
  let score = 0;
  const lower = text.toLowerCase();

  // Instruction verbs
  if (
    /\b(write|explain|fix|generate|create|refactor|implement|build|make|add|summarize|review|optimize|convert|translate|debug|describe|analyze)\b/i.test(
      text
    )
  ) {
    score += 0.25;
  }

  // Questions
  if (/\?/.test(text) || /\b(what|how|why|when|where|can you|could you)\b/i.test(text)) {
    score += 0.15;
  }

  // Code blocks with surrounding instruction text
  if (/```[\s\S]*```/.test(text) && text.replace(/```[\s\S]*?```/g, '').trim().length > 30) {
    score += 0.20;
  }

  // Prompt-like length
  if (tokens >= 50 && tokens <= 5000) {
    score += 0.10;
  }

  // Role markers
  if (/\b(you are|as a|act as|your role|your task|your job)\b/i.test(text)) {
    score += 0.20;
  }

  // Output format instructions
  if (
    /\b(format|output|return|respond|response|json|markdown|list|table|bullet)\b/i.test(
      text
    )
  ) {
    score += 0.10;
  }

  return Math.min(score, 1.0);
}

// Re-export thresholds so other modules can use them
export { THRESHOLDS };
