import * as vscode from 'vscode';
import { StateManager } from './state';
import { Integration } from './integration';
import { registerCommands } from './commands';
import { showTracePopup } from './ui/popup';
import { PrompttraceWebviewProvider } from './ui/webview';
import { LiveTokenCounter } from './ui/token-counter';
import { PromptDetector } from './prompt-detector';
import { InlineFeedback } from './ui/inline-feedback';
import { registerOptimizeFlowProvider } from './ui/optimize-flow';
import { ClipboardMonitor } from './clipboard-monitor';

let integration: Integration | null = null;
let tokenCounter: LiveTokenCounter | null = null;
let promptDetector: PromptDetector | null = null;
let inlineFeedback: InlineFeedback | null = null;
let clipboardMonitor: ClipboardMonitor | null = null;



export function activate(context: vscode.ExtensionContext) {
  console.log("🚀 PROMPTTRACE ACTIVATED");
  const state = new StateManager(context);

  let workspaceRoot: string;

  const folders = vscode.workspace.workspaceFolders;

  if (folders && folders.length > 0) {
    workspaceRoot = folders[0].uri.fsPath;
  } else {
    workspaceRoot = context.globalStorageUri.fsPath;
  }

  console.log('[Prompttrace Extension] Workspace Root:', workspaceRoot);
  console.log('[Prompttrace Extension] Expecting traces at:', `${workspaceRoot}/.prompttrace/traces.jsonl`);

  integration = new Integration(workspaceRoot);

  // ─── Live Token Counter ───────────────────────────────
  tokenCounter = new LiveTokenCounter();
  tokenCounter.activate(context);

  // ─── Pre-Send Analysis: Prompt Detector + Inline Feedback ──
  promptDetector = new PromptDetector();
  inlineFeedback = new InlineFeedback();

  promptDetector.onAnalysis((result) => {
    inlineFeedback?.show(result);
  });
  promptDetector.onClear(() => {
    inlineFeedback?.clear();
  });

  promptDetector.onPromptSent((result) => {
    if (integration) {
      integration.saveSimulatedTrace(result);
    }
  });

  promptDetector.activate(context);

  // ─── Clipboard Monitor ─────────────────────────────────
  clipboardMonitor = new ClipboardMonitor();
  clipboardMonitor.onAnalysis((result) => {
    inlineFeedback?.show(result);
  });
  clipboardMonitor.activate(context);

  // Register virtual document provider for optimization diffs
  registerOptimizeFlowProvider(context);

  // ─── Webview Provider ─────────────────────────────────
  const webviewProvider = new PrompttraceWebviewProvider(
    context.extensionUri,
    integration,
    state,
    inlineFeedback
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PrompttraceWebviewProvider.viewType,
      webviewProvider
    )
  );

  // ─── Status Bar: Session Cost (live) ──────────────────
  const costBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    101
  );
  costBar.command = 'prompttrace.showPanel';
  costBar.tooltip = 'Click to open Prompttrace dashboard';
  costBar.show();
  context.subscriptions.push(costBar);

  // ─── Status Bar: Toggle ───────────────────────────────
  const toggleBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  toggleBar.command = 'prompttrace.toggle';
  toggleBar.show();
  context.subscriptions.push(toggleBar);

  // Unified updater
  const updateStatusBars = () => {
    const sessionCost = state.getSessionCost();
    const sessionReqs = state.getSessionRequests();

    if (sessionCost > 0) {
      costBar.text = `💸 $${sessionCost.toFixed(4)} (${sessionReqs} req)`;
      costBar.tooltip = `Session: $${sessionCost.toFixed(4)} across ${sessionReqs} requests\nProjected: $${(sessionCost * 10000).toFixed(2)}/mo\nClick to open dashboard`;
    } else {
      costBar.text = `💸 $0.00`;
      costBar.tooltip = 'No LLM costs tracked yet. Click to open dashboard.';
    }

    if (state.isEnabled()) {
      toggleBar.text = '$(pulse) Prompttrace';
      toggleBar.tooltip = 'Prompttrace is active. Click to toggle.';
    } else {
      toggleBar.text = '$(circle-slash) Prompttrace';
      toggleBar.tooltip = 'Prompttrace is disabled. Click to toggle.';
    }

    // Sync all subsystems with toggle
    if (tokenCounter) {
      tokenCounter.setEnabled(state.isEnabled());
    }
    if (promptDetector) {
      promptDetector.setEnabled(state.isEnabled());
    }
    if (inlineFeedback) {
      inlineFeedback.setEnabled(state.isEnabled());
    }
    if (clipboardMonitor) {
      clipboardMonitor.setEnabled(state.isEnabled());
    }
  };
  updateStatusBars();

  // Register commands (pass promptDetector + clipboardMonitor for pre-send analysis commands)
  registerCommands(context, state, integration, webviewProvider, updateStatusBars, promptDetector, clipboardMonitor);

  // Start chokidar watcher
  integration.startWatching();

  // On new trace detected
  integration.onTraceChange(async (trace) => {
    if (!state.isEnabled()) return;
    if (!integration) return;

    // Refresh panel (async, non-blocking)
    webviewProvider.refresh();

    // Show popup (respects all suppression)
    await showTracePopup(trace, state, integration, updateStatusBars);
  });

  // ─── First-Time Shock ─────────────────────────────────
  if (!state.hasShownFirstRun()) {
    showFirstRunMessage(state);
  }

  // Output channel
  const outputChannel = vscode.window.createOutputChannel('Prompttrace');
  outputChannel.appendLine(
    `[Prompttrace] Activated. Watching: ${workspaceRoot}/.prompttrace/traces.jsonl`
  );
  outputChannel.appendLine(
    `[Prompttrace] Pre-send analysis enabled — detecting prompts in real-time`
  );
  outputChannel.appendLine(
    `[Prompttrace] Clipboard monitoring active — analyzing prompts from any source`
  );
  if (promptDetector) {
    promptDetector.setLogger(outputChannel);
  }
  if (clipboardMonitor) {
    clipboardMonitor.setLogger(outputChannel);
  }
  outputChannel.show(true);
  context.subscriptions.push(outputChannel);
}

export function deactivate() {
  if (integration) {
    integration.stopWatching();
    integration = null;
  }
  if (tokenCounter) {
    tokenCounter.dispose();
    tokenCounter = null;
  }
  if (promptDetector) {
    promptDetector.dispose();
    promptDetector = null;
  }
  if (inlineFeedback) {
    inlineFeedback.dispose();
    inlineFeedback = null;
  }
  if (clipboardMonitor) {
    clipboardMonitor.dispose();
    clipboardMonitor = null;
  }
}

async function showFirstRunMessage(state: StateManager): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    `⚠️ At typical usage, developers spend $30–100/month on LLM APIs without realizing it.\n\nPrompttrace helps reduce this by 30–60% by detecting context bloat, redundant prompts, and oversized system instructions.\n\nNEW: Pre-send analysis now catches expensive prompts BEFORE you send them.\n\nRun "Prompttrace: Run Mock" to see it in action.`,
    'Run Mock Now',
    'Got it'
  );

  await state.markFirstRunShown();

  if (action === 'Run Mock Now') {
    vscode.commands.executeCommand('prompttrace.runMock');
  }
}
