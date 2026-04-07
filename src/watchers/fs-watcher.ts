import { watch as fsWatch, type WatchEventType } from "node:fs";
import { extname, basename } from "node:path";
import type { DependencyGraph } from "../core/graph.js";
import type { ExtractorContext } from "../core/types.js";
import { updateFile, getFileImpact, analyzeProject } from "../core/analyzer.js";

interface WatcherCallbacks {
  onReady?: () => void;
  onChange?: (filePath: string, affected: string[]) => void;
  onAdd?: (filePath: string) => void;
  onRemove?: (filePath: string) => void;
  onConfigChange?: (configFile: string, stats: { files: number; edges: number; durationMs: number }) => void;
  onError?: (error: Error) => void;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
  ".py", ".go", ".rs", ".cs",
]);

const CONFIG_FILES = new Set([
  "tsconfig.json", "tsconfig.base.json", "tsconfig.app.json", "tsconfig.lib.json",
  "package.json",
  "go.mod", "go.sum",
  "Cargo.toml",
]);

const CONFIG_EXTENSIONS = new Set([".csproj", ".sln"]);

const IGNORED_SEGMENTS = new Set([
  "node_modules", "dist", "build", ".git", "coverage",
  ".next", ".nuxt", "vendor", "__pycache__", ".venv",
  "venv", ".mypy_cache", ".pytest_cache", ".impulse",
]);

function shouldIgnore(filename: string): boolean {
  const parts = filename.split(/[/\\]/);
  return parts.some((p) => IGNORED_SEGMENTS.has(p));
}

function isConfigFile(filename: string): boolean {
  const name = basename(filename);
  if (CONFIG_FILES.has(name)) return true;
  if (CONFIG_EXTENSIONS.has(extname(filename).toLowerCase())) return true;
  return false;
}

function isSourceFile(filename: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(filename).toLowerCase());
}

export interface WatcherState {
  graph: DependencyGraph;
  ctx: ExtractorContext;
}

export function createWatcher(
  rootDir: string,
  graph: DependencyGraph,
  ctx: ExtractorContext,
  callbacks: WatcherCallbacks,
): AbortController {
  const ac = new AbortController();
  const debounceMap = new Map<string, NodeJS.Timeout>();
  const state: WatcherState = { graph, ctx };

  let configRebuildTimer: NodeJS.Timeout | null = null;

  const handleConfigChange = (filename: string) => {
    if (configRebuildTimer) clearTimeout(configRebuildTimer);

    configRebuildTimer = setTimeout(async () => {
      configRebuildTimer = null;
      try {
        const result = await analyzeProject(rootDir);
        state.graph = result.graph;
        state.ctx = result.ctx;

        Object.assign(graph, {});
        const oldNodes = graph.allNodes();
        for (const n of oldNodes) graph.removeNode(n.id);

        for (const n of result.graph.allNodes()) graph.addNode(n);
        for (const e of result.graph.allEdges()) graph.addEdge(e);

        Object.assign(ctx, result.ctx);

        callbacks.onConfigChange?.(filename, {
          files: result.stats.filesScanned,
          edges: result.stats.edgeCount,
          durationMs: result.stats.durationMs,
        });
      } catch (err) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }, 500);
  };

  const handleSourceChange = (filename: string) => {
    const existing = debounceMap.get(filename);
    if (existing) clearTimeout(existing);

    debounceMap.set(
      filename,
      setTimeout(async () => {
        debounceMap.delete(filename);
        try {
          await updateFile(graph, ctx, filename);
          const impact = getFileImpact(graph, filename);
          const affected = impact.affected.map((a) => a.node.filePath);
          callbacks.onChange?.(filename, affected);
        } catch (err) {
          callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }, 150),
    );
  };

  const handleEvent = (_eventType: WatchEventType, filename: string | null) => {
    if (!filename) return;
    if (shouldIgnore(filename)) return;

    if (isConfigFile(filename)) {
      handleConfigChange(filename);
    } else if (isSourceFile(filename)) {
      handleSourceChange(filename);
    }
  };

  try {
    fsWatch(rootDir, { recursive: true, signal: ac.signal }, handleEvent);
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
  }

  callbacks.onReady?.();
  return ac;
}
