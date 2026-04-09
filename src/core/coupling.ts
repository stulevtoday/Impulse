import { execSync } from "node:child_process";
import type { DependencyGraph } from "./graph.js";

export type CouplingKind =
  | "hidden"
  | "confirmed"
  | "decoupled";

export interface CouplingPair {
  fileA: string;
  fileB: string;
  cochanges: number;
  /** How often A and B appear in the same commit (0-1) */
  couplingRatio: number;
  hasDependency: boolean;
  kind: CouplingKind;
}

export interface CouplingReport {
  pairs: CouplingPair[];
  hidden: CouplingPair[];
  commitsAnalyzed: number;
  filesAnalyzed: number;
}

/**
 * Analyze temporal coupling: which files change together in git commits,
 * and how that relates to the structural dependency graph.
 *
 * - hidden:    co-change often, NO import relationship → architecture smell
 * - confirmed: co-change often, WITH import relationship → expected
 * - decoupled: import relationship, but rarely co-change → healthy
 */
export function analyzeCoupling(
  graph: DependencyGraph,
  rootDir: string,
  maxCommits = 300,
  minCochanges = 3,
  minRatio = 0.3,
): CouplingReport {
  const commits = getCommitFileSets(rootDir, maxCommits);
  const graphFiles = new Set(
    graph.allNodes().filter((n) => n.kind === "file").map((n) => n.filePath),
  );

  const cochangeCount = new Map<string, number>();
  const fileCommitCount = new Map<string, number>();

  for (const files of commits) {
    const known = files.filter((f) => graphFiles.has(f));
    for (const f of known) {
      fileCommitCount.set(f, (fileCommitCount.get(f) ?? 0) + 1);
    }
    for (let i = 0; i < known.length; i++) {
      for (let j = i + 1; j < known.length; j++) {
        const key = pairKey(known[i], known[j]);
        cochangeCount.set(key, (cochangeCount.get(key) ?? 0) + 1);
      }
    }
  }

  const depPairs = buildDependencyPairSet(graph, graphFiles);

  const pairs: CouplingPair[] = [];

  for (const [key, cochanges] of cochangeCount) {
    if (cochanges < minCochanges) continue;

    const [fileA, fileB] = key.split("\0");
    const commitsA = fileCommitCount.get(fileA) ?? 0;
    const commitsB = fileCommitCount.get(fileB) ?? 0;
    const minCommitCount = Math.min(commitsA, commitsB);
    if (minCommitCount === 0) continue;

    const couplingRatio = cochanges / minCommitCount;
    if (couplingRatio < minRatio) continue;

    const hasDependency = depPairs.has(key);
    const kind: CouplingKind = hasDependency ? "confirmed" : "hidden";

    pairs.push({
      fileA, fileB,
      cochanges,
      couplingRatio: Math.round(couplingRatio * 100) / 100,
      hasDependency,
      kind,
    });
  }

  pairs.sort((a, b) => {
    if (a.kind === "hidden" && b.kind !== "hidden") return -1;
    if (a.kind !== "hidden" && b.kind === "hidden") return 1;
    return b.couplingRatio - a.couplingRatio;
  });

  return {
    pairs,
    hidden: pairs.filter((p) => p.kind === "hidden"),
    commitsAnalyzed: commits.length,
    filesAnalyzed: graphFiles.size,
  };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function buildDependencyPairSet(
  graph: DependencyGraph,
  graphFiles: Set<string>,
): Set<string> {
  const depPairs = new Set<string>();
  const edges = graph.allEdges().filter(
    (e) => e.kind === "imports" && !e.to.startsWith("external:"),
  );

  for (const edge of edges) {
    const from = edge.from.replace(/^file:/, "");
    const to = edge.to.replace(/^file:/, "");
    if (graphFiles.has(from) && graphFiles.has(to)) {
      depPairs.add(pairKey(from, to));
    }
  }

  return depPairs;
}

function getCommitFileSets(rootDir: string, maxCommits: number): string[][] {
  try {
    const raw = execSync(
      `git log --pretty=format:"---COMMIT---" --name-only -n ${maxCommits}`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 },
    );

    const commits: string[][] = [];
    let current: string[] = [];

    for (const line of raw.split("\n")) {
      if (line.trim() === "---COMMIT---") {
        if (current.length > 0) commits.push(current);
        current = [];
      } else {
        const file = line.trim();
        if (file.length > 0) current.push(file);
      }
    }
    if (current.length > 0) commits.push(current);

    return commits;
  } catch {
    return [];
  }
}
