import * as vscode from "vscode";
import { DaemonClient } from "./daemon-client";
import * as path from "path";

let client: DaemonClient;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("impulse");
  const port = config.get<number>("daemonPort", 4096);

  client = new DaemonClient(port);
  outputChannel = vscode.window.createOutputChannel("Impulse");

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  statusBarItem.command = "impulse.showImpact";
  context.subscriptions.push(statusBarItem);

  updateStatusBar();
  const statusInterval = setInterval(updateStatusBar, 10_000);
  context.subscriptions.push({ dispose: () => clearInterval(statusInterval) });

  context.subscriptions.push(
    vscode.commands.registerCommand("impulse.showImpact", showImpact),
    vscode.commands.registerCommand("impulse.showDependencies", showDependencies),
    vscode.commands.registerCommand("impulse.showDependents", showDependents),
    vscode.commands.registerCommand("impulse.showHealth", showHealth),
  );

  if (config.get<boolean>("showImpactOnSave", true)) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(onFileSave),
    );
  }

  outputChannel.appendLine(`Impulse extension activated (daemon port: ${port})`);
}

export function deactivate(): void {
  statusBarItem?.dispose();
  outputChannel?.dispose();
}

async function updateStatusBar(): Promise<void> {
  try {
    const status = await client.status();
    if (!status.ready) {
      statusBarItem.text = "$(loading~spin) Impulse indexing...";
      statusBarItem.show();
      return;
    }

    try {
      const health = await client.health();
      statusBarItem.text = `$(pulse) ${health.grade} · ${status.nodes} nodes`;
      statusBarItem.tooltip = `Impulse: ${health.score}/100 (${health.grade}) — ${status.nodes} nodes, ${status.edges} edges\n${health.summary}`;
    } catch {
      statusBarItem.text = `$(pulse) ${status.nodes} nodes`;
      statusBarItem.tooltip = `Impulse: ${status.nodes} nodes, ${status.edges} edges`;
    }
    statusBarItem.show();
  } catch {
    statusBarItem.text = "$(circle-slash) Impulse offline";
    statusBarItem.tooltip = "Impulse daemon is not running. Start with: impulse daemon .";
    statusBarItem.show();
  }
}

function getRelativePath(doc: vscode.TextDocument): string | null {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!workspaceFolder) return null;
  return path.relative(workspaceFolder.uri.fsPath, doc.uri.fsPath);
}

async function onFileSave(doc: vscode.TextDocument): Promise<void> {
  const relPath = getRelativePath(doc);
  if (!relPath) return;

  try {
    const result = await client.impact(relPath);
    if (result.count === 0) return;

    const fileNames = result.affected
      .slice(0, 5)
      .map((a) => path.basename(a.file))
      .join(", ");

    const suffix = result.count > 5 ? ` +${result.count - 5} more` : "";
    const message = `Impulse: ${result.count} file(s) affected — ${fileNames}${suffix}`;

    const action = await vscode.window.showInformationMessage(message, "Show Details");
    if (action === "Show Details") {
      showImpactDetails(relPath, result);
    }
  } catch {
    // daemon not running, silently ignore
  }
}

