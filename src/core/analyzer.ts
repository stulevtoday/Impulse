import { DependencyGraph, type ImpactResult } from "./graph.js";
import { scanProject } from "./scanner.js";
import { parseFile, getParseWarnings, clearParseWarnings } from "./parser.js";
import type { ParseResult } from "./parser-types.js";
import { extractDependencies, type ExtractorContext } from "./extractor.js";
import { loadTsConfigAliases } from "./tsconfig.js";
import { detectWorkspaces, buildWorkspaceMap } from "./workspaces.js";
import { loadGraphCache, saveGraphCache, computeIncrementalDiff, collectFileMtimes } from "./cache.js";

export interface AnalysisStats {
  filesScanned: number;
  filesFailed: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  aliases: number;
}

export interface AnalysisHooks {
  onParsed?: (parsed: ParseResult) => void;
}

export interface FullAnalysis {
  graph: DependencyGraph;
  stats: AnalysisStats;
  ctx: ExtractorContext;
}

export async function analyzeProject(rootDir: string, hooks?: AnalysisHooks): Promise<FullAnalysis> {
  const start = performance.now();
  clearParseWarnings();

  const [scan, tsConfig, workspaceInfo, cached] = await Promise.all([
    scanProject(rootDir),
    loadTsConfigAliases(rootDir),
    detectWorkspaces(rootDir),
    loadGraphCache(rootDir),
  ]);

  const workspaceMap = workspaceInfo.packages.length > 0 ? buildWorkspaceMap(workspaceInfo) : undefined;

  const ctx: ExtractorContext = {
    rootDir,
    aliases: tsConfig.aliases,
    workspaceMap,
  };

  let filesScanned = 0;

  const hasCachedGraph = cached && cached.fileMtimes && Object.keys(cached.fileMtimes).length > 0;

  if (hasCachedGraph) {
    const result = await analyzeIncremental(cached.graph, ctx, scan.files, cached.fileMtimes, hooks);
    filesScanned = result.parsed;

    const durationMs = Math.round(performance.now() - start);
    const { nodes: nodeCount, edges: edgeCount } = cached.graph.stats;

    saveGraphCache(rootDir, cached.graph, result.mtimes).catch(() => {});

    return {
      graph: cached.graph,
      ctx,
      stats: {
        filesScanned: result.parsed,
        filesFailed: getParseWarnings().length,
        nodeCount,
        edgeCount,
        durationMs,
        aliases: tsConfig.aliases.length,
      },
    };
  }

  const graph = new DependencyGraph();
  const BATCH = 20;

  for (let i = 0; i < scan.files.length; i += BATCH) {
    const batch = scan.files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => parseFile(rootDir, f)));

    for (const parsed of results) {
      if (!parsed) continue;
      const { nodes, edges } = extractDependencies(parsed, ctx);
      for (const node of nodes) graph.addNode(node);
      for (const edge of edges) graph.addEdge(edge);
      hooks?.onParsed?.(parsed);
      filesScanned++;
    }
  }

  const mtimes = await collectFileMtimes(rootDir, scan.files);
  saveGraphCache(rootDir, graph, mtimes).catch(() => {});

  const durationMs = Math.round(performance.now() - start);
  const { nodes: nodeCount, edges: edgeCount } = graph.stats;
  const filesFailed = getParseWarnings().length;

  return {
    graph,
    ctx,
    stats: {
      filesScanned,
      filesFailed,
      nodeCount,
      edgeCount,
      durationMs,
      aliases: tsConfig.aliases.length,
    },
  };
}

async function analyzeIncremental(
  graph: DependencyGraph,
  ctx: ExtractorContext,
  currentFiles: string[],
  cachedMtimes: Record<string, number>,
  hooks?: AnalysisHooks,
): Promise<{ parsed: number; mtimes: Record<string, number> }> {
  const diff = await computeIncrementalDiff(ctx.rootDir, currentFiles, cachedMtimes);

  for (const file of diff.removed) {
    graph.removeFileOutgoing(file);
  }

  const toProcess = [...diff.changed, ...diff.added];
  for (const file of diff.changed) {
    graph.removeFileOutgoing(file);
  }

  const BATCH = 20;
  for (let i = 0; i < toProcess.length; i += BATCH) {
    const batch = toProcess.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => parseFile(ctx.rootDir, f)));

    for (const parsed of results) {
      if (!parsed) continue;
      const { nodes, edges } = extractDependencies(parsed, ctx);
      for (const node of nodes) graph.addNode(node);
      for (const edge of edges) graph.addEdge(edge);
      hooks?.onParsed?.(parsed);
    }
  }

  const mtimes = await collectFileMtimes(ctx.rootDir, currentFiles);

  return { parsed: toProcess.length, mtimes };
}

export async function updateFile(
  graph: DependencyGraph,
  ctx: ExtractorContext,
  filePath: string,
): Promise<void> {
  graph.removeFileOutgoing(filePath);

  const parsed = await parseFile(ctx.rootDir, filePath);
  if (!parsed) return;

  const { nodes, edges } = extractDependencies(parsed, ctx);
  for (const node of nodes) graph.addNode(node);
  for (const edge of edges) graph.addEdge(edge);
}

export function getFileImpact(
  graph: DependencyGraph,
  filePath: string,
  maxDepth = 10,
): ImpactResult {
  return graph.analyzeFileImpact(filePath, maxDepth);
}
