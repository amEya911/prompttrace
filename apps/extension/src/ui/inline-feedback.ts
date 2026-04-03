import * as vscode from 'vscode';
import {
  InlineAnalysisResult,
  THRESHOLDS,
  estimateTokensFromText,
} from '../inline-analyzer';

/**
 * Non-intrusive, 3-tier inline feedback system for pre-send prompt analysis.
 *
 * Tier 1: Status bar — always visible, shows token count + cost
 * Tier 2: Inline editor decorations — subtle annotation above the text
 * Tier 3: Intervention dialog — only for critical prompts (modal warning)
 *
 * Messaging is framed as pre-send intervention:
 * "Before you send..." / "You're about to send..." / "This will cost..."
 */
export class InlineFeedback {
  private statusBarItem: vscode.StatusBarItem;
  private decorationType: vscode.TextEditorDecorationType;
  private optimizationPreviewDecoration: vscode.TextEditorDecorationType;
  private interventionCooldown: number = 0;
  private lastResult: InlineAnalysisResult | null = null;
  private enabled: boolean = true;
  private sessionSavedTokens: number = 0;
  private sessionAnalysisCount: number = 0;

  /** Cooldown between intervention dialogs (ms) */
  private static INTERVENTION_COOLDOWN_MS = 15000;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      103 // Higher than token counter (102), cost bar (101), toggle (100)
    );
    this.statusBarItem.command = 'prompttrace.analyzeInput';
    this.statusBarItem.show();

    // Inline decoration style — subtle, non-intrusive
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1em',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
        fontWeight: 'normal',
      },
      isWholeLine: true,
    });

    // Optimization preview decoration — collapsed below the first line
    this.optimizationPreviewDecoration =
      vscode.window.createTextEditorDecorationType({
        after: {
          color: new vscode.ThemeColor('terminal.ansiGreen'),
          fontStyle: 'italic',
          fontWeight: 'normal',
        },
        isWholeLine: true,
      });
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
    if (!val) {
      this.clear();
    }
  }

  /**
   * Show analysis feedback. Determines which tier(s) to activate
   * based on severity and confidence.
   */
  show(result: InlineAnalysisResult, uri?: vscode.Uri): void {
    if (!this.enabled) return;

    this.lastResult = result;
    this.sessionAnalysisCount++;

    // Tier 1: Always update status bar
    this.updateStatusBar(result);

    // Tier 2: Inline decorations for warning+ severity
    if (
      result.severity === 'warning' ||
      result.severity === 'critical'
    ) {
      this.showInlineDecoration(result, uri);
    } else {
      this.clearDecorations();
    }

    // Tier 3: Intervention dialog for critical only
    if (result.severity === 'critical') {
      this.maybeShowIntervention(result);
    }
  }

  /**
   * Clear all feedback UI.
   */
  clear(): void {
    this.statusBarItem.text = '';
    this.statusBarItem.tooltip = '';
    this.statusBarItem.backgroundColor = undefined;
    this.lastResult = null;
    this.clearDecorations();
  }

  getSessionStats(): { savedTokens: number; analysisCount: number } {
    return {
      savedTokens: this.sessionSavedTokens,
      analysisCount: this.sessionAnalysisCount,
    };
  }

  // ─── Tier 1: Status Bar ────────────────────────────────

  private updateStatusBar(result: InlineAnalysisResult): void {
    const { tokens, cost, severity, intent, optimization, confidence } = result;

    let icon: string;
    let bgColor: vscode.ThemeColor | undefined;

    switch (severity) {
      case 'critical':
        icon = '🚨';
        bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      case 'warning':
        icon = '⚠️';
        bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      case 'info':
        icon = '💸';
        bgColor = undefined;
        break;
      default:
        icon = '📝';
        bgColor = undefined;
    }

    // Pre-send framing
    const costStr = cost >= 0.001 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(5)}`;
    const intentLabel = intent !== 'general' ? ` [${intent}]` : '';

    if (severity === 'critical' || severity === 'warning') {
      this.statusBarItem.text = `${icon} ~${tokens.toLocaleString()} tok (${costStr}) — optimize before sending`;
    } else {
      this.statusBarItem.text = `${icon} ~${tokens.toLocaleString()} tok (${costStr})${intentLabel}`;
    }

    this.statusBarItem.backgroundColor = bgColor;

    // Rich tooltip
    const tooltipLines = [
      `⚡ Pre-Send Analysis — Prompttrace`,
      ``,
      `Tokens: ~${tokens.toLocaleString()}`,
      `Cost: ${costStr} per request`,
      `Projected: $${result.projectedMonthlyCost.toFixed(2)}/mo at 10k calls`,
      `Intent: ${intent}`,
      `Confidence: ${Math.round(confidence * 100)}%`,
    ];

    if (optimization.available) {
      tooltipLines.push(
        ``,
        `✂️ Optimization available: -${optimization.savingsPercent}% (${optimization.optimizedTokens} tok after)`,
      );
    }

    if (result.warnings.length > 0) {
      tooltipLines.push(``, ...result.warnings);
    }

    tooltipLines.push(``, `Click to analyze • Cmd: "Prompttrace: Analyze Current Input"`);

    this.statusBarItem.tooltip = tooltipLines.join('\n');
  }

  // ─── Tier 2: Inline Decorations ────────────────────────

  private showInlineDecoration(result: InlineAnalysisResult, uri?: vscode.Uri): void {
    let editor = vscode.window.activeTextEditor;
    if (uri) {
      editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
    }
    if (!editor) return;

    const { tokens, cost, optimization, severity } = result;
    const costStr = cost >= 0.001 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(5)}`;

    // Main analysis annotation on the first line
    let mainLabel: string;
    if (severity === 'critical') {
      mainLabel = `  🚨 Before you send: ~${tokens.toLocaleString()} tok (${costStr}) — ${optimization.savingsPercent}% reducible`;
    } else {
      mainLabel = `  ⚠️ ~${tokens.toLocaleString()} tok (${costStr}) — ${optimization.savingsPercent}% could be trimmed`;
    }

    const firstLineRange = new vscode.Range(0, 0, 0, 0);
    const mainDecoration: vscode.DecorationOptions = {
      range: firstLineRange,
      renderOptions: {
        after: {
          contentText: mainLabel,
          color: severity === 'critical' ? '#ef4444' : '#f59e0b',
          fontStyle: 'italic',
        },
      },
    };

    editor.setDecorations(this.decorationType, [mainDecoration]);

    // Live optimization preview on the second line (collapsed)
    if (optimization.available && optimization.savingsPercent >= 10) {
      const previewLabel = `  ✂️ Optimized: "${optimization.preview.slice(0, 80)}${optimization.preview.length > 80 ? '…' : ''}" → saves ~${tokens - optimization.optimizedTokens} tok`;

      const lineCount = editor.document.lineCount;
      const previewLine = Math.min(1, lineCount - 1);
      const previewRange = new vscode.Range(previewLine, 0, previewLine, 0);
      const previewDecoration: vscode.DecorationOptions = {
        range: previewRange,
        renderOptions: {
          after: {
            contentText: previewLabel,
            color: '#10b981',
            fontStyle: 'italic',
          },
        },
      };

      editor.setDecorations(this.optimizationPreviewDecoration, [
        previewDecoration,
      ]);
    } else {
      editor.setDecorations(this.optimizationPreviewDecoration, []);
    }
  }

  private clearDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(this.decorationType, []);
      editor.setDecorations(this.optimizationPreviewDecoration, []);
    }
  }

  // ─── Tier 3: Intervention Dialog ───────────────────────

  private async maybeShowIntervention(
    result: InlineAnalysisResult
  ): Promise<void> {
    const now = Date.now();
    if (now - this.interventionCooldown < InlineFeedback.INTERVENTION_COOLDOWN_MS) {
      return;
    }
    this.interventionCooldown = now;

    const { tokens, cost, optimization, intent } = result;
    const costStr = `$${cost.toFixed(4)}`;
    const projStr = `$${result.projectedMonthlyCost.toFixed(2)}`;

    const intentMsg = intent !== 'general' ? `\nDetected intent: ${intent}` : '';

    const message = [
      `🚨 Before you send this prompt:`,
      ``,
      `~${tokens.toLocaleString()} tokens → ${costStr}/request → ${projStr}/mo at scale${intentMsg}`,
      ``,
      optimization.available
        ? `Prompttrace can reduce this by ${optimization.savingsPercent}% (${tokens - optimization.optimizedTokens} tokens)`
        : ``,
      ``,
      result.suggestions.length > 0
        ? result.suggestions[0]
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const actions: string[] = [];
    if (optimization.available) {
      actions.push('⚡ Optimize Prompt');
    }
    actions.push('📋 Copy Optimized', '✅ Send Anyway');

    const action = await vscode.window.showWarningMessage(
      message,
      { modal: false },
      ...actions
    );

    if (action === '⚡ Optimize Prompt') {
      // Trigger the optimize flow command
      vscode.commands.executeCommand('prompttrace.optimizeInline');
    } else if (action === '📋 Copy Optimized') {
      if (optimization.available) {
        await vscode.env.clipboard.writeText(optimization.optimizedText);
        this.sessionSavedTokens += tokens - optimization.optimizedTokens;
        vscode.window.showInformationMessage(
          `✅ Optimized prompt copied! Saved ~${tokens - optimization.optimizedTokens} tokens (${optimization.savingsPercent}%)`
        );
      }
    }
    // "Send Anyway" = do nothing
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.decorationType.dispose();
    this.optimizationPreviewDecoration.dispose();
  }
}