async function showImpact(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active file");
    return;
  }

  const relPath = getRelativePath(editor.document);
  if (!relPath) return;

  try {
    const result = await client.impact(relPath);
    if (result.count === 0) {
      vscode.window.showInformationMessage(`${relPath}: no dependents (leaf node)`);
      return;
    }
    showImpactDetails(relPath, result);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Impulse daemon not reachable. Start with: impulse daemon .`,
    );
  }
}

function showImpactDetails(
  file: string,
  result: { affected: Array<{ file: string; depth: number }>; count: number },
): void {
  outputChannel.clear();
  outputChannel.appendLine(`Impact analysis: ${file}`);
  outputChannel.appendLine(`${result.count} file(s) affected:\n`);

  const byDepth = new Map<number, string[]>();
  for (const a of result.affected) {
    const list = byDepth.get(a.depth) ?? [];
    list.push(a.file);
    byDepth.set(a.depth, list);
  }

  for (const [depth, files] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const label = depth === 1 ? "Direct" : `Depth ${depth}`;
    outputChannel.appendLine(`  ${label}:`);
    for (const f of files) {
      outputChannel.appendLine(`    → ${f}`);
    }
  }

  outputChannel.show();
}

async function showDependencies(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const relPath = getRelativePath(editor.document);
  if (!relPath) return;

  try {
    const result = await client.dependencies(relPath);
    const local = result.dependencies.filter((d) => !d.external);
    const external = result.dependencies.filter((d) => d.external);

    outputChannel.clear();
    outputChannel.appendLine(`Dependencies of: ${relPath}\n`);

    if (local.length > 0) {
      outputChannel.appendLine(`  Local (${local.length}):`);
      for (const d of local) outputChannel.appendLine(`    → ${d.target}`);
    }
    if (external.length > 0) {
      outputChannel.appendLine(`  External (${external.length}):`);
      for (const d of external) outputChannel.appendLine(`    → ${d.target}`);
    }

    outputChannel.show();
  } catch {
    vscode.window.showErrorMessage("Impulse daemon not reachable");
  }
}

async function showHealth(): Promise<void> {
  try {
    const report = await client.health();

    outputChannel.clear();
    outputChannel.appendLine(`Impulse — Architecture Health Report\n`);
    outputChannel.appendLine(`Score: ${report.score}/100 (${report.grade})`);
    outputChannel.appendLine(`${report.summary}\n`);

    const p = report.penalties;
    const penalties = Object.entries(p).filter(([, v]) => v > 0);
    if (penalties.length > 0) {
      outputChannel.appendLine("Penalties:");
      if (p.cycles > 0) outputChannel.appendLine(`  Cycles:            -${p.cycles}`);
      if (p.godFiles > 0) outputChannel.appendLine(`  God files:         -${p.godFiles}`);
      if (p.deepChains > 0) outputChannel.appendLine(`  Deep chains:       -${p.deepChains}`);
      if (p.orphans > 0) outputChannel.appendLine(`  Orphans:           -${p.orphans}`);
      if (p.hubConcentration > 0) outputChannel.appendLine(`  Hub concentration: -${p.hubConcentration}`);
      outputChannel.appendLine("");
    }

    outputChannel.appendLine(`Stats:`);
    outputChannel.appendLine(`  Files:           ${report.stats.totalFiles}`);
    outputChannel.appendLine(`  Local edges:     ${report.stats.localEdges}`);
    outputChannel.appendLine(`  External edges:  ${report.stats.externalEdges}`);
    outputChannel.appendLine(`  Avg imports:     ${report.stats.avgImports}`);
    outputChannel.appendLine(`  Max imported by: ${report.stats.maxImportedBy}`);

    if (report.cycles.length > 0) {
      outputChannel.appendLine(`\nCircular Dependencies (${report.cycles.length}):`);
      for (const c of report.cycles) {
        const display = c.severity === "tight-couple"
          ? `  ${c.cycle[0]} ↔ ${c.cycle[1]}`
          : `  ${c.cycle.join(" → ")}`;
        outputChannel.appendLine(`${display}  (${c.severity})`);
      }
    }

    if (report.godFiles.length > 0) {
      outputChannel.appendLine(`\nGod Files:`);
      for (const gf of report.godFiles) {
        outputChannel.appendLine(`  ${gf.file} — ${gf.importedBy} dependents, ${gf.imports} imports`);
      }
    }

    if (report.orphans.length > 0) {
      outputChannel.appendLine(`\nIsolated Files (${report.orphans.length}):`);
      for (const o of report.orphans) {
        outputChannel.appendLine(`  ${o}`);
      }
    }

    outputChannel.show();
  } catch {
    vscode.window.showErrorMessage("Impulse daemon not reachable");
  }
}

async function showDependents(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const relPath = getRelativePath(editor.document);
  if (!relPath) return;

  try {
    const result = await client.dependents(relPath);

    outputChannel.clear();
    outputChannel.appendLine(`Who imports: ${relPath}\n`);

    if (result.dependents.length === 0) {
      outputChannel.appendLine("  No files import this module.");
    } else {
      for (const d of result.dependents) {
        outputChannel.appendLine(`  ← ${d.source}`);
      }
    }

    outputChannel.show();
  } catch {
    vscode.window.showErrorMessage("Impulse daemon not reachable");
  }
}
