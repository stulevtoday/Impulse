import { watch as fsWatch, type WatchEventType } from "node:fs";
import { relative, extname, join } from "node:path";
import type { DependencyGraph } from "../core/graph.js";
import type { ExtractorContext } from "../core/extractor.js";
import { updateFile, getFileImpact } from "../core/analyzer.js";

export interface WatcherCallbacks {
  onReady?: () => void;
  onChange?: (filePath: string, affected: string[]) => void;
  onAdd?: (filePath: string) => void;
  onRemove?: (filePath: string) => void;
  onError?: (error: Error) => void;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
]);

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
    fsWatch(
      join(rootDir, "src"),
      { recursive: true, signal: ac.signal },
      (eventType, filename) => {
        if (filename) handleEvent(eventType, `src/${filename}`);
      },
    );
  } catch {
    // no src/ directory — skip
  }

  try {
    fsWatch(rootDir, { signal: ac.signal }, (eventType, filename) => {
      if (filename && SOURCE_EXTENSIONS.has(extname(filename).toLowerCase())) {
        handleEvent(eventType, filename);
      }
    });
  } catch {
    // root-level watch failed
  }

  callbacks.onReady?.();
  return ac;
}
