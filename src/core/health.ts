import type { DependencyGraph, GraphNode } from "./graph.js";

export interface CircularDependency {
  cycle: string[];
  length: number;
}

export interface GodFile {
  file: string;
  importedBy: number;
  imports: number;
  totalConnections: number;
}

export interface DepthAnalysis {
  file: string;
  maxDepth: number;
  chain: string[];
}

export interface HealthReport {
  score: number;
  grade: string;
  summary: string;
  cycles: CircularDependency[];
  godFiles: GodFile[];
  deepestChains: DepthAnalysis[];
  orphans: string[];
  stats: {
    totalFiles: number;
    avgImports: number;
    avgImportedBy: number;
    maxImports: number;
    maxImportedBy: number;
    localEdges: number;
    externalEdges: number;
  };
}

export function analyzeHealth(graph: DependencyGraph): HealthReport {
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const edges = graph.allEdges();
  const localEdges = edges.filter((e) => !e.to.startsWith("external:"));
  const externalEdges = edges.filter((e) => e.to.startsWith("external:"));

  const cycles = detectCycles(graph, fileNodes);
  const godFiles = findGodFiles(graph, fileNodes);
  const deepestChains = findDeepestChains(graph, fileNodes);
  const orphans = findOrphans(graph, fileNodes);
  const stats = computeStats(graph, fileNodes, localEdges, externalEdges);

  const score = computeScore(cycles, godFiles, deepestChains, orphans, stats);
  const grade = scoreToGrade(score);
  const summary = buildSummary(cycles, godFiles, deepestChains, orphans, score);

  return { score, grade, summary, cycles, godFiles, deepestChains, orphans, stats };
}

function detectCycles(graph: DependencyGraph, fileNodes: GraphNode[]): CircularDependency[] {
  const cycles: CircularDependency[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): void {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).map((id) => id.replace(/^file:/, ""));
        cycle.push(cycle[0]);
        const normalized = normalizeCycle(cycle);
        if (!cycles.some((c) => c.cycle.join("→") === normalized.join("→"))) {
          cycles.push({ cycle: normalized, length: normalized.length - 1 });
        }
      }
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    const deps = graph.getDependencies(nodeId);
    for (const edge of deps) {
      if (edge.to.startsWith("external:")) continue;
      dfs(edge.to);
    }

    path.pop();
    inStack.delete(nodeId);
  }

  for (const node of fileNodes) {
    dfs(node.id);
  }

  cycles.sort((a, b) => a.length - b.length);
  return cycles;
}

function normalizeCycle(cycle: string[]): string[] {
  const withoutLast = cycle.slice(0, -1);
  const minIdx = withoutLast.indexOf(
    withoutLast.reduce((min, cur) => (cur < min ? cur : min)),
  );
  const rotated = [...withoutLast.slice(minIdx), ...withoutLast.slice(0, minIdx)];
  rotated.push(rotated[0]);
  return rotated;
}

function findGodFiles(graph: DependencyGraph, fileNodes: GraphNode[]): GodFile[] {
  return fileNodes
    .map((n) => {
      const imports = graph.getDependencies(n.id).filter((e) => !e.to.startsWith("external:")).length;
      const importedBy = graph.getDependents(n.id).filter((e) => e.kind === "imports").length;
      return {
        file: n.filePath,
        imports,
        importedBy,
        totalConnections: imports + importedBy,
      };
    })
    .filter((f) => f.importedBy >= 10 || f.imports >= 15 || f.totalConnections >= 20)
    .sort((a, b) => b.totalConnections - a.totalConnections);
}

function findDeepestChains(graph: DependencyGraph, fileNodes: GraphNode[]): DepthAnalysis[] {
  const results: DepthAnalysis[] = [];

  for (const node of fileNodes) {
    const { depth, chain } = longestPath(graph, node.id, new Set());
    if (depth >= 3) {
      results.push({
        file: node.filePath,
        maxDepth: depth,
        chain: chain.map((id) => id.replace(/^file:/, "")),
      });
    }
  }

  results.sort((a, b) => b.maxDepth - a.maxDepth);
  return results.slice(0, 10);
}

