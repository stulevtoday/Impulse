import type { DependencyGraph } from "./graph.js";
import type { HealthReport } from "./health.js";
import type { ComplexityReport, FunctionComplexity } from "./complexity.js";

export interface ExportCluster {
  exports: string[];
  consumers: string[];
  suggestedFile: string;
}

export interface GodFileSuggestion {
  kind: "split-god-file";
  file: string;
  dependents: number;
  clusters: ExportCluster[];
  expectedMaxDependents: number;
}

export interface DeadExportSuggestion {
  kind: "remove-dead-exports";
  file: string;
  exports: string[];
}

export interface CycleBreakSuggestion {
  kind: "break-cycle";
  cycle: string[];
  sharedSymbols: string[];
  suggestedExtraction: string;
}

export interface SplitComplexFunctionSuggestion {
  kind: "split-complex-function";
  file: string;
  functionName: string;
  cognitive: number;
  lineCount: number;
}

export type Suggestion =
  | GodFileSuggestion
  | DeadExportSuggestion
  | CycleBreakSuggestion
  | SplitComplexFunctionSuggestion;

export interface SuggestReport {
  suggestions: Suggestion[];
  estimatedScoreImprovement: number;
}

export function generateSuggestions(
  graph: DependencyGraph,
  health: HealthReport,
  complexity?: ComplexityReport,
): SuggestReport {
  const suggestions: Suggestion[] = [];

  for (const godFile of health.godFiles) {
    const suggestion = analyzeGodFile(graph, godFile.file, godFile.importedBy);
    if (suggestion) suggestions.push(suggestion);
  }

  const deadExports = findDeadExports(graph);
  suggestions.push(...deadExports);

  for (const cycle of health.cycles) {
    if (cycle.severity !== "tight-couple") continue;
    const suggestion = analyzeCycle(graph, cycle.cycle);
    if (suggestion) suggestions.push(suggestion);
  }

  if (complexity) {
    suggestions.push(...findComplexFunctions(complexity));
  }

  const improvement = estimateImprovement(suggestions, health);

  return { suggestions, estimatedScoreImprovement: improvement };
}

function findComplexFunctions(report: ComplexityReport): SplitComplexFunctionSuggestion[] {
  return report.functions
    .filter((f) => f.risk === "alarming")
    .slice(0, 10)
    .map((f) => ({
      kind: "split-complex-function" as const,
      file: f.filePath,
      functionName: f.name,
      cognitive: f.cognitive,
      lineCount: f.lineCount,
    }));
}

function analyzeGodFile(
  graph: DependencyGraph,
  filePath: string,
  totalDependents: number,
): GodFileSuggestion | null {
  const exports = graph.getDeclaredExports(filePath);
  if (exports.length < 2) return null;

  const exportConsumers = new Map<string, Set<string>>();

  for (const exp of exports) {
    const impact = graph.analyzeExportImpact(filePath, exp.name);
    const directConsumers = impact.affected
      .filter((a) => a.depth === 1 && a.node.kind === "file")
      .map((a) => a.node.filePath);
    exportConsumers.set(exp.name, new Set(directConsumers));
  }

  const clusters = clusterExports(exportConsumers, filePath);

  if (clusters.length <= 1) return null;

  const maxClusterConsumers = Math.max(
    ...clusters.map((c) => c.consumers.length),
  );

  return {
    kind: "split-god-file",
    file: filePath,
    dependents: totalDependents,
    clusters,
    expectedMaxDependents: maxClusterConsumers,
  };
}

