import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DependencyGraph, type SerializedGraph } from "./graph.js";

const CACHE_DIR = ".impulse";
const CACHE_FILE = "graph.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheMetadata {
  version: number;
  rootDir: string;
  timestamp: number;
  fileCount: number;
}

interface CacheData {
  meta: CacheMetadata;
  graph: SerializedGraph;
  /** mtime per file — enables incremental re-parsing */
  fileMtimes?: Record<string, number>;
}

export interface IncrementalDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

const CACHE_VERSION = 2;
const MAX_AGE = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Save / Load
// ---------------------------------------------------------------------------

export async function saveGraphCache(
  rootDir: string,
  graph: DependencyGraph,
  fileMtimes?: Record<string, number>,
): Promise<void> {
  const cacheDir = join(rootDir, CACHE_DIR);
  const cachePath = join(cacheDir, CACHE_FILE);

  const data: CacheData = {
    meta: {
      version: CACHE_VERSION,
      rootDir,
      timestamp: Date.now(),
      fileCount: graph.allNodes().filter((n) => n.kind === "file").length,
    },
    graph: graph.serialize(),
    fileMtimes: fileMtimes ?? {},
  };

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(data));
}

export async function loadGraphCache(
  rootDir: string,
): Promise<{ graph: DependencyGraph; meta: CacheMetadata; fileMtimes: Record<string, number> } | null> {
  const cachePath = join(rootDir, CACHE_DIR, CACHE_FILE);

  try {
    const raw = await readFile(cachePath, "utf-8");
    const data: CacheData = JSON.parse(raw);

    if (data.meta.version !== CACHE_VERSION) return null;
    if (data.meta.rootDir !== rootDir) return null;
    if (Date.now() - data.meta.timestamp > MAX_AGE) return null;

    const graph = DependencyGraph.deserialize(data.graph);
    return { graph, meta: data.meta, fileMtimes: data.fileMtimes ?? {} };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Incremental diff — compare cached mtimes with filesystem
// ---------------------------------------------------------------------------

export async function computeIncrementalDiff(
  rootDir: string,
  currentFiles: string[],
  cachedMtimes: Record<string, number>,
): Promise<IncrementalDiff> {
  const cachedSet = new Set(Object.keys(cachedMtimes));
  const currentSet = new Set(currentFiles);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const file of currentFiles) {
    if (!cachedSet.has(file)) {
      added.push(file);
      continue;
    }
    const mtime = await getFileMtime(rootDir, file);
    if (mtime !== cachedMtimes[file]) {
      changed.push(file);
    } else {
      unchanged.push(file);
    }
  }

  for (const file of cachedSet) {
    if (!currentSet.has(file)) removed.push(file);
  }

  return { added, removed, changed, unchanged };
}

export async function collectFileMtimes(rootDir: string, files: string[]): Promise<Record<string, number>> {
  const mtimes: Record<string, number> = {};
  const BATCH = 50;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => getFileMtime(rootDir, f)));
    for (let j = 0; j < batch.length; j++) {
      mtimes[batch[j]] = results[j];
    }
  }
  return mtimes;
}

async function getFileMtime(rootDir: string, file: string): Promise<number> {
  try {
    const s = await stat(join(rootDir, file));
    return s.mtimeMs;
  } catch {
    return 0;
  }
}
