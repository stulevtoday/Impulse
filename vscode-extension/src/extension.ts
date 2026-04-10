import * as vscode from "vscode";
import { DaemonClient } from "./daemon-client";
import { ImpulseCodeLensProvider } from "./codelens-provider";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";

let client: DaemonClient;
let codeLensProvider: ImpulseCodeLensProvider;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let daemonProcess: ChildProcess | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("impulse");
  const port = config.get<number>("daemonPort", 4096);

  client = new DaemonClient(port);
  codeLensProvider = new ImpulseCodeLensProvider(client);
  outputChannel = vscode.window.createOutputChannel("Impulse");

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  statusBarItem.command = "impulse.showImpact";
  context.subscriptions.push(statusBarItem);

  const codeLensSelector: vscode.DocumentSelector = [
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "javascript" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "python" },
    { scheme: "file", language: "go" },
    { scheme: "file", language: "rust" },
    { scheme: "file", language: "java" },
    { scheme: "file", language: "kotlin" },
    { scheme: "file", language: "php" },
  ];

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(codeLensSelector, codeLensProvider),
    vscode.commands.registerCommand("impulse.showImpact", showImpact),
    vscode.commands.registerCommand("impulse.showDependencies", showDependencies),
    vscode.commands.registerCommand("impulse.showDependents", showDependents),
    vscode.commands.registerCommand("impulse.showHealth", showHealth),
    vscode.commands.registerCommand("impulse.restartDaemon", restartDaemon),
  );

  if (config.get<boolean>("showImpactOnSave", true)) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        onFileSave(doc);
        codeLensProvider.refresh();
      }),
    );
  }

  context.subscriptions.push({ dispose: stopDaemon });

  ensureDaemon();

  const statusInterval = setInterval(updateStatusBar, 10_000);
  context.subscriptions.push({ dispose: () => clearInterval(statusInterval) });
}

export function deactivate(): void {
  stopDaemon();
  statusBarItem?.dispose();
  outputChannel?.dispose();
}

// ── Daemon lifecycle ────────────────────────────────────────────────

async function ensureDaemon(): Promise<void> {
  statusBarItem.text = "$(loading~spin) Impulse";
  statusBarItem.tooltip = "Connecting to daemon...";
  statusBarItem.show();

  if (await client.isRunning()) {
    outputChannel.appendLine("Impulse daemon already running");
    await updateStatusBar();
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    statusBarItem.text = "$(circle-slash) Impulse";
    statusBarItem.tooltip = "No workspace folder open";
    return;
  }

  await startDaemon(workspaceRoot);
}

async function startDaemon(workspaceRoot: string): Promise<void> {
  statusBarItem.text = "$(loading~spin) Impulse starting...";
  statusBarItem.show();
  outputChannel.appendLine(`Starting daemon for ${workspaceRoot}...`);

  const config = vscode.workspace.getConfiguration("impulse");
  const customPath = config.get<string>("cliPath", "");

  const cmd = customPath || "npx";
  const args = customPath
    ? ["daemon", workspaceRoot]
    : ["impulse-analyzer", "daemon", workspaceRoot];

  try {
    daemonProcess = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workspaceRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
      detached: false,
    });

    daemonProcess.stdout?.on("data", (data: Buffer) => {
      outputChannel.appendLine(data.toString().trim());
    });
    daemonProcess.stderr?.on("data", (data: Buffer) => {
      outputChannel.appendLine(`[stderr] ${data.toString().trim()}`);
    });
    daemonProcess.on("exit", (code) => {
      outputChannel.appendLine(`Daemon exited with code ${code}`);
      daemonProcess = null;
      statusBarItem.text = "$(circle-slash) Impulse offline";
      statusBarItem.tooltip = "Daemon stopped. Click to restart.";
      statusBarItem.command = "impulse.restartDaemon";
    });

    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (await client.isRunning()) {
        outputChannel.appendLine("Daemon ready");
        await updateStatusBar();
        return;
      }
    }

    outputChannel.appendLine("Daemon did not become ready in 30s");
    statusBarItem.text = "$(warning) Impulse timeout";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to start daemon: ${msg}`);

    if (msg.includes("ENOENT")) {
      const action = await vscode.window.showWarningMessage(
        "Impulse CLI not found. Install it?",
        "npm install -g impulse-analyzer",
      );
      if (action) {
        const terminal = vscode.window.createTerminal("Impulse Install");
        terminal.sendText("npm install -g impulse-analyzer");
        terminal.show();
      }
    }

    statusBarItem.text = "$(circle-slash) Impulse offline";
    statusBarItem.tooltip = "Could not start daemon";
  }
}

function stopDaemon(): void {
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }
}

async function restartDaemon(): Promise<void> {
  stopDaemon();
  await ensureDaemon();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Status bar ──────────────────────────────────────────────────────

async function updateStatusBar(): Promise<void> {
  try {
    const status = await client.status();
    if (!status.ready) {
      statusBarItem.text = "$(loading~spin) Impulse indexing...";
      statusBarItem.command = "impulse.showImpact";
      statusBarItem.show();
      return;
    }

    try {
      const health = await client.health();
      statusBarItem.text = `$(pulse) ${health.grade} · ${status.nodes} nodes`;
      statusBarItem.tooltip = `Impulse: ${health.score}/100 (${health.grade})\n${status.nodes} nodes, ${status.edges} edges\n${health.summary}`;
    } catch {
      statusBarItem.text = `$(pulse) ${status.nodes} nodes`;
      statusBarItem.tooltip = `Impulse: ${status.nodes} nodes, ${status.edges} edges`;
    }
    statusBarItem.command = "impulse.showImpact";
    statusBarItem.show();
  } catch {
    if (!daemonProcess) {
      statusBarItem.text = "$(circle-slash) Impulse offline";
      statusBarItem.tooltip = "Click to start daemon";
      statusBarItem.command = "impulse.restartDaemon";
      statusBarItem.show();
    }
  }
}

// ── Commands ────────────────────────────────────────────────────────

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
    // daemon not running — don't annoy the user
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
  } catch {
    vscode.window.showErrorMessage(
      "Impulse daemon not reachable. Start with: impulse daemon .",
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
    outputChannel.appendLine("Impulse — Architecture Health Report\n");
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

    outputChannel.appendLine("Stats:");
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
      outputChannel.appendLine("\nGod Files:");
      for (const gf of report.godFiles) {
        outputChannel.appendLine(`  ${gf.file} — ${gf.importedBy} dependents, ${gf.imports} imports`);
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
