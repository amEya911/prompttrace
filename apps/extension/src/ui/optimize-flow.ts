import * as vscode from 'vscode';
import { InlineAnalysisResult, estimateTokensFromText } from '../inline-analyzer';

/**
 * Virtual document provider for showing optimized prompt diffs.
 * Creates read-only virtual documents that vscode.diff can display.
 */
class PromptContentProvider implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) || '';
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
  }

  clear(): void {
    this.contents.clear();
  }
}

const contentProvider = new PromptContentProvider();
let providerRegistered = false;

/**
 * Register the virtual document provider.
 * Called once during extension activation.
 */
export function registerOptimizeFlowProvider(
  context: vscode.ExtensionContext
): void {
  if (providerRegistered) return;
  const disposable = vscode.workspace.registerTextDocumentContentProvider(
    'prompttrace-diff',
    contentProvider
  );
  context.subscriptions.push(disposable);
  providerRegistered = true;
}

/**
 * Show an optimization diff view for the current inline analysis result.
 *
 * Opens a side-by-side diff view with:
 * - Left: Original prompt
 * - Right: Optimized prompt
 * - Title showing savings summary
 *
 * Also provides actions to copy or replace the original text.
 */
export async function showOptimizeDiffView(
  result: InlineAnalysisResult
): Promise<void> {
  if (!result.optimization.available) {
    vscode.window.showInformationMessage(
      '✅ This prompt is already well-optimized!'
    );
    return;
  }

  const { text, tokens, optimization, model, cost } = result;

  // Create virtual document URIs
  const timestamp = Date.now();
  const originalUri = vscode.Uri.parse(
    `prompttrace-diff:original-${timestamp}.txt`
  );
  const optimizedUri = vscode.Uri.parse(
    `prompttrace-diff:optimized-${timestamp}.txt`
  );

  // Set content in the provider
  contentProvider.setContent(originalUri, text);
  contentProvider.setContent(optimizedUri, optimization.optimizedText);

  const savedTokens = tokens - optimization.optimizedTokens;
  const savedCostStr = (cost - cost * (1 - optimization.savingsPercent / 100)).toFixed(5);
  const title = `⚡ Optimize: -${savedTokens} tok (${optimization.savingsPercent}%) | saves $${savedCostStr}/req`;

  // Open diff view
  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    optimizedUri,
    title
  );

  // Show action buttons
  const action = await vscode.window.showInformationMessage(
    `✅ Optimization ready: ${tokens.toLocaleString()} → ${optimization.optimizedTokens.toLocaleString()} tokens (−${optimization.savingsPercent}%)`,
    '📋 Copy Optimized',
    '✏️ Replace in Editor',
    '❌ Dismiss'
  );

  if (action === '📋 Copy Optimized') {
    await vscode.env.clipboard.writeText(optimization.optimizedText);
    vscode.window.showInformationMessage(
      `✅ Optimized prompt copied — saving ~${savedTokens} tokens per send`
    );
  } else if (action === '✏️ Replace in Editor') {
    await replaceInActiveEditor(text, optimization.optimizedText);
  }
}

/**
 * Replace the original text with optimized text in the active editor.
 */
async function replaceInActiveEditor(
  originalText: string,
  optimizedText: string
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      'No active editor found to replace text in.'
    );
    return;
  }

  const doc = editor.document;
  const fullText = doc.getText();

  // Find the original text in the document
  const startIndex = fullText.indexOf(originalText);
  if (startIndex === -1) {
    // Try replacing the entire document if text matches
    if (fullText.trim() === originalText.trim()) {
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(fullText.length)
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, optimizedText);
      });
      vscode.window.showInformationMessage(
        '✅ Prompt optimized in editor!'
      );
    } else {
      vscode.window.showWarningMessage(
        'Could not find the original prompt in the editor. It may have changed.'
      );
    }
    return;
  }

  const startPos = doc.positionAt(startIndex);
  const endPos = doc.positionAt(startIndex + originalText.length);
  const range = new vscode.Range(startPos, endPos);

  await editor.edit((editBuilder) => {
    editBuilder.replace(range, optimizedText);
  });

  vscode.window.showInformationMessage(
    '✅ Prompt optimized in editor!'
  );
}
