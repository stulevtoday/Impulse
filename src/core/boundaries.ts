import type { DependencyGraph } from "./graph.js";
import type { BoundaryRule } from "./config-types.js";

export interface BoundaryViolation {
  from: string;
  to: string;
  fromBoundary: string;
  toBoundary: string;
}

export interface BoundaryReport {
  violations: BoundaryViolation[];
  boundaryStats: Array<{
    name: string;
    path: string;
    files: number;
    internalEdges: number;
    externalEdges: number;
    violations: number;
  }>;
  unassigned: string[];
}

export function checkBoundaries(
  graph: DependencyGraph,
  boundaries: Record<string, BoundaryRule>,
): BoundaryReport {
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const fileToBoundary = new Map<string, string>();

  for (const file of fileNodes) {
    for (const [name, rule] of Object.entries(boundaries)) {
      if (matchGlob(file.filePath, rule.path)) {
        fileToBoundary.set(file.filePath, name);
        break;
      }
    }
  }

  const violations: BoundaryViolation[] = [];
  const boundaryViolationCounts = new Map<string, number>();
  const boundaryInternalEdges = new Map<string, number>();
  const boundaryExternalEdges = new Map<string, number>();
  const boundaryFileCount = new Map<string, number>();

  for (const [name] of Object.entries(boundaries)) {
    boundaryViolationCounts.set(name, 0);
    boundaryInternalEdges.set(name, 0);
    boundaryExternalEdges.set(name, 0);
    boundaryFileCount.set(name, 0);
  }

  for (const file of fileNodes) {
    const fromBoundary = fileToBoundary.get(file.filePath);
    if (!fromBoundary) continue;

    boundaryFileCount.set(fromBoundary, (boundaryFileCount.get(fromBoundary) ?? 0) + 1);

    const deps = graph.getDependencies(file.id).filter(
      (e) => e.kind === "imports" && !e.to.startsWith("external:"),
    );

    for (const edge of deps) {
      const targetPath = edge.to.replace(/^file:/, "");
      const toBoundary = fileToBoundary.get(targetPath);

      if (!toBoundary) continue;

      if (toBoundary === fromBoundary) {
        boundaryInternalEdges.set(fromBoundary, (boundaryInternalEdges.get(fromBoundary) ?? 0) + 1);
        continue;
      }

      boundaryExternalEdges.set(fromBoundary, (boundaryExternalEdges.get(fromBoundary) ?? 0) + 1);

      const allowed = boundaries[fromBoundary].allow;
      if (!allowed.includes(toBoundary)) {
        violations.push({
          from: file.filePath,
          to: targetPath,
          fromBoundary,
          toBoundary,
        });
        boundaryViolationCounts.set(fromBoundary, (boundaryViolationCounts.get(fromBoundary) ?? 0) + 1);
      }
    }
  }

  const unassigned = fileNodes
    .filter((n) => !fileToBoundary.has(n.filePath))
    .map((n) => n.filePath)
    .sort();

  const boundaryStats = Object.entries(boundaries).map(([name, rule]) => ({
    name,
    path: rule.path,
    files: boundaryFileCount.get(name) ?? 0,
    internalEdges: boundaryInternalEdges.get(name) ?? 0,
    externalEdges: boundaryExternalEdges.get(name) ?? 0,
    violations: boundaryViolationCounts.get(name) ?? 0,
  }));

  violations.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return { violations, boundaryStats, unassigned };
}

export function matchGlob(filePath: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(filePath);
}

function globToRegex(pattern: string): RegExp {
  let re = "^";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        re += "(?:.+/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }

  re += "$";
  return new RegExp(re);
}
