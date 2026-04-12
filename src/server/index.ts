import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { analyzeProject, getFileImpact, updateFile } from "../core/analyzer.js";
import { getParseWarnings } from "../core/parser.js";
import { createWatcher } from "../watchers/fs-watcher.js";
import { loadGraphCache, saveGraphCache } from "../core/cache.js";
import { analyzeHealth } from "../core/health.js";
import { getVisualizationHTML } from "./visualize.js";
import { generateSuggestions } from "../core/suggest.js";
import { loadConfig } from "../core/config.js";
import { checkBoundaries } from "../core/boundaries.js";
import { analyzeHotspots } from "../core/hotspots.js";
import { findTestTargets, getChangedFiles } from "../core/test-targets.js";
import { analyzeCoupling } from "../core/coupling.js";
import { focusFile } from "../core/focus.js";
import { exportGraph, type ExportFormat } from "../core/export-graph.js";
import { analyzeSafeDelete } from "../core/safe-delete.js";
import { generateBadgeSVG, type BadgeStyle } from "../core/badge.js";
import { analyzeComplexity } from "../core/complexity.js";
import { analyzeRisk } from "../core/risk.js";
import { runPlugins } from "../core/plugins.js";
import { runReview } from "../core/review.js";
import { explainFile, explainProject } from "../core/explain.js";
import { analyzeOwnership, getFileOwnership } from "../core/owners.js";
import { analyzeSecrets } from "../core/secrets.js";
import { generateChangelog } from "../core/changelog.js";
import { analyzeDebt } from "../core/debt.js";
import { analyzeDeps } from "../core/deps.js";
import type { DependencyGraph } from "../core/graph.js";
import type { ExtractorContext } from "../core/extractor.js";

interface DaemonState {
  graph: DependencyGraph;
  ctx: ExtractorContext;
  rootDir: string;
  port: number;
  ready: boolean;
  lastChangeAt: number;
  lastChangeFile: string | null;
}

let state: DaemonState | null = null;

type Q = Record<string, string>;
type RouteHandler = (q: Q, res: ServerResponse) => Promise<void> | void;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function requireFile(q: Q, res: ServerResponse): string | null {
  if (!q.file) {
    json(res, 400, { error: "Missing ?file= parameter" });
    return null;
  }
  return q.file;
}

function parseUrl(req: IncomingMessage): { path: string; query: Q } {
  const url = new URL(req.url ?? "/", "http://localhost");
  const query: Q = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  return { path: url.pathname, query };
}

// ---------------------------------------------------------------------------
// Route handlers — one function per endpoint
// ---------------------------------------------------------------------------

function handleStatus(_q: Q, res: ServerResponse): void {
  const stats = state?.graph.stats ?? { nodes: 0, edges: 0 };
  json(res, 200, {
    ready: state?.ready ?? false,
    rootDir: state?.rootDir ?? null,
    ...stats,
    warnings: getParseWarnings().length,
    lastChangeAt: state?.lastChangeAt ?? 0,
    lastChangeFile: state?.lastChangeFile ?? null,
  });
}

function handleImpact(q: Q, res: ServerResponse): void {
  const file = requireFile(q, res);
  if (!file) return;

  const maxDepth = parseInt(q.depth ?? "10", 10);
  const symbol = q.symbol;

  if (symbol) {
    const impact = state!.graph.analyzeExportImpact(file, symbol, maxDepth);
    const fileAffected = impact.affected.filter((a) => a.node.kind === "file");
    json(res, 200, {
      changed: file, symbol,
      affected: fileAffected.map((a) => ({ file: a.node.filePath, depth: a.depth })),
      count: fileAffected.length, precision: "symbol",
    });
  } else {
    const impact = getFileImpact(state!.graph, file, maxDepth);
    const exports = state!.graph.getFileExports(file);
    json(res, 200, {
      changed: impact.changed,
      affected: impact.affected.map((a) => ({ file: a.node.filePath, depth: a.depth, kind: a.node.kind })),
      count: impact.affected.length, precision: "file",
      exports: exports.map((e) => e.name),
    });
  }
}

function handleGraph(_q: Q, res: ServerResponse): void {
  const nodes = state!.graph.allNodes().map((n) => ({ id: n.id, kind: n.kind, file: n.filePath, name: n.name }));
  const edges = state!.graph.allEdges().map((e) => ({ from: e.from, to: e.to, kind: e.kind }));
  json(res, 200, { nodes: nodes.length, edges: edges.length, data: { nodes, edges } });
}

