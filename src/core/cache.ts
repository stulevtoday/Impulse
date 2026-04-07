import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { DependencyGraph, type SerializedGraph } from "./graph.js";

const CACHE_DIR = ".impulse";
const CACHE_FILE = "graph.json";

interface CacheMetadata {
  version: number;
  rootDir: string;
  timestamp: number;
  fileCount: number;
}

interface CacheData {
  meta: CacheMetadata;
  graph: SerializedGraph;
}

const CACHE_VERSION = 1;

export async function saveGraphCache(
  rootDir: string,
  graph: DependencyGraph,
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
  };

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(data));
}

export async function loadGraphCache(
  rootDir: string,
): Promise<{ graph: DependencyGraph; meta: CacheMetadata } | null> {
  const cachePath = join(rootDir, CACHE_DIR, CACHE_FILE);

  try {
    const raw = await readFile(cachePath, "utf-8");
    const data: CacheData = JSON.parse(raw);

    if (data.meta.version !== CACHE_VERSION) return null;
    if (data.meta.rootDir !== rootDir) return null;

    const age = Date.now() - data.meta.timestamp;
    const MAX_AGE = 24 * 60 * 60 * 1000;
    if (age > MAX_AGE) return null;

    const graph = DependencyGraph.deserialize(data.graph);
    return { graph, meta: data.meta };
  } catch {
    return null;
  }
}
