"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode4 = __toESM(require("vscode"));

// src/daemon-client.ts
var http = __toESM(require("http"));
var DaemonClient = class {
  constructor(port) {
    this.port = port;
  }
  port;
  async status() {
    return this.get("/status");
  }
  async impact(file, depth = 10) {
    return this.get(`/impact?file=${encodeURIComponent(file)}&depth=${depth}`);
  }
  async files() {
    return this.get("/files");
  }
  async dependencies(file) {
    return this.get(`/dependencies?file=${encodeURIComponent(file)}`);
  }
  async dependents(file) {
    return this.get(`/dependents?file=${encodeURIComponent(file)}`);
  }
  async health() {
    return this.get("/health");
  }
  async focus(file) {
    return this.get(`/focus?file=${encodeURIComponent(file)}`);
  }
  async review() {
    return this.get("/review");
  }
  async explain(file) {
    const q = file ? `?file=${encodeURIComponent(file)}` : "";
    return this.get(`/explain${q}`);
  }
  async secrets() {
    return this.get("/secrets");
  }
  async owners(file) {
    const q = file ? `?file=${encodeURIComponent(file)}` : "";
    return this.get(`/owners${q}`);
  }
  async isRunning() {
    try {
      const status = await this.status();
      return status.ready;
    } catch {
      return false;
    }
  }
  get(path4) {
    return new Promise((resolve2, reject) => {
      const req = http.get(
        { hostname: "localhost", port: this.port, path: path4, timeout: 3e3 },
        (res) => {
          let data = "";
          res.on("data", (chunk) => data += chunk);
          res.on("end", () => {
            try {
              resolve2(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Invalid JSON from daemon: ${data.slice(0, 100)}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Daemon request timed out"));
      });
    });
  }
};

// src/codelens-provider.ts
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));
var ImpulseCodeLensProvider = class {
  constructor(client2) {
    this.client = client2;
  }
  client;
  _onDidChange = new vscode.EventEmitter();
  onDidChangeCodeLenses = this._onDidChange.event;
  refresh() {
    this._onDidChange.fire();
  }
  async provideCodeLenses(doc) {
    const relPath = getRelativePath(doc);
    if (!relPath) return [];
    let focus;
    try {
      focus = await this.client.focus(relPath);
    } catch {
      return [];
    }
    if (!focus.exists) return [];
    const lenses = [];
    if (focus.blastRadius > 0 || focus.importedBy.length > 0) {
      let ownershipLabel = "";
      try {
        const owners = await this.client.owners(relPath);
        if (owners.busFactor !== void 0 && owners.busFactor > 0) {
          ownershipLabel = ` \xB7 bus factor ${owners.busFactor}`;
          if (owners.busFactor <= 1) ownershipLabel += " \u26A0";
        }
      } catch {
      }
      lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: `$(pulse) ${focus.importedBy.length} importer(s) \xB7 blast radius ${focus.blastRadius}${ownershipLabel}`,
        command: "impulse.showImpact",
        tooltip: `${focus.importedBy.length} files import this module. Changing it can affect ${focus.blastRadius} files.${ownershipLabel ? `
Bus factor: ${ownershipLabel.replace(" \xB7 bus factor ", "")}` : ""}`
      }));
    }
    for (const exp of focus.exports) {
      const line = findExportLine(doc, exp.name);
      if (line === -1) continue;
      const range = new vscode.Range(line, 0, line, 0);
      if (exp.dead) {
        lenses.push(new vscode.CodeLens(range, {
          title: `$(warning) unused export \u2014 no consumers`,
          command: "",
          tooltip: `"${exp.name}" is exported but nothing imports it. Consider removing it.`
        }));
      } else {
        const label = formatExportLabel(exp);
        lenses.push(new vscode.CodeLens(range, {
          title: label,
          command: "",
          tooltip: `"${exp.name}" is used by: ${exp.consumers.slice(0, 5).join(", ")}${exp.consumers.length > 5 ? ` +${exp.consumers.length - 5} more` : ""}`
        }));
      }
    }
    return lenses;
  }
};
function formatExportLabel(exp) {
  const n = exp.consumers.length;
  if (n === 1) return `$(symbol-field) 1 consumer`;
  return `$(symbol-field) ${n} consumers`;
}
function getRelativePath(doc) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (!workspaceFolder) return null;
  return path.relative(workspaceFolder.uri.fsPath, doc.uri.fsPath);
}
var EXPORT_PATTERNS = [
  (name) => new RegExp(`^\\s*export\\s+(?:async\\s+)?(?:function|class|interface|type|enum|const|let|var)\\s+${escRe(name)}\\b`),
  (name) => new RegExp(`^\\s*export\\s+default\\s+(?:async\\s+)?(?:function|class)\\s+${escRe(name)}\\b`),
  (name) => new RegExp(`^\\s*export\\s*\\{[^}]*\\b${escRe(name)}\\b`)
];
function findExportLine(doc, name) {
  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    for (const build of EXPORT_PATTERNS) {
      if (build(name).test(text)) return i;
    }
  }
  return -1;
}
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/diagnostics-provider.ts
var vscode2 = __toESM(require("vscode"));
var ImpulseDiagnosticsProvider = class {
  constructor(client2) {
    this.client = client2;
    this.collection = vscode2.languages.createDiagnosticCollection("impulse");
  }
  client;
  collection;
  refreshTimer = null;
  dispose() {
    this.collection.dispose();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
  startAutoRefresh(intervalMs = 3e4) {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), intervalMs);
  }
  async refresh() {
    try {
      const secrets = await this.client.secrets();
      this.collection.clear();
      const byFile = /* @__PURE__ */ new Map();
      for (const issue of secrets.issues) {
        const severity = issue.severity === "critical" ? vscode2.DiagnosticSeverity.Error : issue.severity === "warning" ? vscode2.DiagnosticSeverity.Warning : vscode2.DiagnosticSeverity.Information;
        const diag = new vscode2.Diagnostic(
          new vscode2.Range(0, 0, 0, 0),
          issue.message,
          severity
        );
        diag.source = "Impulse";
        diag.code = issue.category;
        const file = issue.file ?? ".env";
        const existing = byFile.get(file) ?? [];
        existing.push(diag);
        byFile.set(file, existing);
      }
      for (const [file, diags] of byFile) {
        const workspaceRoot = vscode2.workspace.workspaceFolders?.[0]?.uri;
        if (workspaceRoot) {
          const fileUri = vscode2.Uri.joinPath(workspaceRoot, file);
          this.collection.set(fileUri, diags);
        }
      }
    } catch {
    }
  }
};

