import type { DependencyGraph } from "./graph.js";
import type { BoundaryRule } from "./config-types.js";
import { matchGlob } from "./boundaries.js";

export interface ModuleMetrics {
  name: string;
  path: string;
  files: number;
  internalEdges: number;
  ca: number;
  ce: number;
  instability: number;
  cohesion: number;
}

export interface StabilityViolation {
  from: string;
  to: string;
  fromInstability: number;
  toInstability: number;
}

export interface StabilityReport {
  modules: ModuleMetrics[];
  violations: StabilityViolation[];
}

export function analyzeStability(
  graph: DependencyGraph,
  boundaries: Record<string, BoundaryRule>,
): StabilityReport {
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

  const counters = new Map<string, { files: number; internal: number; ca: number; ce: number }>();
  for (const name of Object.keys(boundaries)) {
    counters.set(name, { files: 0, internal: 0, ca: 0, ce: 0 });
  }

  for (const [, boundary] of fileToBoundary) {
    const c = counters.get(boundary);
    if (c) c.files++;
  }

  const boundaryDeps = new Set<string>();

  for (const file of fileNodes) {
    const fromBoundary = fileToBoundary.get(file.filePath);
    if (!fromBoundary) continue;

    const deps = graph.getDependencies(file.id).filter(
      (e) => e.kind === "imports" && !e.to.startsWith("external:"),
    );

    for (const edge of deps) {
      const targetPath = edge.to.replace(/^file:/, "");
      const toBoundary = fileToBoundary.get(targetPath);
      if (!toBoundary) continue;

      if (toBoundary === fromBoundary) {
        counters.get(fromBoundary)!.internal++;
      } else {
        counters.get(fromBoundary)!.ce++;
        counters.get(toBoundary)!.ca++;
        boundaryDeps.add(`${fromBoundary}\0${toBoundary}`);
      }
    }
  }

  const modules: ModuleMetrics[] = Object.entries(boundaries).map(([name, rule]) => {
    const c = counters.get(name)!;
    const couplingTotal = c.ca + c.ce;
    const instability = couplingTotal > 0 ? c.ce / couplingTotal : 0;
    const edgeTotal = c.internal + c.ca + c.ce;
    const cohesion = edgeTotal > 0 ? c.internal / edgeTotal : 0;

    return {
      name,
      path: rule.path,
      files: c.files,
      internalEdges: c.internal,
      ca: c.ca,
      ce: c.ce,
      instability: Math.round(instability * 100) / 100,
      cohesion: Math.round(cohesion * 100) / 100,
    };
  });

  modules.sort((a, b) => a.instability - b.instability);

  const metricsByName = new Map(modules.map((m) => [m.name, m]));
  const violations: StabilityViolation[] = [];

  for (const dep of boundaryDeps) {
    const [from, to] = dep.split("\0");
    const fromM = metricsByName.get(from);
    const toM = metricsByName.get(to);
    if (!fromM || !toM) continue;

    if (toM.instability > fromM.instability + 0.1) {
      violations.push({
        from,
        to,
        fromInstability: fromM.instability,
        toInstability: toM.instability,
      });
    }
  }

  violations.sort((a, b) =>
    (b.toInstability - b.fromInstability) - (a.toInstability - a.fromInstability),
  );

  return { modules, violations };
}