function handleFiles(_q: Q, res: ServerResponse): void {
  const files = state!.graph
    .allNodes()
    .filter((n) => n.kind === "file")
    .map((n) => {
      const deps = state!.graph.getDependencies(n.id);
      const dependents = state!.graph.getDependents(n.id);
      return {
        file: n.filePath,
        imports: deps.filter((e) => e.kind === "imports").length,
        importedBy: dependents.filter((e) => e.kind === "imports").length,
      };
    })
    .sort((a, b) => b.importedBy - a.importedBy);
  json(res, 200, { count: files.length, files });
}

function handleDependencies(q: Q, res: ServerResponse): void {
  const file = requireFile(q, res);
  if (!file) return;
  const deps = state!.graph.getDependencies(`file:${file}`);
  json(res, 200, {
    file,
    dependencies: deps.map((e) => ({
      target: e.to.replace(/^(file:|external:)/, ""),
      kind: e.kind,
      external: e.to.startsWith("external:"),
    })),
  });
}

function handleDependents(q: Q, res: ServerResponse): void {
  const file = requireFile(q, res);
  if (!file) return;
  const deps = state!.graph.getDependents(`file:${file}`);
  json(res, 200, {
    file,
    dependents: deps.map((e) => ({ source: e.from.replace(/^file:/, ""), kind: e.kind })),
  });
}

function handleWarnings(_q: Q, res: ServerResponse): void {
  json(res, 200, { warnings: getParseWarnings() });
}

function handleVisualize(_q: Q, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" });
  res.end(getVisualizationHTML(state!.port));
}

function handleExports(q: Q, res: ServerResponse): void {
  const file = q.file;
  const exportNodes = state!.graph.allNodes().filter((n) =>
    n.kind === "export" && (!file || n.filePath === file),
  );
  const allEdges = state!.graph.allEdges();
  const exports = exportNodes.map((exp) => {
    const users = allEdges.filter((e) => e.to === exp.id && e.kind === "uses_export").map((e) => e.from.replace(/^file:/, ""));
    return { file: exp.filePath, name: exp.name, users, dead: users.length === 0 };
  });
  json(res, 200, { total: exports.length, dead: exports.filter((e) => e.dead).length, exports });
}

async function handleHealth(_q: Q, res: ServerResponse): Promise<void> {
  const config = await loadConfig(state!.rootDir);
  const report = analyzeHealth(state!.graph, config.boundaries);
  json(res, 200, {
    score: report.score, grade: report.grade, summary: report.summary,
    penalties: report.penalties, cycles: report.cycles, godFiles: report.godFiles,
    orphans: report.orphans, stability: report.stability ?? null, stats: report.stats,
  });
}

function handleSuggest(_q: Q, res: ServerResponse): void {
  const health = analyzeHealth(state!.graph);
  const report = generateSuggestions(state!.graph, health);
  json(res, 200, {
    suggestions: report.suggestions,
    estimatedScoreImprovement: report.estimatedScoreImprovement,
    currentScore: health.score,
    potentialScore: health.score + report.estimatedScoreImprovement,
  });
}

async function handleCheck(_q: Q, res: ServerResponse): Promise<void> {
  const config = await loadConfig(state!.rootDir);
  if (!config.boundaries || Object.keys(config.boundaries).length === 0) {
    json(res, 200, { error: "No boundaries defined in .impulserc.json", violations: [] });
    return;
  }
  json(res, 200, checkBoundaries(state!.graph, config.boundaries));
}

function handleHotspots(q: Q, res: ServerResponse): void {
  const maxCommits = parseInt(q.commits ?? "200", 10);
  json(res, 200, analyzeHotspots(state!.graph, state!.rootDir, maxCommits));
}

function handleFocus(q: Q, res: ServerResponse): void {
  const file = requireFile(q, res);
  if (!file) return;
  json(res, 200, focusFile(state!.graph, file, state!.rootDir));
}

function handleCoupling(q: Q, res: ServerResponse): void {
  const maxCommits = parseInt(q.commits ?? "300", 10);
  const minCochanges = parseInt(q.minCochanges ?? "3", 10);
  const minRatio = parseFloat(q.minRatio ?? "0.3");
  json(res, 200, analyzeCoupling(state!.graph, state!.rootDir, maxCommits, minCochanges, minRatio));
}

function handleTestTargets(q: Q, res: ServerResponse): void {
  const staged = q.staged === "true";
  const files = q.files ? q.files.split(",") : undefined;
  const changedFiles = files ?? getChangedFiles(state!.rootDir, staged);
  json(res, 200, findTestTargets(state!.graph, changedFiles));
}

function handleExport(q: Q, res: ServerResponse): void {
  const format = (q.format || "mermaid") as ExportFormat;
  const localOnly = q.local !== "false";
  const output = exportGraph(state!.graph, format, localOnly);
  if (format === "json") {
    json(res, 200, JSON.parse(output));
  } else {
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end(output);
  }
}

