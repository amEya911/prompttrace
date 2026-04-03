import * as vscode from 'vscode';
import { estimateTokensFromText, THRESHOLDS } from '../inline-analyzer';

/**
 * Real-time token counter that estimates tokens from the active editor
 * and shows a live updating status bar item.
 *
 * Now delegates token estimation to the shared `estimateTokensFromText()`
 * in inline-analyzer.ts — single source of truth for the entire extension.
 */
export class LiveTokenCounter {
  private statusBarItem: vscode.StatusBarItem;
  private debounceTimer: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];
  private lastTokenCount = 0;
  private enabled = true;

  /** Debounce delay for typing events (ms) */
  private static DEBOUNCE_MS = 150;

  /** Warning threshold — show ⚠️ when tokens exceed this */
  private static WARN_THRESHOLD = THRESHOLDS.WARNING_TOKENS;

  /** Critical threshold — show 🔴 */
  private static CRITICAL_THRESHOLD = THRESHOLDS.CRITICAL_TOKENS;

  /** Rapid growth: if tokens grew > this amount in one update, flag it */
  private static RAPID_GROWTH_THRESHOLD = 500;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      102 // Higher priority = more to the left
    );
    this.statusBarItem.command = 'prompttrace.showPanel';
    this.statusBarItem.tooltip = 'Estimated tokens in current editor — Prompttrace';
    this.statusBarItem.show();
  }

  /**
   * Start listening to editor changes.
   */
  activate(context: vscode.ExtensionContext): void {
    // Update on text changes (debounced)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          this.scheduleUpdate(e.document);
        }
      })
    );

    // Update on active editor change
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateNow(editor.document);
        } else {
          this.statusBarItem.text = '';
        }
      })
    );

    // Initial update
    if (vscode.window.activeTextEditor) {
      this.updateNow(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(this.statusBarItem);
    this.disposables.forEach((d) => context.subscriptions.push(d));
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
    if (!val) {
      this.statusBarItem.text = '';
    } else if (vscode.window.activeTextEditor) {
      this.updateNow(vscode.window.activeTextEditor.document);
    }
  }

  /**
   * Schedule a debounced update.
   */
  private scheduleUpdate(doc: vscode.TextDocument): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.updateNow(doc);
    }, LiveTokenCounter.DEBOUNCE_MS);
  }

  /**
   * Perform the token estimation and update the status bar.
   * Uses the shared estimateTokensFromText() from inline-analyzer.
   */
  private updateNow(doc: vscode.TextDocument): void {
    if (!this.enabled) return;

    const text = doc.getText();
    const tokens = estimateTokensFromText(text);
    const previousCount = this.lastTokenCount;
    this.lastTokenCount = tokens;

    // Determine severity
    const rapidGrowth =
      tokens - previousCount > LiveTokenCounter.RAPID_GROWTH_THRESHOLD &&
      previousCount > 0;

    let icon: string;
    let color: vscode.ThemeColor | undefined;

    if (tokens >= LiveTokenCounter.CRITICAL_THRESHOLD || rapidGrowth) {
      icon = '🔴';
      color = new vscode.ThemeColor('statusBarItem.errorForeground');
    } else if (tokens >= LiveTokenCounter.WARN_THRESHOLD) {
      icon = '⚠️';
      color = new vscode.ThemeColor('statusBarItem.warningForeground');
    } else {
      icon = '📝';
      color = undefined;
    }

    this.statusBarItem.text = `${icon} ~${tokens.toLocaleString()} tok`;
    this.statusBarItem.color = color;

    if (rapidGrowth) {
      this.statusBarItem.tooltip = `⚡ Rapid token growth detected! (+${(tokens - previousCount).toLocaleString()})`;
    } else {
      this.statusBarItem.tooltip = `Estimated ${tokens.toLocaleString()} tokens in current file — Prompttrace`;
    }
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.statusBarItem.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
