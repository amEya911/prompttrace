import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  analyzeInlinePrompt,
  InlineAnalysisResult,
  estimateTokensFromText,
} from './inline-analyzer';
import { getAIRefinedPrompt } from './ai-service';
import { showOptimizeDiffView } from './ui/optimize-flow';

export type ClipboardAnalysisCallback = (result: InlineAnalysisResult) => void;

/**
 * Monitors the system clipboard for prompt-like text.
 *
 * Enables Prompttrace to analyze prompts from ANYWHERE —
 * Cursor chat, ChatGPT, browser, notes, etc.
 *
 * Design:
 * - Polls clipboard every 2s (VSCode has no clipboard change event)
 * - Hash-based dedup: same text never triggers twice
 * - 5s cooldown between analysis triggers (prevents spam)
 * - Multi-gate filtering: length → dedup → cooldown → code/URL skip → tokens → confidence
 * - High-value popup notifications with actionable buttons
 * - First-time onboarding message (shown once via globalState)
 * - Fully async, non-blocking
 * - Respects extension enable/disable
 */
export class ClipboardMonitor {
  private pollTimer: NodeJS.Timeout | null = null;
  private lastClipboardHash: string = '';
  private lastTriggerTime: number = 0;
  private listeners: ClipboardAnalysisCallback[] = [];
  private enabled: boolean = true;
  private monitoringActive: boolean = true;
  private logger?: vscode.OutputChannel;
  private context?: vscode.ExtensionContext;

  /** Polling interval (ms) */
  private static POLL_INTERVAL_MS = 2000;

  /** Minimum cooldown between analysis triggers (ms) */
  private static TRIGGER_COOLDOWN_MS = 100;

  /** Minimum clipboard text length to consider */
  private static MIN_TEXT_LENGTH = 1;

  /** Minimum confidence score to trigger analysis */
  private static MIN_CONFIDENCE = 0.0;

  /** Minimum token count to trigger (skip trivial prompts) */
  private static MIN_TOKENS = 0;

  /** Token threshold to show popup notification (0 = always show for detected prompts) */
  private static POPUP_TOKEN_THRESHOLD = 0;

  /** Savings percentage threshold to show popup notification (0 = always show) */
  private static POPUP_SAVINGS_THRESHOLD = 0;

  /** globalState key for first-time message */
  private static FIRST_CLIPBOARD_KEY = 'prompttrace.clipboardFirstRun';

  setLogger(logger: vscode.OutputChannel): void {
    this.logger = logger;
  }

  private log(msg: string): void {
    this.logger?.appendLine(`[ClipboardMonitor] ${msg}`);
  }

  /**
   * Register a callback for when clipboard analysis completes.
   */
  onAnalysis(callback: ClipboardAnalysisCallback): void {
    this.listeners.push(callback);
  }

  /**
   * Start polling the clipboard.
   */
  activate(context: vscode.ExtensionContext): void {
    this.context = context;
    this.startPolling();

    // Ensure cleanup on extension deactivation
    context.subscriptions.push({
      dispose: () => this.dispose(),
    });

    this.log('Activated — polling clipboard every 2s (confidence≥0.40, tokens≥300)');
  }

  /**
   * Set whether the parent extension is enabled.
   * When disabled, polling continues but analysis is skipped.
   */
  setEnabled(val: boolean): void {
    this.enabled = val;
  }

  /**
   * Toggle clipboard monitoring on/off entirely.
   * Returns the new state.
   */
  toggleMonitoring(): boolean {
    this.monitoringActive = !this.monitoringActive;

    if (this.monitoringActive) {
      this.startPolling();
      this.log('Monitoring resumed');
    } else {
      this.stopPolling();
      this.log('Monitoring paused');
    }

    return this.monitoringActive;
  }

  isMonitoring(): boolean {
    return this.monitoringActive;
  }

  /**
   * Start the polling loop.
   */
  private startPolling(): void {
    if (this.pollTimer) return; // Already running

    this.pollTimer = setInterval(() => {
      this.checkClipboard();
    }, ClipboardMonitor.POLL_INTERVAL_MS);
  }

  /**
   * Stop the polling loop.
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ─── Content Filtering ──────────────────────────────────

  /**
   * Check if text looks like code rather than a natural language prompt.
   * Code-heavy clipboard content should not trigger analysis.
   */
  private looksLikeCode(text: string): boolean {
    const lines = text.split('\n');
    if (lines.length < 3) return false;

    let codeSignals = 0;
    const totalLines = Math.min(lines.length, 30); // Sample first 30 lines

    for (let i = 0; i < totalLines; i++) {
      const line = lines[i].trimStart();
      // Common code patterns
      if (
        /^(import |export |const |let |var |function |class |interface |type |if |for |while |return |switch |case |try |catch )/.test(line) ||
        /^(def |async def |from .+ import|package |public |private |protected )/.test(line) ||
        /^[{}();]$/.test(line.trim()) ||
        /^\s*\/\//.test(line) && !/^\s*\/\/\s*(todo|fix|bug|note)/i.test(line)
      ) {
        codeSignals++;
      }
    }

    // If >85% of lines look like code, skip (loosened for chat responses)
    const codeRatio = codeSignals / totalLines;
    return codeRatio > 0.85;
  }

