import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { analyzeProject, getFileImpact, updateFile } from "../core/analyzer.js";
import { getParseWarnings } from "../core/parser.js";
import { createWatcher } from "../watchers/fs-watcher.js";
import { loadGraphCache, saveGraphCache } from "../core/cache.js";
import { analyzeHealth } from "../core/health.js";
import { getVisualizationHTML } from "./visualize.js";
import type { DependencyGraph } from "../core/graph.js";
import type { ExtractorContext } from "../core/extractor.js";

export interface DaemonState {
  graph: DependencyGraph;
  ctx: ExtractorContext;
  rootDir: string;
  port: number;
  ready: boolean;
}

let state: DaemonState | null = null;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function parseUrl(req: IncomingMessage): { path: string; query: Record<string, string> } {
  const url = new URL(req.url ?? "/", "http://localhost");
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  return { path: url.pathname, query };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { path, query } = parseUrl(req);

  if (!state?.ready && path !== "/status") {
    json(res, 503, { error: "Impulse is still indexing" });
    return;
  }

  switch (path) {
    case "/status": {
      const stats = state?.graph.stats ?? { nodes: 0, edges: 0 };
      json(res, 200, {
        ready: state?.ready ?? false,
        rootDir: state?.rootDir ?? null,
        ...stats,
        warnings: getParseWarnings().length,
      });
      break;
    }

    case "/impact": {
      const file = query.file;
      if (!file) {
        json(res, 400, { error: "Missing ?file= parameter" });
        return;
      }
      const maxDepth = parseInt(query.depth ?? "10", 10);
      const impact = getFileImpact(state!.graph, file, maxDepth);
      json(res, 200, {
        changed: impact.changed,
        affected: impact.affected.map((a) => ({
          file: a.node.filePath,
          depth: a.depth,
          kind: a.node.kind,
        })),
        count: impact.affected.length,
      });
      break;
    }

    case "/graph": {
      const nodes = state!.graph.allNodes().map((n) => ({
        id: n.id,
        kind: n.kind,
        file: n.filePath,
        name: n.name,
      }));
      const edges = state!.graph.allEdges().map((e) => ({
        from: e.from,
        to: e.to,
        kind: e.kind,
      }));
      json(res, 200, { nodes: nodes.length, edges: edges.length, data: { nodes, edges } });
      break;
    }

    case "/files": {
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
      break;
    }

    case "/dependencies": {
      const file = query.file;
      if (!file) {
        json(res, 400, { error: "Missing ?file= parameter" });
        return;
      }
      const fileId = `file:${file}`;
      const deps = state!.graph.getDependencies(fileId);
      json(res, 200, {
        file,
        dependencies: deps.map((e) => ({
          target: e.to.replace(/^(file:|external:)/, ""),
          kind: e.kind,
          external: e.to.startsWith("external:"),
        })),
      });
      break;
    }

    case "/dependents": {
      const file = query.file;
      if (!file) {
        json(res, 400, { error: "Missing ?file= parameter" });
        return;
      }
      const fileId = `file:${file}`;
      const deps = state!.graph.getDependents(fileId);
      json(res, 200, {
        file,
        dependents: deps.map((e) => ({
          source: e.from.replace(/^file:/, ""),
          kind: e.kind,
        })),
      });
      break;
    }

    case "/warnings": {
      json(res, 200, { warnings: getParseWarnings() });
      break;
    }

    case "/visualize": {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(getVisualizationHTML(state!.port));
      break;
    }

    case "/health": {
      const report = analyzeHealth(state!.graph);
      json(res, 200, {
        score: report.score,
        grade: report.grade,
        summary: report.summary,
        penalties: report.penalties,
        cycles: report.cycles,
        godFiles: report.godFiles,
        orphans: report.orphans,
        stats: report.stats,
      });
      break;
    }

    default:
      json(res, 404, { error: "Not found", endpoints: [
        "/status", "/impact?file=", "/graph", "/files",
        "/dependencies?file=", "/dependents?file=", "/health", "/warnings", "/visualize",
      ]});
  }
}

export async function startDaemon(
  rootDir: string,
  port: number,
): Promise<void> {
  const absRoot = resolve(rootDir);
  console.log(`\n  Impulse daemon — starting for ${absRoot}\n`);

  const cached = await loadGraphCache(absRoot);
  if (cached) {
    const age = Math.round((Date.now() - cached.meta.timestamp) / 1000);
    console.log(
      `  Cache hit: ${cached.meta.fileCount} files (${age}s old). Loading instantly...`,
    );
  }

  const { graph, ctx, stats } = await analyzeProject(absRoot);
  state = { graph, ctx, rootDir: absRoot, port, ready: true };

  console.log(
    `  Indexed: ${stats.filesScanned} files, ${stats.nodeCount} nodes, ${stats.edgeCount} edges (${stats.durationMs}ms)`,
  );

  await saveGraphCache(absRoot, graph).catch(() => {});

  const warnings = getParseWarnings();
  if (warnings.length > 0) {
    console.log(`  ⚠ ${warnings.length} file(s) could not be parsed`);
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const debounceSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveGraphCache(absRoot, graph).catch(() => {});
    }, 5000);
  };

  createWatcher(absRoot, graph, ctx, {
    onChange(filePath, affected) {
      console.log(
        `  [${ts()}] ${filePath} changed → ${affected.length} affected`,
      );
      debounceSave();
    },
    onAdd(filePath) {
      console.log(`  [${ts()}] ${filePath} added`);
      debounceSave();
    },
    onRemove(filePath) {
      console.log(`  [${ts()}] ${filePath} removed`);
      debounceSave();
    },
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
    console.log("  Endpoints: /status /impact /graph /files /dependencies /dependents /health /warnings");
    console.log(`  Visualize: http://localhost:${port}/visualize\n`);
  });
}

function ts(): string {
  return new Date().toLocaleTimeString();
}
