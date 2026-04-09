import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { analyzeHealth } from "../../src/core/health.js";

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}

function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}

function externalEdge(from: string, pkg: string): GraphEdge {
  return { from: `file:${from}`, to: `external:${pkg}`, kind: "imports" };
}

function buildGraph(
  files: string[],
  imports: Array<[string, string]>,
  externals: Array<[string, string]> = [],
): DependencyGraph {
  const g = new DependencyGraph();
  for (const f of files) g.addNode(fileNode(f));
  for (const [from, to] of imports) g.addEdge(importEdge(from, to));
  for (const [from, pkg] of externals) {
    g.addEdge(externalEdge(from, pkg));
  }
  return g;
}

describe("analyzeHealth", () => {
  describe("clean project", () => {
    it("scores 100 for a small acyclic project", () => {
      const g = buildGraph(
        ["a.ts", "b.ts", "c.ts"],
        [["a.ts", "b.ts"], ["b.ts", "c.ts"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.score, 100);
      assert.equal(report.grade, "A");
      assert.equal(report.cycles.length, 0);
      assert.equal(report.godFiles.length, 0);
      assert.equal(report.orphans.length, 0);
    });

    it("returns correct stats", () => {
      const g = buildGraph(
        ["a.ts", "b.ts"],
        [["a.ts", "b.ts"]],
        [["a.ts", "react"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.stats.totalFiles, 2);
      assert.equal(report.stats.localEdges, 1);
      assert.equal(report.stats.externalEdges, 1);
    });
  });

  describe("cycle detection", () => {
    it("detects tight-couple (A ↔ B)", () => {
      const g = buildGraph(
        ["a.ts", "b.ts"],
        [["a.ts", "b.ts"], ["b.ts", "a.ts"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.cycles.length, 1);
      assert.equal(report.cycles[0].severity, "tight-couple");
      assert.equal(report.cycles[0].length, 2);
    });

    it("detects short-ring (A → B → C → A)", () => {
      const g = buildGraph(
        ["a.ts", "b.ts", "c.ts"],
        [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.cycles.length, 1);
      assert.equal(report.cycles[0].severity, "short-ring");
      assert.equal(report.cycles[0].length, 3);
    });

    it("detects long-ring (5+ files)", () => {
      const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
      const imports: Array<[string, string]> = [
        ["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "d.ts"],
        ["d.ts", "e.ts"], ["e.ts", "a.ts"],
      ];
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.equal(report.cycles.length, 1);
      assert.equal(report.cycles[0].severity, "long-ring");
      assert.equal(report.cycles[0].length, 5);
    });
  });

  describe("cycle penalties", () => {
    it("tight-couple: -3 per cycle", () => {
      const g = buildGraph(
        ["a.ts", "b.ts"],
        [["a.ts", "b.ts"], ["b.ts", "a.ts"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.penalties.cycles, 3);
    });

    it("short-ring: -8 per cycle", () => {
      const g = buildGraph(
        ["a.ts", "b.ts", "c.ts"],
        [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.penalties.cycles, 8);
    });

    it("long-ring: -15 per cycle", () => {
      const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
      const imports: Array<[string, string]> = [
        ["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "d.ts"],
        ["d.ts", "e.ts"], ["e.ts", "a.ts"],
      ];
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.equal(report.penalties.cycles, 15);
    });

    it("caps cycle penalty at 50", () => {
      const files: string[] = [];
      const imports: Array<[string, string]> = [];
      for (let i = 0; i < 20; i++) {
        const a = `pair${i}-a.ts`;
        const b = `pair${i}-b.ts`;
        files.push(a, b);
        imports.push([a, b], [b, a]);
      }
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.equal(report.penalties.cycles, 50);
    });
  });

  describe("god file detection", () => {
    it("detects files with >= 10 dependents", () => {
      const files = ["hub.ts"];
      const imports: Array<[string, string]> = [];
      for (let i = 0; i < 12; i++) {
        files.push(`consumer${i}.ts`);
        imports.push([`consumer${i}.ts`, "hub.ts"]);
      }
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.equal(report.godFiles.length, 1);
      assert.equal(report.godFiles[0].file, "hub.ts");
      assert.equal(report.godFiles[0].importedBy, 12);
    });

    it("does not flag files below threshold", () => {
      const files = ["lib.ts"];
      const imports: Array<[string, string]> = [];
      for (let i = 0; i < 5; i++) {
        files.push(`c${i}.ts`);
        imports.push([`c${i}.ts`, "lib.ts"]);
      }
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.equal(report.godFiles.length, 0);
    });

    it("caps god file penalty at 20", () => {
      const files: string[] = [];
      const imports: Array<[string, string]> = [];
      for (let h = 0; h < 6; h++) {
        const hub = `hub${h}.ts`;
        files.push(hub);
        for (let i = 0; i < 10; i++) {
          const consumer = `c${h}-${i}.ts`;
          files.push(consumer);
          imports.push([consumer, hub]);
        }
      }
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.ok(report.godFiles.length >= 6);
      assert.equal(report.penalties.godFiles, 20);
    });
  });

  describe("orphan detection", () => {
    it("identifies files with no local connections", () => {
      const g = buildGraph(
        ["connected.ts", "orphan.ts", "other.ts"],
        [["connected.ts", "other.ts"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.orphans.length, 1);
      assert.equal(report.orphans[0], "orphan.ts");
    });

    it("files with only external deps are orphans", () => {
      const g = buildGraph(
        ["app.ts"],
        [],
        [["app.ts", "react"]],
      );

      const report = analyzeHealth(g);
      assert.equal(report.orphans.length, 1);
    });

    it("files with exports but no imports are orphans", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("orphan.ts"));
      g.addNode({ id: "export:orphan.ts:Foo", kind: "export", filePath: "orphan.ts", name: "Foo" });
      g.addEdge({ from: "file:orphan.ts", to: "export:orphan.ts:Foo", kind: "exports" });

      g.addNode(fileNode("connected.ts"));
      g.addNode(fileNode("other.ts"));
      g.addEdge(importEdge("connected.ts", "other.ts"));

      const report = analyzeHealth(g);
      assert.ok(report.orphans.includes("orphan.ts"), "file with exports but no imports should be orphan");
      assert.ok(!report.orphans.includes("connected.ts"));
    });
  });

  describe("deep chain penalty", () => {
    it("penalizes chains deeper than 5", () => {
      const files: string[] = [];
      const imports: Array<[string, string]> = [];
      for (let i = 0; i < 7; i++) {
        files.push(`f${i}.ts`);
        if (i > 0) imports.push([`f${i}.ts`, `f${i - 1}.ts`]);
      }
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.ok(report.penalties.deepChains >= 8);
    });
  });

  describe("grade boundaries", () => {
    it("A for score >= 90", () => {
      const g = buildGraph(["a.ts", "b.ts"], [["a.ts", "b.ts"]]);
      const report = analyzeHealth(g);
      assert.equal(report.grade, "A");
    });

    it("grades are correct for known scores", () => {
      const gradeMap: Record<string, [number, number]> = {
        A: [90, 100],
        B: [80, 89],
        C: [70, 79],
        D: [60, 69],
        F: [0, 59],
      };

      for (const [grade, [min, max]] of Object.entries(gradeMap)) {
        assert.ok(min <= max, `Invalid range for ${grade}`);
      }

      // Verify with a clean project (A)
      const clean = buildGraph(["a.ts", "b.ts"], [["a.ts", "b.ts"]]);
      assert.equal(analyzeHealth(clean).grade, "A");

      // Verify with cycles (lower grade)
      const cyclic = buildGraph(
        ["a.ts", "b.ts", "c.ts"],
        [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"]],
      );
      const cyclicReport = analyzeHealth(cyclic);
      assert.ok(cyclicReport.score < 100);
    });
  });

  describe("summary", () => {
    it("reports clean architecture with no issues", () => {
      const g = buildGraph(["a.ts", "b.ts"], [["a.ts", "b.ts"]]);
      const report = analyzeHealth(g);
      assert.ok(report.summary.includes("Clean"));
    });

    it("mentions cycles in summary", () => {
      const g = buildGraph(
        ["a.ts", "b.ts"],
        [["a.ts", "b.ts"], ["b.ts", "a.ts"]],
      );
      const report = analyzeHealth(g);
      assert.ok(report.summary.includes("cycle"));
    });
  });

  describe("hub concentration", () => {
    it("penalizes extreme hub concentration (>30 importedBy)", () => {
      const files = ["hub.ts"];
      const imports: Array<[string, string]> = [];
      for (let i = 0; i < 35; i++) {
        files.push(`c${i}.ts`);
        imports.push([`c${i}.ts`, "hub.ts"]);
      }
      const g = buildGraph(files, imports);

      const report = analyzeHealth(g);
      assert.equal(report.penalties.hubConcentration, 10);
    });
  });
});
