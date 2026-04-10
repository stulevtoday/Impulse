import type { DependencyGraph } from "./graph.js";
import { isTestFile } from "./test-targets.js";

export type SafetyVerdict = "safe" | "caution" | "risky" | "dangerous";

export interface SafeDeleteExport {
  name: string;
  consumers: string[];
  dead: boolean;
}

export interface SafeDeleteReport {
  file: string;
  exists: boolean;
  verdict: SafetyVerdict;
  reason: string;
  importedBy: string[];
  exports: SafeDeleteExport[];
  liveExportCount: number;
  deadExportCount: number;
  blastRadius: number;
  testsCovering: string[];
  isTestFile: boolean;
  recommendations: string[];
}

export function analyzeSafeDelete(
  graph: DependencyGraph,
  filePath: string,
): SafeDeleteReport {
  const fileId = `file:${filePath}`;
  const node = graph.getNode(fileId);

  if (!node) {
    return {
      file: filePath, exists: false,
      verdict: "safe", reason: "File not found in dependency graph",
      importedBy: [], exports: [],
      liveExportCount: 0, deadExportCount: 0,
      blastRadius: 0, testsCovering: [],
      isTestFile: false, recommendations: [],
    };
  }

  const revDeps = graph.getDependents(fileId).filter((e) => e.kind === "imports");
  const importedBy = revDeps.map((e) => e.from.replace(/^file:/, "")).sort();

  const declaredExports = graph.getDeclaredExports(filePath);
  const allEdges = graph.allEdges();
  const exports: SafeDeleteExport[] = declaredExports.map((exp) => {
    const consumers = allEdges
      .filter((e) => e.to === exp.id && e.kind === "uses_export")
      .map((e) => e.from.replace(/^file:/, ""));
    return { name: exp.name, consumers, dead: consumers.length === 0 };
  });

  const liveExportCount = exports.filter((e) => !e.dead).length;
  const deadExportCount = exports.filter((e) => e.dead).length;

  const impact = graph.analyzeFileImpact(filePath);
  const fileImpact = impact.affected.filter((a) => a.node.kind === "file");
  const blastRadius = fileImpact.length;
  const testsCovering = fileImpact
    .filter((a) => isTestFile(a.node.filePath))
    .map((a) => a.node.filePath)
    .sort();

  const isTest = isTestFile(filePath);

  const { verdict, reason } = determineVerdict(importedBy.length, liveExportCount, blastRadius, isTest);

  const recommendations = generateRecommendations(importedBy, exports, blastRadius, isTest);

  return {
    file: filePath, exists: true,
    verdict, reason,
    importedBy, exports,
    liveExportCount, deadExportCount,
    blastRadius, testsCovering,
    isTestFile: isTest, recommendations,
  };
}

function determineVerdict(
  importedByCount: number,
  liveExports: number,
  blastRadius: number,
  isTest: boolean,
): { verdict: SafetyVerdict; reason: string } {
  if (isTest) {
    return { verdict: "safe", reason: "Test file — no production consumers" };
  }
  if (importedByCount === 0 && liveExports === 0) {
    return { verdict: "safe", reason: "No consumers — orphan file" };
  }
  if (importedByCount === 0 && liveExports > 0) {
    return { verdict: "caution", reason: "No direct importers but has live exports (may be consumed via barrel)" };
  }
  if (importedByCount <= 2 && blastRadius <= 5) {
    return { verdict: "caution", reason: `${importedByCount} importer(s), limited blast radius` };
  }
  if (importedByCount <= 5 && blastRadius <= 15) {
    return { verdict: "risky", reason: `${importedByCount} importer(s), ${blastRadius} files in blast radius` };
  }
  return {
    verdict: "dangerous",
    reason: `${importedByCount} importer(s), ${blastRadius} files in blast radius — high-impact deletion`,
  };
}

function generateRecommendations(
  importedBy: string[],
  exports: SafeDeleteExport[],
  blastRadius: number,
  isTest: boolean,
): string[] {
  const recs: string[] = [];

  if (isTest) {
    recs.push("Safe to delete — verify test coverage doesn't drop");
    return recs;
  }

  if (importedBy.length === 0 && exports.every((e) => e.dead)) {
    recs.push("Safe to delete — no consumers");
    return recs;
  }

  const liveExports = exports.filter((e) => !e.dead);
  if (liveExports.length > 0) {
    for (const exp of liveExports) {
      recs.push(`Migrate ${exp.name} consumers: ${exp.consumers.slice(0, 3).join(", ")}${exp.consumers.length > 3 ? ` (+${exp.consumers.length - 3} more)` : ""}`);
    }
  }

  if (importedBy.length > 0 && liveExports.length === 0) {
    recs.push(`Update ${importedBy.length} file(s) that import this file`);
  }

  if (blastRadius > 10) {
    recs.push("Consider gradual migration — high blast radius");
  }

  const deadExports = exports.filter((e) => e.dead);
  if (deadExports.length > 0 && liveExports.length > 0) {
    recs.push(`Remove ${deadExports.length} dead export(s) first: ${deadExports.map((e) => e.name).join(", ")}`);
  }

  return recs;
}
