import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { analyzeHealth } from "../../src/core/health.js";
import { computeDimensions, computeTrend, debtGrade, type DebtSnapshot } from "../../src/core/debt.js";
import type { ComplexityReport } from "../../src/core/complexity.js";
import type { CouplingReport } from "../../src/core/coupling.js";
import type { HotspotReport } from "../../src/core/hotspots.js";
import type { BoundaryReport } from "../../src/core/boundaries.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}

function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}

function buildGraph(
  files: string[],
  imports: Array<[string, string]>,
): DependencyGraph {
  const g = new DependencyGraph();
  for (const f of files) g.addNode(fileNode(f));
  for (const [from, to] of imports) g.addEdge(importEdge(from, to));
  return g;
}

function cleanComplexity(): ComplexityReport {
  return {
    files: [],
    functions: [],
    totalFunctions: 10,
    avgCyclomatic: 2,
    avgCognitive: 3,
    distribution: { simple: 8, moderate: 2, complex: 0, alarming: 0 },
  };
}

function alarmingComplexity(): ComplexityReport {
  return {
    files: [],
    functions: [],
    totalFunctions: 10,
    avgCyclomatic: 15,
    avgCognitive: 20,
    distribution: { simple: 2, moderate: 1, complex: 3, alarming: 4 },
  };
}

function cleanCoupling(): CouplingReport {
  return { pairs: [], hidden: [], commitsAnalyzed: 100, filesAnalyzed: 10 };
}

function messyCoupling(): CouplingReport {
  return {
    pairs: [
      { fileA: "a.ts", fileB: "b.ts", cochanges: 20, couplingRatio: 0.8, hasDependency: false, kind: "hidden" },
      { fileA: "c.ts", fileB: "d.ts", cochanges: 15, couplingRatio: 0.6, hasDependency: false, kind: "hidden" },
      { fileA: "e.ts", fileB: "f.ts", cochanges: 10, couplingRatio: 0.5, hasDependency: false, kind: "hidden" },
    ],
    hidden: [
      { fileA: "a.ts", fileB: "b.ts", cochanges: 20, couplingRatio: 0.8, hasDependency: false, kind: "hidden" },
      { fileA: "c.ts", fileB: "d.ts", cochanges: 15, couplingRatio: 0.6, hasDependency: false, kind: "hidden" },
      { fileA: "e.ts", fileB: "f.ts", cochanges: 10, couplingRatio: 0.5, hasDependency: false, kind: "hidden" },
    ],
    commitsAnalyzed: 100,
    filesAnalyzed: 10,
  };
}

function cleanHotspots(): HotspotReport {
  return { hotspots: [], totalFiles: 10, commitsAnalyzed: 100 };
}

