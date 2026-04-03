import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TraceRecord } from 'prompttrace';
import { StateManager } from '../state';
import { Integration } from '../integration';
import { generateSuggestions } from '../suggestions';

type SeverityLevel = 'low' | 'medium' | 'high';

function classifySeverity(numericSeverity: number): SeverityLevel {
  if (numericSeverity >= 3) return 'high';
  if (numericSeverity >= 2) return 'medium';
  return 'low';
}

/**
 * Generate a dynamic, high-impact headline based on trace analysis.
 */
function generateHeadline(trace: TraceRecord, savingsPercent: number): string {
  if (trace.cacheHits > 1) {
    return `🔁 This exact prompt has been sent ${trace.cacheHits + 1} times — cache it and save 100%`;
  }
  if (savingsPercent >= 40) {
    return `🔥 This prompt is costing ~${Math.ceil(100 / (100 - savingsPercent))}× more than necessary — optimization can save ${savingsPercent}%`;
  }
  if (savingsPercent >= 20) {
    return `💸 You can save up to ${savingsPercent}% on this request`;
  }
  if (trace.projectedMonthlyCost > 10) {
    return `⚠️ High cost alert — projected $${trace.projectedMonthlyCost.toFixed(0)}/mo at scale`;
  }
  if (trace.totalTokens > 2000) {
    return `⚡ ${trace.totalTokens.toLocaleString()} tokens used — optimization recommended`;
  }
  return `💸 Prompttrace: ${trace.totalTokens} tokens ($${trace.cost.toFixed(5)})`;
}

/**
 * Shows an inline popup with HIGH-IMPACT messaging.
 * Includes auto optimization suggestion, smart suggestions,
 * and cost shock shareability.
 */
export async function showTracePopup(
  trace: TraceRecord,
  state: StateManager,
  integration: Integration,
  statusBarUpdater?: () => void
): Promise<void> {
  const insightHash = crypto
    .createHash('md5')
    .update(trace.insights.map((i) => i.message).join('|'))
    .digest('hex');

  const canShow = await state.canShowPopup(trace.totalTokens, insightHash);

  // Track session regardless
  state.addToSession(trace.cost, trace.totalTokens);
  if (statusBarUpdater) statusBarUpdater();

  if (!canShow) return;

  // Calculate savings
  const { diff } = integration.optimizeTrace(trace);
  const savingsPercent =
    diff.originalTokens > 0
      ? Math.round((diff.diffTokens / diff.originalTokens) * 100)
      : 0;

  // Sort insights by impact (highest savings potential first)
  const sortedInsights = [...trace.insights].sort((a, b) => b.severity - a.severity);
  const highSeverityInsights = sortedInsights.filter(
    (i) => classifySeverity(i.severity) === 'high'
  );

  // Get smart suggestions (top 2)
  const suggestions = generateSuggestions(trace).slice(0, 2);

  const headline = generateHeadline(trace, savingsPercent);

  const lines: string[] = [];
  lines.push(headline);
  lines.push('');
  lines.push(
    `Tokens: ${trace.totalTokens.toLocaleString()} (in: ${trace.inputTokens} / out: ${trace.outputTokens})`
  );
  lines.push(`Cost: $${trace.cost.toFixed(5)}  |  Projected: $${trace.projectedMonthlyCost.toFixed(2)}/mo`);

  // Auto optimization suggestion
  if (savingsPercent > 0) {
    lines.push('');
    lines.push(`💡 Optimized prompt available (−${savingsPercent}% tokens, saves $${diff.projectedMonthlySavings.toFixed(2)}/mo)`);
  }

  if (highSeverityInsights.length > 0) {
    lines.push('');
    highSeverityInsights.forEach((ins) => {
      lines.push(`🔴 ${ins.message}`);
    });
  }

  // Smart suggestions
  if (suggestions.length > 0) {
    lines.push('');
    suggestions.forEach((s) => {
      lines.push(`${s.icon} ${s.title}: ${s.savingsEstimate}`);
    });
  }

  const message = lines.join('\n');

  const hasHighSeverity = highSeverityInsights.length > 0;
  const showFn = hasHighSeverity
    ? vscode.window.showWarningMessage
    : vscode.window.showInformationMessage;

  // Choose buttons based on context
  const buttons: string[] = ['⚡ Optimize', '📋 Copy'];
  if (trace.projectedMonthlyCost > 5) {
    buttons.push('📊 Share Insight');
  }
  buttons.push('👁 Details');

  const action = await showFn(message, { modal: false }, ...buttons);

  if (action === '⚡ Optimize') {
    await showOptimizeDiff(trace, integration);
  } else if (action === '📋 Copy') {
    await copyOptimizedPrompt(trace, integration);
  } else if (action === '📊 Share Insight') {
    await shareCostSnapshot(trace, state, diff);
  } else if (action === '👁 Details') {
    vscode.commands.executeCommand('prompttrace.showPanel');
  }
}

