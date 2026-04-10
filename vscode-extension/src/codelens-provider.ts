import * as vscode from "vscode";
import { DaemonClient, type FocusExport } from "./daemon-client";
import * as path from "path";

export class ImpulseCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private client: DaemonClient) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const relPath = getRelativePath(doc);
    if (!relPath) return [];

    let focus;
    try {
      focus = await this.client.focus(relPath);
    } catch {
      return [];
    }
    if (!focus.exists) return [];

    const lenses: vscode.CodeLens[] = [];

    if (focus.blastRadius > 0 || focus.importedBy.length > 0) {
      lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: `$(pulse) ${focus.importedBy.length} importer(s) · blast radius ${focus.blastRadius}`,
        command: "impulse.showImpact",
        tooltip: `${focus.importedBy.length} files import this module. Changing it can affect ${focus.blastRadius} files.`,
      }));
    }

    for (const exp of focus.exports) {
      const line = findExportLine(doc, exp.name);
      if (line === -1) continue;

      const range = new vscode.Range(line, 0, line, 0);

      if (exp.dead) {
        lenses.push(new vscode.CodeLens(range, {
          title: `$(warning) unused export — no consumers`,
          command: "",
          tooltip: `"${exp.name}" is exported but nothing imports it. Consider removing it.`,
        }));
      } else {
        const label = formatExportLabel(exp);
        lenses.push(new vscode.CodeLens(range, {
          title: label,
          command: "",
          tooltip: `"${exp.name}" is used by: ${exp.consumers.slice(0, 5).join(", ")}${exp.consumers.length > 5 ? ` +${exp.consumers.length - 5} more` : ""}`,
        }));
      }
    }

    return lenses;
  }
}

function formatExportLabel(exp: FocusExport): string {
  const n = exp.consumers.length;
  if (n === 1) return `$(symbol-field) 1 consumer`;
  return `$(symbol-field) ${n} consumers`;
}

function getRelativePath(doc: vscode.TextDocument): string | null {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!workspaceFolder) return null;
  return path.relative(workspaceFolder.uri.fsPath, doc.uri.fsPath);
}

const EXPORT_PATTERNS = [
  (name: string) => new RegExp(`^\\s*export\\s+(?:async\\s+)?(?:function|class|interface|type|enum|const|let|var)\\s+${escRe(name)}\\b`),
  (name: string) => new RegExp(`^\\s*export\\s+default\\s+(?:async\\s+)?(?:function|class)\\s+${escRe(name)}\\b`),
  (name: string) => new RegExp(`^\\s*export\\s*\\{[^}]*\\b${escRe(name)}\\b`),
];

function findExportLine(doc: vscode.TextDocument, name: string): number {
  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    for (const build of EXPORT_PATTERNS) {
      if (build(name).test(text)) return i;
    }
  }
  return -1;
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
