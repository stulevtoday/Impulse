import { DependencyGraph, type ImpactResult } from "./graph.js";
import { scanProject } from "./scanner.js";
import { parseFile } from "./parser.js";
import { extractDependencies } from "./extractor.js";

export interface AnalysisStats {
  filesScanned: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
}

export interface FullAnalysis {
  graph: DependencyGraph;
  stats: AnalysisStats;
}

/**
 * Build a complete dependency graph for a project directory.
 */
export async function analyzeProject(rootDir: string): Promise<FullAnalysis> {
  const start = performance.now();
  const graph = new DependencyGraph();

  const scan = await scanProject(rootDir);
  let filesScanned = 0;

  for (const file of scan.files) {
    const parsed = await parseFile(rootDir, file);
    if (!parsed) continue;

    const { nodes, edges } = extractDependencies(parsed, rootDir);
    for (const node of nodes) graph.addNode(node);
    for (const edge of edges) graph.addEdge(edge);
    filesScanned++;
  }

  const durationMs = Math.round(performance.now() - start);
  const { nodes: nodeCount, edges: edgeCount } = graph.stats;

  return {
    graph,
    stats: { filesScanned, nodeCount, edgeCount, durationMs },
  };
}

/**
 * Re-analyze a single file and update the graph incrementally.
 */
export async function updateFile(
  graph: DependencyGraph,
  rootDir: string,
  filePath: string,
): Promise<void> {
  graph.removeFileNodes(filePath);

  const parsed = await parseFile(rootDir, filePath);
  if (!parsed) return;

  const { nodes, edges } = extractDependencies(parsed, rootDir);
  for (const node of nodes) graph.addNode(node);
  for (const edge of edges) graph.addEdge(edge);
}

/**
 * Analyze impact of changing a specific file.
 */
export function getFileImpact(
  graph: DependencyGraph,
  filePath: string,
  maxDepth = 10,
): ImpactResult {
  return graph.analyzeFileImpact(filePath, maxDepth);
}
