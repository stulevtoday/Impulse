import * as vscode from "vscode";
import * as path from "path";
import { DaemonClient } from "./daemon-client";

const IMPORT_PATTERNS = [
  /from\s+['"]([^'"]+)['"]/,
  /import\s+['"]([^'"]+)['"]/,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
];

export class ImpulseHoverProvider implements vscode.HoverProvider {
  constructor(private client: DaemonClient) {}

  async provideHover(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    const line = doc.lineAt(position.line).text;

    for (const pattern of IMPORT_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;

      const importPath = match[1];
      if (importPath.startsWith(".")) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!workspaceFolder) return null;

        const dir = path.dirname(doc.uri.fsPath);
        let resolved = path.resolve(dir, importPath);
        const rel = path.relative(workspaceFolder.uri.fsPath, resolved);

        const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
        let targetRel: string | null = null;
        for (const ext of extensions) {
          const candidate = rel + ext;
          try {
            const focus = await this.client.focus(candidate);
            if (focus.exists) {
              targetRel = candidate;
              break;
            }
          } catch {
            return null;
          }
        }

        if (!targetRel) {
          for (const ext of extensions) {
            const candidate = rel + "/index" + (ext || ".ts");
            try {
              const focus = await this.client.focus(candidate);
              if (focus.exists) {
                targetRel = candidate;
                break;
              }
            } catch {
              return null;
            }
          }
        }

        if (!targetRel) return null;

        try {
          const focus = await this.client.focus(targetRel);
          if (!focus.exists) return null;

          const md = new vscode.MarkdownString();
          md.isTrusted = true;

          md.appendMarkdown(`**Impulse** — \`${targetRel}\`\n\n`);
          md.appendMarkdown(`| | |\n|---|---|\n`);
          md.appendMarkdown(`| Imported by | ${focus.importedBy.length} file(s) |\n`);
          md.appendMarkdown(`| Blast radius | ${focus.blastRadius} file(s) |\n`);
          md.appendMarkdown(`| Exports | ${focus.exports.length} (${focus.exports.filter((e) => e.dead).length} unused) |\n`);

          if (focus.testsCovering.length > 0) {
            md.appendMarkdown(`| Tests | ${focus.testsCovering.length} file(s) |\n`);
          }

          if (focus.gitChanges > 0) {
            md.appendMarkdown(`| Git changes | ${focus.gitChanges}${focus.lastChanged ? ` (last ${focus.lastChanged})` : ""} |\n`);
          }

          return new vscode.Hover(md);
        } catch {
          return null;
        }
      }
    }

    return null;
  }
}
