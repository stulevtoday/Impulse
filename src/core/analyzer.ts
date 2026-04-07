import { DependencyGraph, type ImpactResult } from "./graph.js";
import { scanProject } from "./scanner.js";
import { parseFile, getParseWarnings, clearParseWarnings } from "./parser.js";
import { extractDependencies, type ExtractorContext } from "./extractor.js";
import { loadTsConfigAliases } from "./tsconfig.js";

export interface AnalysisStats {
  filesScanned: number;
  filesFailed: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  aliases: number;
}

export interface FullAnalysis {
  graph: DependencyGraph;
  stats: AnalysisStats;
  ctx: ExtractorContext;
}

export async function analyzeProject(rootDir: string): Promise<FullAnalysis> {
  const start = performance.now();
  const graph = new DependencyGraph();
  clearParseWarnings();

  const [scan, tsConfig] = await Promise.all([
    scanProject(rootDir),
    loadTsConfigAliases(rootDir),
  ]);

  const ctx: ExtractorContext = {
    rootDir,
    aliases: tsConfig.aliases,
  };

  let filesScanned = 0;
  const BATCH = 20;

  for (let i = 0; i < scan.files.length; i += BATCH) {
    const batch = scan.files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => parseFile(rootDir, f)));

    for (const parsed of results) {
      if (!parsed) continue;
      const { nodes, edges } = extractDependencies(parsed, ctx);
      for (const node of nodes) graph.addNode(node);
      for (const edge of edges) graph.addEdge(edge);
      filesScanned++;
    }
  }

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
