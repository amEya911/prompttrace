import * as vscode from 'vscode';
export function startDocLogger(output: vscode.OutputChannel) {
  setInterval(() => {
    const docs = vscode.workspace.textDocuments.map(d => `${d.uri.toString()} (${d.getText().length} chars)`);
    output.appendLine(`[Debug] Open docs: ${docs.join(', ')}`);
  }, 2000);
}