function riskyHotspots(): HotspotReport {
  return {
    hotspots: [
      { file: "a.ts", changes: 50, affected: 20, score: 80, risk: "critical" },
      { file: "b.ts", changes: 30, affected: 15, score: 60, risk: "critical" },
      { file: "c.ts", changes: 20, affected: 10, score: 45, risk: "high" },
    ],
    totalFiles: 10,
    commitsAnalyzed: 100,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("debt scoring", () => {
  describe("debtGrade", () => {
    it("assigns A for score <= 10", () => {
      assert.equal(debtGrade(0), "A");
      assert.equal(debtGrade(10), "A");
    });

    it("assigns B for score 11-20", () => {
      assert.equal(debtGrade(11), "B");
      assert.equal(debtGrade(20), "B");
    });

    it("assigns C for score 21-35", () => {
      assert.equal(debtGrade(21), "C");
      assert.equal(debtGrade(35), "C");
    });

    it("assigns D for score 36-50", () => {
      assert.equal(debtGrade(36), "D");
      assert.equal(debtGrade(50), "D");
    });

    it("assigns F for score > 50", () => {
      assert.equal(debtGrade(51), "F");
      assert.equal(debtGrade(100), "F");
    });
  });

  describe("computeDimensions", () => {
    it("returns all 5 dimensions", () => {
      const g = buildGraph(["a.ts", "b.ts"], [["a.ts", "b.ts"]]);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), cleanHotspots(), null, 2);
      assert.equal(dims.length, 5);
      const names = dims.map((d) => d.name);
      assert.deepEqual(names, ["structure", "complexity", "coupling", "churn", "boundaries"]);
    });

    it("all scores are 0 for a clean project", () => {
      const g = buildGraph(["a.ts", "b.ts", "c.ts"], [["a.ts", "b.ts"], ["b.ts", "c.ts"]]);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), cleanHotspots(), null, 3);
      for (const d of dims) {
        assert.ok(d.score <= 5, `${d.name} should have low score, got ${d.score}`);
      }
    });

    it("structure dimension reflects health penalties", () => {
      const g = buildGraph(
        ["a.ts", "b.ts"],
        [["a.ts", "b.ts"], ["b.ts", "a.ts"]],
      );
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), cleanHotspots(), null, 2);
      const structure = dims.find((d) => d.name === "structure")!;
      assert.ok(structure.score > 0, "should have structural debt from cycles");
      assert.ok(structure.details.includes("cycle"));
    });

    it("complexity dimension flags alarming functions", () => {
      const g = buildGraph(["a.ts"], []);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, alarmingComplexity(), cleanCoupling(), cleanHotspots(), null, 1);
      const cx = dims.find((d) => d.name === "complexity")!;
      assert.ok(cx.score >= 70, `alarming complexity should score high, got ${cx.score}`);
    });

    it("coupling dimension scores hidden pairs", () => {
      const g = buildGraph(["a.ts", "b.ts"], [["a.ts", "b.ts"]]);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), messyCoupling(), cleanHotspots(), null, 10);
      const coup = dims.find((d) => d.name === "coupling")!;
      assert.ok(coup.score > 0, "should have coupling debt from hidden pairs");
    });

    it("churn dimension scores critical hotspots", () => {
      const g = buildGraph(["a.ts", "b.ts"], [["a.ts", "b.ts"]]);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), riskyHotspots(), null, 10);
      const churn = dims.find((d) => d.name === "churn")!;
      assert.ok(churn.score > 0, "should have churn debt from hotspots");
    });

    it("boundaries dimension is 0 with no config", () => {
      const g = buildGraph(["a.ts"], []);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), cleanHotspots(), null, 1);
      const bounds = dims.find((d) => d.name === "boundaries")!;
      assert.equal(bounds.score, 0);
    });

    it("boundaries dimension reflects violations", () => {
      const g = buildGraph(["a.ts"], []);
      const health = analyzeHealth(g);
      const boundaries: BoundaryReport = {
        violations: [
          { from: "a.ts", to: "b.ts", fromBoundary: "ui", toBoundary: "db" },
          { from: "c.ts", to: "d.ts", fromBoundary: "ui", toBoundary: "db" },
          { from: "e.ts", to: "f.ts", fromBoundary: "ui", toBoundary: "db" },
        ],
        boundaryStats: [
          { name: "ui", path: "src/ui/**", files: 5, internalEdges: 3, externalEdges: 3, violations: 3 },
          { name: "db", path: "src/db/**", files: 3, internalEdges: 2, externalEdges: 0, violations: 0 },
        ],
        unassigned: [],
      };
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), cleanHotspots(), boundaries, 1);
      const b = dims.find((d) => d.name === "boundaries")!;
      assert.ok(b.score > 0, "should have boundary debt from violations");
    });

    it("weights sum to 1.0", () => {
      const g = buildGraph(["a.ts"], []);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), cleanHotspots(), null, 1);
      const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
      assert.ok(Math.abs(totalWeight - 1.0) < 0.001, `weights should sum to 1.0, got ${totalWeight}`);
    });
  });

  describe("computeTrend", () => {
    it("returns stable for single snapshot", () => {
      const snapshots: DebtSnapshot[] = [
        { timestamp: 1000, score: 25, grade: "C", totalFiles: 10, dimensions: {} },
      ];
      const trend = computeTrend(snapshots);
      assert.equal(trend.direction, "stable");
      assert.equal(trend.delta, 0);
    });

    it("detects improving trend (score dropped by 3+)", () => {
      const snapshots: DebtSnapshot[] = [
        { timestamp: 1000, score: 30, grade: "C", totalFiles: 10, dimensions: {} },
        { timestamp: 2000, score: 25, grade: "C", totalFiles: 10, dimensions: {} },
      ];
      const trend = computeTrend(snapshots);
      assert.equal(trend.direction, "improving");
      assert.equal(trend.delta, -5);
    });

    it("detects worsening trend (score increased by 3+)", () => {
      const snapshots: DebtSnapshot[] = [
        { timestamp: 1000, score: 20, grade: "B", totalFiles: 10, dimensions: {} },
        { timestamp: 2000, score: 28, grade: "C", totalFiles: 10, dimensions: {} },
      ];
      const trend = computeTrend(snapshots);
      assert.equal(trend.direction, "worsening");
      assert.equal(trend.delta, 8);
    });

    it("reports stable for small changes (< 3)", () => {
      const snapshots: DebtSnapshot[] = [
        { timestamp: 1000, score: 25, grade: "C", totalFiles: 10, dimensions: {} },
        { timestamp: 2000, score: 26, grade: "C", totalFiles: 10, dimensions: {} },
      ];
      const trend = computeTrend(snapshots);
      assert.equal(trend.direction, "stable");
      assert.equal(trend.delta, 1);
    });

    it("compares only last two snapshots", () => {
      const snapshots: DebtSnapshot[] = [
        { timestamp: 1000, score: 50, grade: "D", totalFiles: 10, dimensions: {} },
        { timestamp: 2000, score: 40, grade: "D", totalFiles: 10, dimensions: {} },
        { timestamp: 3000, score: 35, grade: "C", totalFiles: 10, dimensions: {} },
      ];
      const trend = computeTrend(snapshots);
      assert.equal(trend.direction, "improving");
      assert.equal(trend.delta, -5);
    });
  });

  describe("composite score", () => {
    it("clean project produces low debt score", () => {
      const g = buildGraph(["a.ts", "b.ts", "c.ts"], [["a.ts", "b.ts"], ["b.ts", "c.ts"]]);
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, cleanComplexity(), cleanCoupling(), cleanHotspots(), null, 3);
      const score = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0));
      assert.ok(score <= 10, `clean project should have low debt, got ${score}`);
    });

    it("problematic project produces high debt score", () => {
      const g = buildGraph(
        ["a.ts", "b.ts", "c.ts"],
        [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"]],
      );
      const health = analyzeHealth(g);
      const dims = computeDimensions(health, alarmingComplexity(), messyCoupling(), riskyHotspots(), null, 3);
      const score = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0));
      assert.ok(score >= 30, `problematic project should have high debt, got ${score}`);
    });
  });
});