function handleSafeDelete(q: Q, res: ServerResponse): void {
  const file = requireFile(q, res);
  if (!file) return;
  json(res, 200, analyzeSafeDelete(state!.graph, file));
}

async function handleBadge(q: Q, res: ServerResponse): Promise<void> {
  const config = await loadConfig(state!.rootDir);
  const health = analyzeHealth(state!.graph, config.boundaries);
  const svg = generateBadgeSVG({
    score: health.score, grade: health.grade,
    style: (q.style || "flat") as BadgeStyle,
    label: q.label || "impulse",
  });
  res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
  res.end(svg);
}

async function handleComplexity(_q: Q, res: ServerResponse): Promise<void> {
  json(res, 200, await analyzeComplexity(state!.rootDir));
}

async function handleRisk(q: Q, res: ServerResponse): Promise<void> {
  const maxCommits = parseInt(q.commits ?? "300", 10);
  json(res, 200, await analyzeRisk(state!.rootDir, maxCommits));
}

async function handleDoctor(_q: Q, res: ServerResponse): Promise<void> {
  const [config, cxReport, riskReport] = await Promise.all([
    loadConfig(state!.rootDir),
    analyzeComplexity(state!.rootDir),
    analyzeRisk(state!.rootDir, 200),
  ]);

  const healthReport = analyzeHealth(state!.graph, config.boundaries);
  const hotspotsReport = analyzeHotspots(state!.graph, state!.rootDir, 200);
  const couplingData = analyzeCoupling(state!.graph, state!.rootDir, 300, 3, 0.3);
  const suggestData = generateSuggestions(state!.graph, healthReport);

  const allEdges = state!.graph.allEdges();
  const exportNodes = state!.graph.allNodes().filter((n) => n.kind === "export");
  const deadExports: Array<{ file: string; name: string }> = [];
  for (const exp of exportNodes) {
    if (allEdges.every((e) => e.to !== exp.id || e.kind !== "uses_export")) {
      deadExports.push({ file: exp.filePath, name: exp.name });
    }
  }

  let boundaryData = null;
  if (config.boundaries && Object.keys(config.boundaries).length > 0) {
    boundaryData = checkBoundaries(state!.graph, config.boundaries);
  }

  const pluginData = await runPlugins(state!.graph, state!.rootDir);

  json(res, 200, {
    health: { score: healthReport.score, grade: healthReport.grade, summary: healthReport.summary, penalties: healthReport.penalties, cycles: healthReport.cycles.length, godFiles: healthReport.godFiles.length },
    hotspots: hotspotsReport.hotspots.filter((h) => h.risk !== "low").slice(0, 10),
    deadExports: { count: deadExports.length, total: exportNodes.length, items: deadExports },
    coupling: { hidden: couplingData.hidden.length, pairs: couplingData.hidden.slice(0, 10) },
    complexity: { totalFunctions: cxReport.totalFunctions, avgCognitive: cxReport.avgCognitive, distribution: cxReport.distribution, alarming: cxReport.functions.filter((f) => f.risk === "alarming").slice(0, 10) },
    risk: { distribution: riskReport.distribution, topRisks: riskReport.files.filter((f) => f.risk === "critical" || f.risk === "high").slice(0, 10) },
    suggestions: { count: suggestData.suggestions.length, improvement: suggestData.estimatedScoreImprovement, items: suggestData.suggestions },
    boundaries: boundaryData,
    plugins: pluginData.pluginsRun > 0 ? pluginData : null,
  });
}

async function handleReview(q: Q, res: ServerResponse): Promise<void> {
  const maxCommits = parseInt(q.commits ?? "300", 10);
  const report = await runReview(state!.rootDir, {
    staged: q.staged === "true",
    base: q.base,
    maxCommits,
  });
  json(res, 200, report);
}

async function handleOwners(q: Q, res: ServerResponse): Promise<void> {
  const maxCommits = parseInt(q.commits ?? "500", 10);
  if (q.file) {
    json(res, 200, getFileOwnership(state!.rootDir, q.file, maxCommits));
  } else {
    json(res, 200, analyzeOwnership(state!.graph, state!.rootDir, maxCommits));
  }
}

async function handleChangelog(q: Q, res: ServerResponse): Promise<void> {
  const base = q.base ?? "HEAD~10";
  const head = q.head ?? "HEAD";
  json(res, 200, generateChangelog(state!.graph, state!.rootDir, base, head));
}

async function handleSecrets(_q: Q, res: ServerResponse): Promise<void> {
  json(res, 200, await analyzeSecrets(state!.graph, state!.rootDir));
}

