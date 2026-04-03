import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  analyzeInlinePrompt,
  InlineAnalysisResult,
} from './inline-analyzer';

export type AnalysisCallback = (result: InlineAnalysisResult) => void;
export type AnalysisClearCallback = () => void;

/**
 * Editor context classification.
 * Higher-confidence contexts get a boost in prompt detection scoring.
 */
type EditorContext =
  | 'cursor-chat'      // Cursor AI composer / inline chat
  | 'untitled'         // Untitled unsaved document (common for quick prompts)
  | 'markdown'         // Markdown file
  | 'plaintext'        // Plain text file
  | 'comment-block'    // Inside a code comment block
  | 'code-file'        // Regular code file (lower confidence)
  | 'unknown';

/**
 * Multi-signal prompt detection system.
 *
 * Monitors the active editor for prompt-like input using:
 * 1. Document type heuristics (untitled, markdown = high confidence)
 * 2. Content pattern matching (instruction verbs, questions, role markers)
 * 3. Selection tracking (selected text passed to AI = prompt candidate)
 * 4. Confidence thresholds (skip if confidence too low)
 *
 * Performance: 300ms debounce, hash-based dedup, async non-blocking.
 */
export class PromptDetector {
  private listeners: AnalysisCallback[] = [];
  private clearListeners: AnalysisClearCallback[] = [];
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastTextHash: string = '';
  private enabled: boolean = true;
  private lastResult: InlineAnalysisResult | null = null;
  private sentListeners: AnalysisCallback[] = [];
  private documentResults = new Map<string, InlineAnalysisResult>();
  private logger?: vscode.OutputChannel;

  /** Debounce delay for typing events (ms) */
  private static DEBOUNCE_MS = 300;

  /** Minimum confidence to trigger analysis callback */
  private static MIN_CONFIDENCE = 0.20;

  /** Minimum text length (chars) to consider */
  private static MIN_TEXT_LENGTH = 10;

  setLogger(logger: vscode.OutputChannel): void {
    this.logger = logger;
  }

  private log(msg: string): void {
    this.logger?.appendLine(`[PromptDetector] ${msg}`);
  }