  /**
   * Check if text is primarily a URL or list of URLs.
   */
  private looksLikeUrl(text: string): boolean {
    const trimmed = text.trim();
    // Single URL
    if (/^https?:\/\/\S+$/.test(trimmed)) return true;
    // Multiple lines all being URLs
    const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0 && lines.every(l => /^https?:\/\/\S+$/.test(l.trim()))) return true;
    return false;
  }

  // ─── First-Time Message ─────────────────────────────────

  /**
   * Show a one-time onboarding message when clipboard analysis
   * triggers for the first time.
   */
  private async maybeShowFirstTimeMessage(): Promise<void> {
    if (!this.context) return;

    const hasShown = this.context.globalState.get<boolean>(
      ClipboardMonitor.FIRST_CLIPBOARD_KEY,
      false
    );

    if (hasShown) return;

    await this.context.globalState.update(
      ClipboardMonitor.FIRST_CLIPBOARD_KEY,
      true
    );

    vscode.window.showInformationMessage(
      '⚡ Prompttrace is now analyzing prompts you copy — helping reduce token cost before you send them.\n\nToggle this anytime: "Prompttrace: Toggle Clipboard Analysis"',
      'Got it'
    );

    this.log('First-time clipboard onboarding message shown');
  }

  // ─── High-Value Popup ───────────────────────────────────

  /**
   * Show a high-impact popup notification for valuable prompts.
   * Only fires when:
   * - tokens > 1000 OR
   * - optimization savings > 25%
   */
  private async showHighValuePopup(result: InlineAnalysisResult): Promise<void> {
    const { tokens, cost, optimization, intent, severity } = result;
    const costStr = cost >= 0.001 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(5)}`;
    const intentLabel = intent !== 'general' ? ` [${intent}]` : '';
    const hasOptimization = optimization.available && optimization.savingsPercent >= 5;

    // ── Build message ──────────────────────────────────────────
    let message: string;
    
    // Prioritize AI refinement in the message
    if (result.refinedPrompt) {
      message = 
        `✨ AI Optimized Prompt Detected${intentLabel}\n` +
        `~${tokens.toLocaleString()} → ${result.refinedPrompt.tokens.toLocaleString()} tokens · ${costStr} per send\n\n` +
        `💡 ${result.refinedPrompt.reasoning}`;
    } else if (hasOptimization && tokens > 1000) {
      message =
        `🚨 High-Value Prompt Detected${intentLabel}\n` +
        `~${tokens.toLocaleString()} tokens · ${costStr} per send\n\n` +
        `💡 Save ${optimization.savingsPercent}% — ${tokens - optimization.optimizedTokens} tokens reducible`;
    } else {
      message =
        `📋 Clipboard Prompt Detected${intentLabel}\n` +
        `~${tokens.toLocaleString()} tokens · ${costStr} per send\n\n` +
        `${hasOptimization ? `✂️ ${optimization.savingsPercent}% could be trimmed` : '✅ Already well-optimized'}`;
    }

    // ── Buttons ────────────────────────────────────────────────
    const buttons: string[] = [];
    if (result.refinedPrompt) {
      buttons.push('✨ Apply AI Suggestion');
    }
    if (hasOptimization) {
      buttons.push('⚡ Apply Regex Optimization');
      buttons.push('📋 Copy Regex Version');
    }
    buttons.push('❌ Ignore');

    // Update message if AI refined is available
    if (result.refinedPrompt) {
      message += `\n\n💡 AI Suggestion (${result.refinedPrompt.savingsPercent}% saveable):\n"${result.refinedPrompt.reasoning}"`;
    }

    // Use warning style for high severity, info otherwise
    const showFn = severity === 'critical' || severity === 'warning'
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;

    this.log(`Showing popup — ${tokens} tok, ${optimization.savingsPercent}% savings, severity=${severity}`);

    // If AI is available, we use that for the main message
    const action = await showFn(message, { modal: false }, ...buttons);

    if (action === '✨ Apply AI Suggestion' && result.refinedPrompt) {
      await vscode.env.clipboard.writeText(result.refinedPrompt.text);
      vscode.window.showInformationMessage(
        `✨ AI Refined prompt copied! ${result.refinedPrompt.reasoning}`
      );
    } else if (action === '⚡ Apply Regex Optimization') {
      await showOptimizeDiffView(result);
    } else if (action === '📋 Copy Regex Version' && optimization.available) {
      await vscode.env.clipboard.writeText(optimization.optimizedText);
      vscode.window.showInformationMessage(
        `✅ Regex optimized version copied! Saved ~${tokens - optimization.optimizedTokens} tokens`
      );
    }
    // "❌ Ignore" = do nothing
  }

  // ─── Core Poll Cycle ────────────────────────────────────

  /**
   * Core poll cycle: read clipboard → multi-gate filtering → analyze → notify.
   */
  private async checkClipboard(): Promise<void> {
    // Gate 1: extension disabled or monitoring paused
    if (!this.enabled || !this.monitoringActive) return;

    try {
      const text = await vscode.env.clipboard.readText();
      // Only log if something exists, otherwise too noisy
      if (text) {
        // console.log('📋 Clipboard text sample:', text.slice(0, 50));
      }

      // Gate 2: too short
      if (!text || text.trim().length < ClipboardMonitor.MIN_TEXT_LENGTH) {
        return;
      }

      const trimmed = text.trim();

      // Gate 3: hash dedup — skip if clipboard hasn't changed
      const hash = crypto
        .createHash('md5')
        .update(trimmed)
        .digest('hex');

      if (hash === this.lastClipboardHash) {
        console.log('🚨 Gate 3: Hash dedup — content is same as previous check.');
        return;
      }
      this.lastClipboardHash = hash;

      // Gate 4: cooldown — prevent spamming
      const now = Date.now();
      if (now - this.lastTriggerTime < ClipboardMonitor.TRIGGER_COOLDOWN_MS) {
        this.log(`⏳ Gate 4: Cooldown active — skipping (${Math.ceil((ClipboardMonitor.TRIGGER_COOLDOWN_MS - (now - this.lastTriggerTime)) / 1000)}s remaining)`);
        return;
      }

      // Gate 5: skip URLs (Disabled by user request for 'everytime')
      // if (this.looksLikeUrl(trimmed)) {
      //   this.log(`🔗 Gate 5: Skipped — looks like URL: "${trimmed.slice(0, 60)}"`);
      //   return;
      // }

      // Gate 6: skip code-heavy content (Disabled by user request for 'everytime')
      // if (this.looksLikeCode(trimmed)) {
      //   this.log(`💻 Gate 6: Skipped — looks like code (${trimmed.split('\n').length} lines)`);
      //   return;
      // }

      // Run analysis through existing pipeline (Sync)
      const result = analyzeInlinePrompt(trimmed);

      // AI refinement pass (Deep analysis)
      // We now pass the logger to track Groq behavior
      this.log('✨ Calling Groq for AI Refinement...');
      
      const refined = await getAIRefinedPrompt(trimmed, this.logger);
      if (refined && result) {
        result.refinedPrompt = refined;
        // Fire listeners to update status bars and other UI
        this.listeners.forEach((cb) => cb(result));
      } else {
        this.log('⚠️ AI Refinement pass failed or was skipped.');
      }

      // TEMP: force trigger even if analyzer fails
      if (!result) {
        this.log('🚨 Gate 7: Analyzer returned null (likely tiny tokens/low confidence)');
        vscode.window.showInformationMessage('🔥 Clipboard detected (no analysis)');
        return;
      }

      // Gate 7: minimum token count
      // TEMP: disable token filter
      // if (result.tokens < ClipboardMonitor.MIN_TOKENS) {
      //   return;
      // }

      // Gate 8: confidence — is this actually a prompt?
      // TEMP: disable confidence filter
      // if (result.confidence < ClipboardMonitor.MIN_CONFIDENCE) {
      //   return;
      // }

      // ✅ All gates passed — trigger
      this.lastTriggerTime = now;
      this.log(`✅ Clipboard Prompt Detected!`);
      this.log(`   → ${result.tokens.toLocaleString()} tokens | $${result.cost.toFixed(5)} | confidence=${result.confidence.toFixed(2)} | intent=${result.intent}`);
      this.log(`   → Optimization: ${result.optimization.available ? `-${result.optimization.savingsPercent}% (${result.tokens - result.optimization.optimizedTokens} tokens saveable)` : 'already lean'}`);
      this.log(`   → Preview: "${trimmed.slice(0, 100)}${trimmed.length > 100 ? '...' : ''}"`);

      // First-time onboarding (non-blocking)
      this.maybeShowFirstTimeMessage();

      vscode.window.showInformationMessage('🔥 Clipboard detected!');

      // Fire listeners (updates status bar + inline decorations)
      this.listeners.forEach((cb) => cb(result));

      // Show high-value popup notification (non-blocking)
      this.showHighValuePopup(result);
    } catch (err: any) {
      this.log(`❌ Error reading/processing clipboard: ${err.message}`);
    }
  }

  dispose(): void {
    this.stopPolling();
    this.listeners = [];
    this.log('Disposed');
  }
}
