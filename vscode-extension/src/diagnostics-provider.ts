import * as vscode from "vscode";
import { DaemonClient } from "./daemon-client";

export class ImpulseDiagnosticsProvider {
  private collection: vscode.DiagnosticCollection;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private client: DaemonClient) {
    this.collection = vscode.languages.createDiagnosticCollection("impulse");
  }

  dispose(): void {
    this.collection.dispose();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  startAutoRefresh(intervalMs = 30_000): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), intervalMs);
  }

  async refresh(): Promise<void> {
    try {
      const secrets = await this.client.secrets();
      this.collection.clear();

      const byFile = new Map<string, vscode.Diagnostic[]>();

      for (const issue of secrets.issues) {
        const severity = issue.severity === "critical"
          ? vscode.DiagnosticSeverity.Error
          : issue.severity === "warning"
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;

        const diag = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          issue.message,
          severity,
        );
        diag.source = "Impulse";
        diag.code = issue.category;

        const file = issue.file ?? ".env";
        const existing = byFile.get(file) ?? [];
        existing.push(diag);
        byFile.set(file, existing);
      }

      for (const [file, diags] of byFile) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (workspaceRoot) {
          const fileUri = vscode.Uri.joinPath(workspaceRoot, file);
          this.collection.set(fileUri, diags);
        }
      }
    } catch {
      // daemon not available
    }
  }
}