// src/hover-provider.ts
var vscode3 = __toESM(require("vscode"));
var path2 = __toESM(require("path"));
var IMPORT_PATTERNS = [
  /from\s+['"]([^'"]+)['"]/,
  /import\s+['"]([^'"]+)['"]/,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/
];
var ImpulseHoverProvider = class {
  constructor(client2) {
    this.client = client2;
  }
  client;
  async provideHover(doc, position) {
    const line = doc.lineAt(position.line).text;
    for (const pattern of IMPORT_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;
      const importPath = match[1];
      if (importPath.startsWith(".")) {
        const workspaceFolder = vscode3.workspace.getWorkspaceFolder(doc.uri);
        if (!workspaceFolder) return null;
        const dir = path2.dirname(doc.uri.fsPath);
        let resolved = path2.resolve(dir, importPath);
        const rel = path2.relative(workspaceFolder.uri.fsPath, resolved);
        const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
        let targetRel = null;
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
          const md = new vscode3.MarkdownString();
          md.isTrusted = true;
          md.appendMarkdown(`**Impulse** \u2014 \`${targetRel}\`

`);
          md.appendMarkdown(`| | |
|---|---|
`);
          md.appendMarkdown(`| Imported by | ${focus.importedBy.length} file(s) |
`);
          md.appendMarkdown(`| Blast radius | ${focus.blastRadius} file(s) |
`);
          md.appendMarkdown(`| Exports | ${focus.exports.length} (${focus.exports.filter((e) => e.dead).length} unused) |
`);
          if (focus.testsCovering.length > 0) {
            md.appendMarkdown(`| Tests | ${focus.testsCovering.length} file(s) |
`);
          }
          if (focus.gitChanges > 0) {
            md.appendMarkdown(`| Git changes | ${focus.gitChanges}${focus.lastChanged ? ` (last ${focus.lastChanged})` : ""} |
`);
          }
          return new vscode3.Hover(md);
        } catch {
          return null;
        }
      }
    }
    return null;
  }
};

