import type { DependencyGraph, GraphNode } from "./graph.js";
import type { BoundaryRule } from "./config-types.js";
import { analyzeStability, type StabilityReport } from "./stability.js";
import type { ComplexityReport } from "./complexity.js";

export type CycleSeverity = "tight-couple" | "short-ring" | "long-ring";

export interface CircularDependency {
  cycle: string[];
  length: number;
  severity: CycleSeverity;
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

export interface Penalties {
  cycles: number;
  godFiles: number;
  deepChains: number;
  orphans: number;
  hubConcentration: number;
  stabilityViolations: number;
  complexity: number;
}

export interface HealthReport {
  score: number;
  grade: string;
  summary: string;
  cycles: CircularDependency[];
  godFiles: GodFile[];
  deepestChains: DepthAnalysis[];
  orphans: string[];
  penalties: Penalties;
  stability?: StabilityReport;
  stats: {
    totalFiles: number;
    totalExports: number;
    avgImports: number;
    avgImportedBy: number;
    maxImports: number;
    maxImportedBy: number;
    localEdges: number;
    externalEdges: number;
  };
}

export function analyzeHealth(
  graph: DependencyGraph,
  boundaries?: Record<string, BoundaryRule>,
  complexity?: ComplexityReport,
): HealthReport {
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const importEdges = graph.allEdges().filter((e) => e.kind === "imports");
  const localEdges = importEdges.filter((e) => !e.to.startsWith("external:"));
  const externalEdges = importEdges.filter((e) => e.to.startsWith("external:"));

  const cycles = detectCycles(graph, fileNodes);
  const godFiles = findGodFiles(graph, fileNodes);
  const deepestChains = findDeepestChains(graph, fileNodes);
  const orphans = findOrphans(graph, fileNodes);
  const stats = computeStats(graph, fileNodes, localEdges, externalEdges);

  let stability: StabilityReport | undefined;
  if (boundaries && Object.keys(boundaries).length > 0) {
    stability = analyzeStability(graph, boundaries);
  }

  const { score, penalties } = computeScore(cycles, godFiles, deepestChains, orphans, stats, stability, complexity);
  const grade = scoreToGrade(score);
  const summary = buildSummary(cycles, godFiles, deepestChains, orphans, stability, complexity);

  return { score, grade, summary, cycles, godFiles, deepestChains, orphans, penalties, stability, stats };
}

function classifySeverity(cycleLength: number): CycleSeverity {
  if (cycleLength <= 2) return "tight-couple";
  if (cycleLength <= 4) return "short-ring";
  return "long-ring";
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
          const length = normalized.length - 1;
          cycles.push({ cycle: normalized, length, severity: classifySeverity(length) });
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
      if (edge.kind !== "imports") continue;
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
  const all = fileNodes.map((n) => {
    const imports = graph.getDependencies(n.id).filter((e) => e.kind === "imports" && !e.to.startsWith("external:")).length;
    const importedBy = graph.getDependents(n.id).filter((e) => e.kind === "imports").length;
    return { file: n.filePath, imports, importedBy, totalConnections: imports + importedBy };
  });

  const importedByValues = all.map((f) => f.importedBy).filter((v) => v > 0);
  const importValues = all.map((f) => f.imports).filter((v) => v > 0);
  const totalValues = all.map((f) => f.totalConnections).filter((v) => v > 0);

  const ibThreshold = Math.max(10, outlierThreshold(importedByValues));
  const impThreshold = Math.max(15, outlierThreshold(importValues));
  const totThreshold = Math.max(20, outlierThreshold(totalValues));

  return all
    .filter((f) => f.importedBy >= ibThreshold || f.imports >= impThreshold || f.totalConnections >= totThreshold)
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

  const deps = graph.getDependencies(nodeId).filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));
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
      const importedBy = graph.getDependents(n.id).filter((e) => e.kind === "imports");
      const localImports = graph.getDependencies(n.id).filter(
        (e) => e.kind === "imports" && !e.to.startsWith("external:"),
      );
      return importedBy.length === 0 && localImports.length === 0;
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
    (n) => graph.getDependencies(n.id).filter((e) => e.kind === "imports" && !e.to.startsWith("external:")).length,
  );
  const importedByCounts = fileNodes.map(
    (n) => graph.getDependents(n.id).filter((e) => e.kind === "imports").length,
  );

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;

  const totalExports = graph.allNodes().filter((n) => n.kind === "export").length;

  return {
    totalFiles: fileNodes.length,
    totalExports,
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
  stats: { totalFiles: number; maxImportedBy: number; avgImports: number },
  stability?: StabilityReport,
  complexity?: ComplexityReport,
): { score: number; penalties: Penalties } {
  const penalties: Penalties = {
    cycles: penalizeCycles(cycles),
    godFiles: Math.min(godFiles.length * 4, 20),
    deepChains: penalizeDeepChains(deepChains, stats.totalFiles),
    orphans: penalizeOrphans(orphans.length, stats.totalFiles),
    hubConcentration: penalizeHubConcentration(stats),
    stabilityViolations: stability ? Math.min(stability.violations.length * 5, 15) : 0,
    complexity: penalizeComplexity(complexity),
  };

  const total = Object.values(penalties).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(100, 100 - total));
  return { score, penalties };
}

