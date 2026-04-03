import * as vscode from 'vscode';
import { StateManager } from './state';
import { Integration } from './integration';
import { PromptDetector } from './prompt-detector';
import { ClipboardMonitor } from './clipboard-monitor';
import { showTracePopup } from './ui/popup';
import { PrompttraceWebviewProvider } from './ui/webview';
import { showOptimizeDiffView } from './ui/optimize-flow';

/**
 * Register all Prompttrace commands in the VSCode command palette.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  state: StateManager,
  integration: Integration,
  webviewProvider: PrompttraceWebviewProvider,
  statusBarUpdater: () => void,
  promptDetector?: PromptDetector,
  clipboardMonitor?: ClipboardMonitor
): void {
  // Toggle extension on/off
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.toggle', async () => {
      const isNowEnabled = await state.toggleEnabled();

      if (isNowEnabled) {
        await state.setPopupHidden(false);
        vscode.window.showInformationMessage('Prompttrace: Enabled ✅ — watching for LLM calls');
      } else {
        vscode.window.showInformationMessage('Prompttrace: Disabled ❌ — popups paused');
      }
      statusBarUpdater();
    })
  );

  // Open side panel
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.showPanel', async () => {
      await vscode.commands.executeCommand('prompttrace.panel.focus');
      webviewProvider.refresh();
    })
  );

  // Show latest trace as popup (bypasses cooldown for explicit command)
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.showLastTrace', async () => {
      const latest = await integration.getLatestTrace();
      if (!latest) {
        vscode.window.showWarningMessage(
          'Prompttrace: No traces found. Run "Prompttrace: Run Mock" first.'
        );
        return;
      }
      await state.setPopupHidden(false);
      await showTracePopup(latest, state, integration, statusBarUpdater);
    })
  );

  // Run mock trace
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.runMock', async () => {
      const trace = integration.generateMockTrace();

      // Track in session
      state.addToSession(trace.cost, trace.totalTokens);
      statusBarUpdater();

      // Refresh panel
      webviewProvider.refresh();

      // Show high-impact popup
      await showTracePopup(trace, state, integration, statusBarUpdater);
    })
  );

  // ─── NEW: Pre-Send Analysis Commands ──────────────────

  // Analyze current editor input (manual trigger / fallback)
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.analyzeInput', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(
          'Prompttrace: No active editor. Open a file or type a prompt first.'
        );
        return;
      }

      // Prefer selected text, fall back to full document
      let text: string;
      if (!editor.selection.isEmpty) {
        text = editor.document.getText(editor.selection);
      } else {
        text = editor.document.getText();
      }

      if (!text || text.trim().length < 20) {
        vscode.window.showWarningMessage(
          'Prompttrace: Not enough text to analyze. Select or type a prompt first.'
        );
        return;
      }

      if (promptDetector) {
        const result = promptDetector.analyzeText(text);
        if (result) {
          vscode.window.showInformationMessage(
            `⚡ Pre-Send Analysis: ~${result.tokens.toLocaleString()} tokens ($${result.cost.toFixed(5)}) | Intent: ${result.intent}${result.optimization.available ? ` | ${result.optimization.savingsPercent}% reducible` : ' | ✅ Well-optimized'}`,
            '⚡ Optimize',
            '📋 Copy Optimized'
          ).then(async (action) => {
            if (action === '⚡ Optimize' && result) {
              await showOptimizeDiffView(result);
            } else if (action === '📋 Copy Optimized' && result?.optimization.available) {
              await vscode.env.clipboard.writeText(result.optimization.optimizedText);
              vscode.window.showInformationMessage('✅ Optimized prompt copied!');
            }
          });
        } else {
          vscode.window.showInformationMessage(
            'Prompttrace: Text is already lean — no optimization needed.'
          );
        }
      }
    })
  );

  // Analyze clipboard content (fallback for inaccessible panels)
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.analyzeClipboard', async () => {
      const clipboardText = await vscode.env.clipboard.readText();

      if (!clipboardText || clipboardText.trim().length < 20) {
        vscode.window.showWarningMessage(
          'Prompttrace: Clipboard is empty or too short to analyze.'
        );
        return;
      }

      if (promptDetector) {
        const result = promptDetector.analyzeText(clipboardText);
        if (result) {
          vscode.window.showInformationMessage(
            `⚡ Clipboard Analysis: ~${result.tokens.toLocaleString()} tokens ($${result.cost.toFixed(5)}) | Intent: ${result.intent}${result.optimization.available ? ` | ${result.optimization.savingsPercent}% reducible` : ' | ✅ Well-optimized'}`,
            '⚡ Optimize',
            '📋 Copy Optimized'
          ).then(async (action) => {
            if (action === '⚡ Optimize' && result) {
              await showOptimizeDiffView(result);
            } else if (action === '📋 Copy Optimized' && result?.optimization.available) {
              await vscode.env.clipboard.writeText(result.optimization.optimizedText);
              vscode.window.showInformationMessage('✅ Optimized prompt copied!');
            }
          });
        } else {
          vscode.window.showInformationMessage(
            'Prompttrace: Clipboard text is already lean — no optimization needed.'
          );
        }
      }
    })
  );

  // Optimize inline (triggered by intervention dialog)
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.optimizeInline', async () => {
      if (promptDetector) {
        const result = promptDetector.getLastResult();
        if (result) {
          await showOptimizeDiffView(result);
        } else {
          vscode.window.showWarningMessage(
            'Prompttrace: No analysis available. Run "Prompttrace: Analyze Current Input" first.'
          );
        }
      }
    })
  );

  // Toggle clipboard monitoring on/off
  context.subscriptions.push(
    vscode.commands.registerCommand('prompttrace.toggleClipboard', async () => {
      if (clipboardMonitor) {
        const isNowActive = clipboardMonitor.toggleMonitoring();
        if (isNowActive) {
          vscode.window.showInformationMessage(
            'Prompttrace: Clipboard analysis enabled ✅ — prompts copied from anywhere will be analyzed'
          );
        } else {
          vscode.window.showInformationMessage(
            'Prompttrace: Clipboard analysis disabled ❌'
          );
        }
      } else {
        vscode.window.showWarningMessage(
          'Prompttrace: Clipboard monitor not initialized.'
        );
      }
    })
  );
}