async function handleDebt(q: Q, res: ServerResponse): Promise<void> {
  const maxCommits = parseInt(q.commits ?? "300", 10);
  json(res, 200, await analyzeDebt(state!.rootDir, maxCommits));
}

async function handleDeps(_q: Q, res: ServerResponse): Promise<void> {
  json(res, 200, await analyzeDeps(state!.graph, state!.rootDir));
}

async function handleExplain(q: Q, res: ServerResponse): Promise<void> {
  if (q.file) {
    json(res, 200, await explainFile(state!.graph, q.file, state!.rootDir));
  } else {
    json(res, 200, await explainProject(state!.graph, state!.rootDir));
  }
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const routes: Record<string, RouteHandler> = {
  "/status": handleStatus,
  "/impact": handleImpact,
  "/graph": handleGraph,
  "/files": handleFiles,
  "/dependencies": handleDependencies,
  "/dependents": handleDependents,
  "/warnings": handleWarnings,
  "/visualize": handleVisualize,
  "/exports": handleExports,
  "/health": handleHealth,
  "/suggest": handleSuggest,
  "/check": handleCheck,
  "/hotspots": handleHotspots,
  "/focus": handleFocus,
  "/coupling": handleCoupling,
  "/test-targets": handleTestTargets,
  "/export": handleExport,
  "/safe-delete": handleSafeDelete,
  "/badge": handleBadge,
  "/complexity": handleComplexity,
  "/risk": handleRisk,
  "/review": handleReview,
  "/explain": handleExplain,
  "/owners": handleOwners,
  "/changelog": handleChangelog,
  "/secrets": handleSecrets,
  "/debt": handleDebt,
  "/deps": handleDeps,
  "/doctor": handleDoctor,
};

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { path, query } = parseUrl(req);

  if (!state?.ready && path !== "/status") {
    json(res, 503, { error: "Impulse is still indexing" });
    return;
  }

  const handler = routes[path];
  if (handler) {
    await handler(query, res);
  } else {
    json(res, 404, { error: "Not found", endpoints: Object.keys(routes) });
  }
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

export async function startDaemon(
  rootDir: string,
  port: number,
): Promise<void> {
  const absRoot = resolve(rootDir);
  console.log(`\n  Impulse daemon — starting for ${absRoot}\n`);

  const cached = await loadGraphCache(absRoot);
  if (cached) {
    const age = Math.round((Date.now() - cached.meta.timestamp) / 1000);
    console.log(`  Cache hit: ${cached.meta.fileCount} files (${age}s old). Loading instantly...`);
  }

  const { graph, ctx, stats } = await analyzeProject(absRoot);
  state = { graph, ctx, rootDir: absRoot, port, ready: true, lastChangeAt: Date.now(), lastChangeFile: null };

  console.log(`  Indexed: ${stats.filesScanned} files, ${stats.nodeCount} nodes, ${stats.edgeCount} edges (${stats.durationMs}ms)`);

  await saveGraphCache(absRoot, graph).catch(() => {});

  const warnings = getParseWarnings();
  if (warnings.length > 0) {
    console.log(`  ⚠ ${warnings.length} file(s) could not be parsed`);
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const debounceSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveGraphCache(absRoot, graph).catch(() => {}); }, 5000);
  };

  const trackChange = (filePath: string) => {
    if (state) { state.lastChangeAt = Date.now(); state.lastChangeFile = filePath; }
    debounceSave();
  };

  createWatcher(absRoot, graph, ctx, {
    onChange(filePath, affected) {
      console.log(`  [${ts()}] ${filePath} changed → ${affected.length} affected`);
      trackChange(filePath);
    },
    onConfigChange(configFile, rebuildStats) {
      console.log(`  [${ts()}] ⚙ ${configFile} changed → full rebuild: ${rebuildStats.files} files, ${rebuildStats.edges} edges (${rebuildStats.durationMs}ms)`);
      trackChange(configFile);
    },
    onAdd(filePath) { console.log(`  [${ts()}] ${filePath} added`); trackChange(filePath); },
    onRemove(filePath) { console.log(`  [${ts()}] ${filePath} removed`); trackChange(filePath); },
  });

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("  Request error:", err);
      json(res, 500, { error: "Internal error" });
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  Port ${port} is already in use.`);
      console.error(`  Either another Impulse daemon is running, or another process uses this port.`);
      console.error(`  Try: impulse daemon . --port ${port + 1}\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`\n  Daemon listening on http://localhost:${port}`);
    console.log(`  Endpoints: ${Object.keys(routes).join(" ")}`);
    console.log(`  Visualize: http://localhost:${port}/visualize\n`);
  });
}

function ts(): string {
  return new Date().toLocaleTimeString();
}