function penalizeCycles(cycles: CircularDependency[]): number {
  let raw = 0;
  for (const cycle of cycles) {
    if (cycle.severity === "tight-couple") raw += 3;
    else if (cycle.severity === "short-ring") raw += 8;
    else raw += 15;
  }
  return Math.min(raw, 50);
}

function penalizeDeepChains(deepChains: DepthAnalysis[], totalFiles: number): number {
  if (deepChains.length === 0) return 0;
  const maxDepth = deepChains[0].maxDepth;
  if (maxDepth < 5) return 0;

  const depthPct = totalFiles > 0 ? maxDepth / totalFiles : 0;
  const avgDepth = deepChains.reduce((s, c) => s + c.maxDepth, 0) / deepChains.length;
  const depthRatio = avgDepth > 0 ? maxDepth / avgDepth : 1;

  if ((depthRatio > 2.5 && maxDepth > 8) || depthPct > 0.8) return 15;
  if (depthRatio > 1.8 || depthPct > 0.5) return 8;
  if (depthPct > 0.3 || maxDepth > 10) return 3;
  return 0;
}

function penalizeOrphans(orphanCount: number, totalFiles: number): number {
  const ratio = totalFiles > 0 ? orphanCount / totalFiles : 0;
  if (ratio > 0.3) return 10;
  if (ratio > 0.15) return 5;
  return 0;
}

function penalizeHubConcentration(stats: { totalFiles: number; maxImportedBy: number; avgImports: number }): number {
  if (stats.totalFiles === 0 || stats.maxImportedBy === 0) return 0;
  const hubShare = stats.maxImportedBy / stats.totalFiles;
  const avgIB = stats.maxImportedBy / Math.max(1, stats.avgImports);
  if (hubShare > 0.4 && avgIB > 8) return 10;
  if (hubShare > 0.25 && avgIB > 5) return 5;
  return 0;
}

function penalizeComplexity(complexity?: ComplexityReport): number {
  if (!complexity || complexity.totalFunctions === 0) return 0;
  const alarmingRatio = complexity.distribution.alarming / complexity.totalFunctions;
  const complexRatio = (complexity.distribution.alarming + complexity.distribution.complex) / complexity.totalFunctions;
  if (alarmingRatio > 0.15) return 15;
  if (alarmingRatio > 0.05) return 10;
  if (complexRatio > 0.3) return 8;
  if (complexRatio > 0.15) return 4;
  return 0;
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
  stability?: StabilityReport,
  complexity?: ComplexityReport,
): string {
  const issues: string[] = [];

  if (cycles.length > 0) {
    const tight = cycles.filter((c) => c.severity === "tight-couple").length;
    const short = cycles.filter((c) => c.severity === "short-ring").length;
    const long = cycles.filter((c) => c.severity === "long-ring").length;
    const parts: string[] = [];
    if (tight > 0) parts.push(`${tight} tight`);
    if (short > 0) parts.push(`${short} short-ring`);
    if (long > 0) parts.push(`${long} long-ring`);
    issues.push(`${cycles.length} cycle(s) (${parts.join(", ")})`);
  }

  if (godFiles.length > 0) issues.push(`${godFiles.length} god file(s)`);
  if (deepChains.length > 0) issues.push(`max chain depth ${deepChains[0].maxDepth}`);
  if (orphans.length > 0) issues.push(`${orphans.length} isolated file(s)`);
  if (stability && stability.violations.length > 0) {
    issues.push(`${stability.violations.length} stability violation(s)`);
  }
  if (complexity && complexity.distribution.alarming > 0) {
    issues.push(`${complexity.distribution.alarming} alarming-complexity function(s)`);
  }
  if (issues.length === 0) return "No structural issues detected. Clean architecture.";
  return issues.join(", ");
}

/**
 * Statistical outlier threshold using IQR (interquartile range).
 * Returns P75 + 1.5 × IQR, the standard Tukey fence for outlier detection.
 * Minimum threshold of 5 to avoid flagging trivial values.
 */
/**
 * Statistical outlier threshold using IQR (interquartile range).
 * P75 + 1.5 × IQR — the standard Tukey fence for outlier detection.
 * For small samples (< 4 values), returns 0 to defer to the absolute minimum.
 */
function outlierThreshold(values: number[]): number {
  if (values.length < 4) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  return Math.ceil(q3 + 1.5 * iqr);
}