// src/extension.ts
var import_child_process = require("child_process");
var path3 = __toESM(require("path"));
var client;
var codeLensProvider;
var diagnosticsProvider;
var hoverProvider;
var statusBarItem;
var outputChannel;
var daemonProcess = null;
function activate(context) {
  const config = vscode4.workspace.getConfiguration("impulse");
  const port = config.get("daemonPort", 4096);
  client = new DaemonClient(port);
  codeLensProvider = new ImpulseCodeLensProvider(client);
  diagnosticsProvider = new ImpulseDiagnosticsProvider(client);
  hoverProvider = new ImpulseHoverProvider(client);
  outputChannel = vscode4.window.createOutputChannel("Impulse");
  statusBarItem = vscode4.window.createStatusBarItem(
    vscode4.StatusBarAlignment.Left,
    50
  );
  statusBarItem.command = "impulse.showImpact";
  context.subscriptions.push(statusBarItem);
  const codeLensSelector = [
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "javascript" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "python" },
    { scheme: "file", language: "go" },
    { scheme: "file", language: "rust" },
    { scheme: "file", language: "java" },
    { scheme: "file", language: "kotlin" },
    { scheme: "file", language: "php" }
  ];
  context.subscriptions.push(
    vscode4.languages.registerCodeLensProvider(codeLensSelector, codeLensProvider),
    vscode4.languages.registerHoverProvider(codeLensSelector, hoverProvider),
    vscode4.commands.registerCommand("impulse.showImpact", showImpact),
    vscode4.commands.registerCommand("impulse.showDependencies", showDependencies),
    vscode4.commands.registerCommand("impulse.showDependents", showDependents),
    vscode4.commands.registerCommand("impulse.showHealth", showHealth),
    vscode4.commands.registerCommand("impulse.explain", showExplain),
    vscode4.commands.registerCommand("impulse.restartDaemon", restartDaemon),
    diagnosticsProvider
  );
  if (config.get("showImpactOnSave", true)) {
    context.subscriptions.push(
      vscode4.workspace.onDidSaveTextDocument((doc) => {
        onFileSave(doc);
        codeLensProvider.refresh();
        diagnosticsProvider.refresh();
      })
    );
  }
  context.subscriptions.push({ dispose: stopDaemon });
  ensureDaemon();
  diagnosticsProvider.startAutoRefresh(3e4);
  const statusInterval = setInterval(updateStatusBar, 1e4);
  context.subscriptions.push({ dispose: () => clearInterval(statusInterval) });
}
function deactivate() {
  stopDaemon();
  statusBarItem?.dispose();
  outputChannel?.dispose();
}
async function ensureDaemon() {
  statusBarItem.text = "$(loading~spin) Impulse";
  statusBarItem.tooltip = "Connecting to daemon...";
  statusBarItem.show();
  if (await client.isRunning()) {
    outputChannel.appendLine("Impulse daemon already running");
    await updateStatusBar();
    return;
  }
  const workspaceRoot = vscode4.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    statusBarItem.text = "$(circle-slash) Impulse";
    statusBarItem.tooltip = "No workspace folder open";
    return;
  }
  await startDaemon(workspaceRoot);
}
async function startDaemon(workspaceRoot) {
  statusBarItem.text = "$(loading~spin) Impulse starting...";
  statusBarItem.show();
  outputChannel.appendLine(`Starting daemon for ${workspaceRoot}...`);
  const config = vscode4.workspace.getConfiguration("impulse");
  const customPath = config.get("cliPath", "");
  const cmd = customPath || "npx";
  const args = customPath ? ["daemon", workspaceRoot] : ["impulse-analyzer", "daemon", workspaceRoot];
  try {
    daemonProcess = (0, import_child_process.spawn)(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workspaceRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
      detached: false
    });
    daemonProcess.stdout?.on("data", (data) => {
      outputChannel.appendLine(data.toString().trim());
    });
    daemonProcess.stderr?.on("data", (data) => {
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
      const action = await vscode4.window.showWarningMessage(
        "Impulse CLI not found. Install it?",
        "npm install -g impulse-analyzer"
      );
      if (action) {
        const terminal = vscode4.window.createTerminal("Impulse Install");
        terminal.sendText("npm install -g impulse-analyzer");
        terminal.show();
      }
    }
    statusBarItem.text = "$(circle-slash) Impulse offline";
    statusBarItem.tooltip = "Could not start daemon";
  }
}
function stopDaemon() {
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }
}
async function restartDaemon() {
  stopDaemon();
  await ensureDaemon();
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function updateStatusBar() {
  try {
    const status = await client.status();
    if (!status.ready) {
      statusBarItem.text = "$(loading~spin) Impulse indexing...";
      statusBarItem.command = "impulse.showImpact";
      statusBarItem.show();
      return;
    }
    try {
      const review = await client.review();
      const verdictIcons = {
        ship: "$(check)",
        review: "$(warning)",
        hold: "$(error)"
      };
      const icon = verdictIcons[review.verdict.level] ?? "$(pulse)";
      const label = review.verdict.level.toUpperCase();
      if (review.changedFiles.length === 0) {
        const health = await client.health();
        statusBarItem.text = `$(pulse) ${health.grade} \xB7 ${status.nodes} files`;
        statusBarItem.tooltip = `Impulse: ${health.score}/100 (${health.grade})
${status.nodes} nodes, ${status.edges} edges
${health.summary}`;
      } else {
        statusBarItem.text = `${icon} ${label} \xB7 ${review.changedFiles.length} changed`;
        statusBarItem.tooltip = `Impulse: ${label}
${review.changedFiles.length} file(s) changed \u2192 ${review.totalAffected} affected
${review.verdict.reasons.join("\n")}

${review.durationMs}ms`;
      }
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
function getRelativePath2(doc) {
  const workspaceFolder = vscode4.workspace.getWorkspaceFolder(doc.uri);
  if (!workspaceFolder) return null;
  return path3.relative(workspaceFolder.uri.fsPath, doc.uri.fsPath);
}
async function onFileSave(doc) {
  const relPath = getRelativePath2(doc);
  if (!relPath) return;
  try {
    const result = await client.impact(relPath);
    if (result.count === 0) return;
    const fileNames = result.affected.slice(0, 5).map((a) => path3.basename(a.file)).join(", ");
    const suffix = result.count > 5 ? ` +${result.count - 5} more` : "";
    const message = `Impulse: ${result.count} file(s) affected \u2014 ${fileNames}${suffix}`;
    const action = await vscode4.window.showInformationMessage(message, "Show Details");
    if (action === "Show Details") {
      showImpactDetails(relPath, result);
    }
  } catch {
  }
}
async function showImpact() {
  const editor = vscode4.window.activeTextEditor;
  if (!editor) {
    vscode4.window.showWarningMessage("No active file");
    return;
  }
  const relPath = getRelativePath2(editor.document);
  if (!relPath) return;
  try {
    const result = await client.impact(relPath);
    if (result.count === 0) {
      vscode4.window.showInformationMessage(`${relPath}: no dependents (leaf node)`);
      return;
    }
    showImpactDetails(relPath, result);
  } catch {
    vscode4.window.showErrorMessage(
      "Impulse daemon not reachable. Start with: impulse daemon ."
    );
  }
}
function showImpactDetails(file, result) {
  outputChannel.clear();
  outputChannel.appendLine(`Impact analysis: ${file}`);
  outputChannel.appendLine(`${result.count} file(s) affected:
`);
  const byDepth = /* @__PURE__ */ new Map();
  for (const a of result.affected) {
    const list = byDepth.get(a.depth) ?? [];
    list.push(a.file);
    byDepth.set(a.depth, list);
  }
  for (const [depth, files] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const label = depth === 1 ? "Direct" : `Depth ${depth}`;
    outputChannel.appendLine(`  ${label}:`);
    for (const f of files) {
      outputChannel.appendLine(`    \u2192 ${f}`);
    }
  }
  outputChannel.show();
}
async function showDependencies() {
  const editor = vscode4.window.activeTextEditor;
  if (!editor) return;
  const relPath = getRelativePath2(editor.document);
  if (!relPath) return;
  try {
    const result = await client.dependencies(relPath);
    const local = result.dependencies.filter((d) => !d.external);
    const external = result.dependencies.filter((d) => d.external);
    outputChannel.clear();
    outputChannel.appendLine(`Dependencies of: ${relPath}
`);
    if (local.length > 0) {
      outputChannel.appendLine(`  Local (${local.length}):`);
      for (const d of local) outputChannel.appendLine(`    \u2192 ${d.target}`);
    }
    if (external.length > 0) {
      outputChannel.appendLine(`  External (${external.length}):`);
      for (const d of external) outputChannel.appendLine(`    \u2192 ${d.target}`);
    }
    outputChannel.show();
  } catch {
    vscode4.window.showErrorMessage("Impulse daemon not reachable");
  }
}
async function showHealth() {
  try {
    const report = await client.health();
    outputChannel.clear();
    outputChannel.appendLine("Impulse \u2014 Architecture Health Report\n");
    outputChannel.appendLine(`Score: ${report.score}/100 (${report.grade})`);
    outputChannel.appendLine(`${report.summary}
`);
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
      outputChannel.appendLine(`
Circular Dependencies (${report.cycles.length}):`);
      for (const c of report.cycles) {
        const display = c.severity === "tight-couple" ? `  ${c.cycle[0]} \u2194 ${c.cycle[1]}` : `  ${c.cycle.join(" \u2192 ")}`;
        outputChannel.appendLine(`${display}  (${c.severity})`);
      }
    }
    if (report.godFiles.length > 0) {
      outputChannel.appendLine("\nGod Files:");
      for (const gf of report.godFiles) {
        outputChannel.appendLine(`  ${gf.file} \u2014 ${gf.importedBy} dependents, ${gf.imports} imports`);
      }
    }
    outputChannel.show();
  } catch {
    vscode4.window.showErrorMessage("Impulse daemon not reachable");
  }
}
async function showExplain() {
  const editor = vscode4.window.activeTextEditor;
  const relPath = editor ? getRelativePath2(editor.document) : null;
  try {
    const result = await client.explain(relPath ?? void 0);
    outputChannel.clear();
    if (result.file) {
      outputChannel.appendLine(`Impulse \u2014 Explain: ${result.file}
`);
    } else {
      outputChannel.appendLine(`Impulse \u2014 Project Explanation
`);
    }
    outputChannel.appendLine(result.summary);
    outputChannel.appendLine("");
    for (const section of result.sections) {
      outputChannel.appendLine(`\u2500\u2500 ${section.heading} \u2500\u2500`);
      for (const line of section.lines) {
        outputChannel.appendLine(`  ${line}`);
      }
      outputChannel.appendLine("");
    }
    outputChannel.show();
  } catch {
    vscode4.window.showErrorMessage("Impulse daemon not reachable");
  }
}
async function showDependents() {
  const editor = vscode4.window.activeTextEditor;
  if (!editor) return;
  const relPath = getRelativePath2(editor.document);
  if (!relPath) return;
  try {
    const result = await client.dependents(relPath);
    outputChannel.clear();
    outputChannel.appendLine(`Who imports: ${relPath}
`);
    if (result.dependents.length === 0) {
      outputChannel.appendLine("  No files import this module.");
    } else {
      for (const d of result.dependents) {
        outputChannel.appendLine(`  \u2190 ${d.source}`);
      }
    }
    outputChannel.show();
  } catch {
    vscode4.window.showErrorMessage("Impulse daemon not reachable");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