  /**
   * Start monitoring editor activity.
   */
  activate(context: vscode.ExtensionContext): void {
    // Monitor text document changes (typing)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.enabled) return;

        // Sent Heuristic: if a document clears and we had a high-confidence
        // prompt detected for it, assume it was sent/submitted!
        if (e.document.getText().trim() === '' && e.contentChanges.length > 0) {
          const isClearance = e.contentChanges.some((c) => c.text === '');
          if (isClearance) {
            const lastDocResult = this.documentResults.get(e.document.uri.toString());
            if (lastDocResult) {
              this.log(`🚀 Prompt Sent! Document cleared. Text: "${lastDocResult.text.slice(0, 50)}..."`);
              this.sentListeners.forEach((cb) => cb(lastDocResult));
              this.documentResults.delete(e.document.uri.toString());
            }
          }
        }

        this.scheduleAnalysis(e.document);
      })
    );

    // Monitor active editor changes (switching files)
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!this.enabled) return;
        if (editor) {
          this.analyzeDocument(editor.document);
        } else {
          this.clearAnalysis();
        }
      })
    );

    // Monitor selection changes (user highlights text for AI)
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (!this.enabled) return;
        if (e.textEditor === vscode.window.activeTextEditor) {
          const selection = e.textEditor.selection;
          if (!selection.isEmpty) {
            this.scheduleAnalysis(e.textEditor.document, true);
          }
        }
      })
    );

    this.disposables.forEach((d) => context.subscriptions.push(d));
  }

  /**
   * Register a callback for when analysis completes.
   */
  onAnalysis(callback: AnalysisCallback): void {
    this.listeners.push(callback);
  }

  /**
   * Register a callback for when analysis should be cleared.
   */
  onClear(callback: AnalysisClearCallback): void {
    this.clearListeners.push(callback);
  }

  /**
   * Register a callback for when a prompt is seemingly submitted.
   */
  onPromptSent(callback: AnalysisCallback): void {
    this.sentListeners.push(callback);
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
    if (!val) {
      this.clearAnalysis();
    }
  }

  getLastResult(): InlineAnalysisResult | null {
    return this.lastResult;
  }

  /**
   * Manually trigger analysis on specific text (for command fallback).
   */
  analyzeText(text: string): InlineAnalysisResult | null {
    const result = analyzeInlinePrompt(text);
    if (result && result.confidence >= PromptDetector.MIN_CONFIDENCE) {
      this.lastResult = result;
      this.listeners.forEach((cb) => cb(result));
      return result;
    }
    // Even with low confidence, return the result for manual commands
    if (result) {
      this.lastResult = result;
      this.listeners.forEach((cb) => cb(result));
      return result;
    }
    return null;
  }

  /**
   * Schedule a debounced analysis for the given editor.
   */
  private scheduleAnalysis(
    document: vscode.TextDocument,
    selectionMode: boolean = false
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.analyzeDocument(document, selectionMode);
    }, PromptDetector.DEBOUNCE_MS);
  }

  /**
   * Core analysis pipeline for a document.
   */
  private analyzeDocument(
    document: vscode.TextDocument,
    selectionMode: boolean = false
  ): void {
    const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
    const context = this.classifyEditorContext(document, editor);

    // Silent-skip low-value contexts immediately — no log spam for code files
    if (context === 'code-file' || context === 'unknown') {
      this.clearAnalysis();
      return;
    }

    // Determine what text to analyze
    let text: string;
    if (selectionMode && editor && !editor.selection.isEmpty) {
      text = document.getText(editor.selection);
    } else {
      text = document.getText();
    }

    // Quick gates
    if (text.length < PromptDetector.MIN_TEXT_LENGTH) {
      this.clearAnalysis();
      return;
    }

    // Hash-based dedup — skip if text hasn't changed
    const hash = crypto
      .createHash('md5')
      .update(text)
      .digest('hex');
    if (hash === this.lastTextHash) return;
    this.lastTextHash = hash;

    // Log only when we have new, interesting content worth analyzing
    this.log(`Analyzing ${context} document (${text.length} chars)`);

    // Run analysis
    const result = analyzeInlinePrompt(text);
    if (!result) {
      this.clearAnalysis();
      return;
    }

    // Apply context-based confidence boost
    const boostedConfidence = this.applyContextBoost(
      result.confidence,
      context,
      selectionMode
    );

    // Gate on minimum confidence
    if (boostedConfidence < PromptDetector.MIN_CONFIDENCE) {
      this.log(`Skipped: confidence ${boostedConfidence.toFixed(2)} < ${PromptDetector.MIN_CONFIDENCE} (context=${context})`);
      this.clearAnalysis();
      return;
    }

    // Update result with boosted confidence
    const boostedResult: InlineAnalysisResult = {
      ...result,
      confidence: Math.min(boostedConfidence, 1.0),
    };

    this.log(`✅ Prompt detected: ${result.tokens} tok, conf=${boostedConfidence.toFixed(2)}, intent=${result.intent}`);

    this.lastResult = boostedResult;
    this.documentResults.set(document.uri.toString(), boostedResult);
    this.listeners.forEach((cb) => cb(boostedResult));
  }

  /**
   * Classify what kind of document we're looking at.
   */
  private classifyEditorContext(doc: vscode.TextDocument, editor?: vscode.TextEditor): EditorContext {
    const uri = doc.uri;

    // Cursor AI composer / inline chat panels surface as special schemes
    // or untitled documents with specific naming patterns
    if (
      uri.scheme === 'vscode-chat-input' ||
      uri.scheme === 'comment' ||
      uri.scheme === 'walkThrough' ||
      (uri.scheme === 'untitled' && doc.languageId === 'markdown')
    ) {
      return 'cursor-chat';
    }

    // Untitled (unsaved) documents — high confidence for prompts
    if (uri.scheme === 'untitled') {
      return 'untitled';
    }

    // Markdown files
    if (doc.languageId === 'markdown') {
      return 'markdown';
    }

    // Plain text
    if (doc.languageId === 'plaintext') {
      return 'plaintext';
    }

    // Check if cursor is inside a comment block in a code file
    // (common: writing prompts in comments before sending)
    if (editor && this.isInCommentBlock(editor)) {
      return 'comment-block';
    }

    return 'code-file';
  }

  /**
   * Check if the cursor is inside a comment block.
   */
  private isInCommentBlock(editor: vscode.TextEditor): boolean {
    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line).text.trimStart();

    // Common comment patterns
    return (
      line.startsWith('//') ||
      line.startsWith('#') ||
      line.startsWith('*') ||
      line.startsWith('/*') ||
      line.startsWith('"""') ||
      line.startsWith("'''")
    );
  }

  /**
   * Boost confidence based on editor context and interaction mode.
   */
  private applyContextBoost(
    baseConfidence: number,
    context: EditorContext,
    selectionMode: boolean
  ): number {
    let boost = 0;

    switch (context) {
      case 'cursor-chat':
        boost = 0.40; // Almost certainly a prompt
        break;
      case 'untitled':
        boost = 0.25; // Very likely a prompt
        break;
      case 'markdown':
        boost = 0.15; // Quite likely
        break;
      case 'plaintext':
        boost = 0.15;
        break;
      case 'comment-block':
        boost = 0.10;
        break;
      case 'code-file':
        boost = -0.10; // Reduce confidence for raw code
        break;
      default:
        boost = 0;
    }

    // Selection mode = user explicitly highlighted text (probably for AI)
    if (selectionMode) {
      boost += 0.15;
    }

    return baseConfidence + boost;
  }

  private clearAnalysis(): void {
    this.lastTextHash = '';
    this.lastResult = null;
    this.clearListeners.forEach((cb) => cb());
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.disposables.forEach((d) => d.dispose());
    this.listeners = [];
    this.clearListeners = [];
  }
}