function longestPath(
  graph: DependencyGraph,
  nodeId: string,
  visited: Set<string>,
): { depth: number; chain: string[] } {
  if (visited.has(nodeId)) return { depth: 0, chain: [] };
  visited.add(nodeId);

  const deps = graph.getDependencies(nodeId).filter((e) => !e.to.startsWith("external:"));
  let maxDepth = 0;
  let maxChain: string[] = [];

  for (const edge of deps) {
    const sub = longestPath(graph, edge.to, visited);
    if (sub.depth > maxDepth) {
      maxDepth = sub.depth;
      maxChain = sub.chain;
    }
  }

  visited.delete(nodeId);
  return { depth: maxDepth + 1, chain: [nodeId, ...maxChain] };
}

function findOrphans(graph: DependencyGraph, fileNodes: GraphNode[]): string[] {
  return fileNodes
    .filter((n) => {
      const dependents = graph.getDependents(n.id);
      const deps = graph.getDependencies(n.id);
      return dependents.length === 0 && deps.filter((e) => !e.to.startsWith("external:")).length === 0;
    })
    .map((n) => n.filePath)
    .sort();
}

function computeStats(
  graph: DependencyGraph,
  fileNodes: GraphNode[],
  localEdges: { from: string; to: string }[],
  externalEdges: { from: string; to: string }[],
) {
  const importCounts = fileNodes.map(
    (n) => graph.getDependencies(n.id).filter((e) => !e.to.startsWith("external:")).length,
  );
  const importedByCounts = fileNodes.map(
    (n) => graph.getDependents(n.id).filter((e) => e.kind === "imports").length,
  );

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;

  return {
    totalFiles: fileNodes.length,
    avgImports: Math.round(avg(importCounts) * 10) / 10,
    avgImportedBy: Math.round(avg(importedByCounts) * 10) / 10,
    maxImports: max(importCounts),
    maxImportedBy: max(importedByCounts),
    localEdges: localEdges.length,
    externalEdges: externalEdges.length,
  };
}

function computeScore(
  cycles: CircularDependency[],
  godFiles: GodFile[],
  deepChains: DepthAnalysis[],
  orphans: string[],
  stats: { totalFiles: number; maxImportedBy: number },
): number {
  let score = 100;

  score -= cycles.length * 15;
  score -= godFiles.length * 5;

  if (deepChains.length > 0) {
    const maxDepth = deepChains[0].maxDepth;
    if (maxDepth > 8) score -= 15;
    else if (maxDepth > 5) score -= 8;
    else if (maxDepth > 3) score -= 3;
  }

  const orphanRatio = stats.totalFiles > 0 ? orphans.length / stats.totalFiles : 0;
  if (orphanRatio > 0.3) score -= 10;
  else if (orphanRatio > 0.15) score -= 5;

  if (stats.maxImportedBy > 30) score -= 10;
  else if (stats.maxImportedBy > 20) score -= 5;

  return Math.max(0, Math.min(100, score));
}

function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function buildSummary(
  cycles: CircularDependency[],
  godFiles: GodFile[],
  deepChains: DepthAnalysis[],
  orphans: string[],
  score: number,
): string {
  const issues: string[] = [];
  if (cycles.length > 0) issues.push(`${cycles.length} circular dep(s)`);
  if (godFiles.length > 0) issues.push(`${godFiles.length} god file(s)`);
  if (deepChains.length > 0) issues.push(`max chain depth ${deepChains[0].maxDepth}`);
  if (orphans.length > 0) issues.push(`${orphans.length} isolated file(s)`);
  if (issues.length === 0) return "No structural issues detected. Clean architecture.";
  return issues.join(", ");
}