function clusterExports(
  exportConsumers: Map<string, Set<string>>,
  filePath: string,
): ExportCluster[] {
  const entries = [...exportConsumers.entries()];
  const used = new Set<number>();
  const clusters: ExportCluster[] = [];

  for (let i = 0; i < entries.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    const [name, consumers] = entries[i];
    const group = [name];
    const groupConsumers = new Set(consumers);

    for (let j = i + 1; j < entries.length; j++) {
      if (used.has(j)) continue;
      const [otherName, otherConsumers] = entries[j];

      const overlap = [...otherConsumers].filter((c) => groupConsumers.has(c));
      const similarity =
        overlap.length /
        Math.max(1, Math.min(groupConsumers.size, otherConsumers.size));

      if (similarity >= 0.6) {
        used.add(j);
        group.push(otherName);
        for (const c of otherConsumers) groupConsumers.add(c);
      }
    }

    clusters.push({
      exports: group.sort(),
      consumers: [...groupConsumers].sort(),
      suggestedFile: "",
    });
  }

  clusters.sort((a, b) => b.consumers.length - a.consumers.length);

  const dir = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/"))
    : "";
  const baseName = filePath
    .slice(filePath.lastIndexOf("/") + 1)
    .replace(/\.[^.]+$/, "");

  if (clusters.length >= 2) {
    clusters[0].suggestedFile = filePath;

    for (let i = 1; i < clusters.length; i++) {
      const names = clusters[i].exports;
      let suggested: string;

      if (names.every((n) => /^[A-Z]/.test(n) && !/^(get|set|create|update|delete|find|load|save|analyze|compute|build|parse|extract)/.test(n))) {
        suggested = `${dir}/${baseName}-types`;
      } else if (names.length === 1) {
        suggested = `${dir}/${kebab(names[0])}`;
      } else {
        suggested = `${dir}/${baseName}-${i}`;
      }

      clusters[i].suggestedFile = suggested + extOf(filePath);
    }
  }

  return clusters;
}

function findDeadExports(graph: DependencyGraph): DeadExportSuggestion[] {
  const suggestions: DeadExportSuggestion[] = [];
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");

  for (const file of fileNodes) {
    if (isBarrelFile(graph, file.filePath)) continue;

    const declared = graph.getDeclaredExports(file.filePath);
    const dead: string[] = [];

    for (const exp of declared) {
      const dependents = graph.getDependents(exp.id);
      const usedBy = dependents.filter((e) => e.kind === "uses_export");
      if (usedBy.length === 0) dead.push(exp.name);
    }

    if (dead.length > 0) {
      suggestions.push({
        kind: "remove-dead-exports",
        file: file.filePath,
        exports: dead.sort(),
      });
    }
  }

  return suggestions.sort(
    (a, b) => b.exports.length - a.exports.length,
  );
}

function isBarrelFile(graph: DependencyGraph, filePath: string): boolean {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  if (!fileName.startsWith("index.")) return false;

  const deps = graph.getDependencies(`file:${filePath}`);
  const reexports = deps.filter(
    (e) => e.kind === "imports" && e.metadata?.reexport,
  );
  return reexports.length >= 2;
}

function analyzeCycle(
  graph: DependencyGraph,
  cycle: string[],
): CycleBreakSuggestion | null {
  if (cycle.length < 3) return null;

  const a = cycle[0];
  const b = cycle[1];

  const aExports = graph.getDeclaredExports(a).map((e) => e.name);
  const bExports = graph.getDeclaredExports(b).map((e) => e.name);

  const bUsesFromA: string[] = [];
  for (const expName of aExports) {
    const impact = graph.analyzeExportImpact(a, expName);
    if (impact.affected.some((af) => af.node.filePath === b && af.depth === 1)) {
      bUsesFromA.push(expName);
    }
  }

  const aUsesFromB: string[] = [];
  for (const expName of bExports) {
    const impact = graph.analyzeExportImpact(b, expName);
    if (impact.affected.some((af) => af.node.filePath === a && af.depth === 1)) {
      aUsesFromB.push(expName);
    }
  }

  const smaller = bUsesFromA.length <= aUsesFromB.length ? bUsesFromA : aUsesFromB;
  const source = bUsesFromA.length <= aUsesFromB.length ? a : b;

  if (smaller.length === 0) return null;

  const dir = source.includes("/")
    ? source.slice(0, source.lastIndexOf("/"))
    : "";

  return {
    kind: "break-cycle",
    cycle: [a, b],
    sharedSymbols: smaller,
    suggestedExtraction: `${dir}/shared-types${extOf(source)}`,
  };
}

function estimateImprovement(
  suggestions: Suggestion[],
  health: HealthReport,
): number {
  let improvement = 0;

  for (const s of suggestions) {
    if (s.kind === "split-god-file") {
      const reduction = s.dependents - s.expectedMaxDependents;
      if (reduction > 5 && s.expectedMaxDependents < 10) {
        improvement += 5;
      }
    }
    if (s.kind === "break-cycle") {
      improvement += 3;
    }
  }

  return Math.min(improvement, 100 - health.score);
}

function kebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot) : ".ts";
}