/**
 * Generate and copy a shareable cost shock snapshot.
 */
async function shareCostSnapshot(
  trace: TraceRecord,
  state: StateManager,
  diff: any
): Promise<void> {
  const sessionCost = state.getSessionCost();
  const snapshot = [
    `📊 Prompttrace Cost Snapshot`,
    `─────────────────────────`,
    `Model: ${trace.model}`,
    `Tokens: ${trace.totalTokens.toLocaleString()}`,
    `Cost per request: $${trace.cost.toFixed(5)}`,
    `Projected monthly (10k calls): $${trace.projectedMonthlyCost.toFixed(2)}`,
    `Session total: $${sessionCost.toFixed(4)}`,
    ``,
    `⚠️ Issues detected:`,
    ...trace.insights.map((i) => `  • ${i.message}`),
    ``,
    `💡 Optimization available:`,
    `  Save ${diff.diffTokens} tokens (${diff.originalTokens > 0 ? Math.round((diff.diffTokens / diff.originalTokens) * 100) : 0}%)`,
    `  Projected savings: $${diff.projectedMonthlySavings.toFixed(2)}/mo`,
    ``,
    `Generated by Prompttrace — LLM cost optimization tool`,
  ].join('\n');

  await vscode.env.clipboard.writeText(snapshot);
  vscode.window.showInformationMessage('📊 Cost snapshot copied to clipboard — share it with your team!');
}

async function showOptimizeDiff(
  trace: TraceRecord,
  integration: Integration
): Promise<void> {
  const { diff } = integration.optimizeTrace(trace);
  const savingsPercent =
    diff.originalTokens > 0
      ? Math.round((diff.diffTokens / diff.originalTokens) * 100)
      : 0;

  const lines = [
    `✅ Optimization Results`,
    '',
    `Original:  ${diff.originalTokens.toLocaleString()} tokens  ($${diff.originalCost.toFixed(5)})`,
    `Optimized: ${diff.newTokens.toLocaleString()} tokens  ($${diff.newCost.toFixed(5)})`,
    '',
    `Saved: ${diff.diffTokens} tokens (${savingsPercent}%)`,
    `Monthly Savings: $${diff.projectedMonthlySavings.toFixed(2)}/mo`,
  ];

  const action = await vscode.window.showInformationMessage(
    lines.join('\n'),
    '📋 Copy Optimized Prompt',
    '📊 Share Snapshot'
  );

  if (action === '📋 Copy Optimized Prompt') {
    await copyOptimizedPrompt(trace, integration);
  } else if (action === '📊 Share Snapshot') {
    await shareCostSnapshot(trace, {} as any, diff);
  }
}

async function copyOptimizedPrompt(
  trace: TraceRecord,
  integration: Integration
): Promise<void> {
  const { optimized } = integration.optimizeTrace(trace);
  const text = optimized
    .map((m) => `[${m.role}]\n${m.content}`)
    .join('\n\n---\n\n');
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage('✅ Optimized prompt copied to clipboard!');
}
