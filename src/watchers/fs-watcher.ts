import { watch as fsWatch, type WatchEventType } from "node:fs";
import { extname } from "node:path";
import type { DependencyGraph } from "../core/graph.js";
import type { ExtractorContext } from "../core/types.js";
import { updateFile, getFileImpact } from "../core/analyzer.js";

interface WatcherCallbacks {
  onReady?: () => void;
  onChange?: (filePath: string, affected: string[]) => void;
  onAdd?: (filePath: string) => void;
  onRemove?: (filePath: string) => void;
  onError?: (error: Error) => void;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs", ".py", ".go",
]);

const IGNORED_SEGMENTS = new Set([
  "node_modules", "dist", "build", ".git", "coverage",
  ".next", ".nuxt", "vendor", "__pycache__", ".venv",
  "venv", ".mypy_cache", ".pytest_cache", ".impulse",
]);

function shouldIgnore(filename: string): boolean {
  const parts = filename.split(/[/\\]/);
  return parts.some((p) => IGNORED_SEGMENTS.has(p));
}

export function createWatcher(
  rootDir: string,
  graph: DependencyGraph,
  ctx: ExtractorContext,
  callbacks: WatcherCallbacks,
): AbortController {
  const ac = new AbortController();
  const debounceMap = new Map<string, NodeJS.Timeout>();

  const handleEvent = (eventType: WatchEventType, filename: string | null) => {
    if (!filename) return;
    if (shouldIgnore(filename)) return;
    if (!SOURCE_EXTENSIONS.has(extname(filename).toLowerCase())) return;

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
          callbacks.onError?.(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }, 150),
    );
  };

  try {
    fsWatch(rootDir, { recursive: true, signal: ac.signal }, handleEvent);
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
  }

  callbacks.onReady?.();
  return ac;
}
