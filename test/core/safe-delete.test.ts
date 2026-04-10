import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import { analyzeSafeDelete } from "../../src/core/safe-delete.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph-types.js";

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}
function exportNode(filePath: string, name: string): GraphNode {
  return { id: `export:${filePath}:${name}`, kind: "export", filePath, name };
}
function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}
function exportsEdge(filePath: string, name: string): GraphEdge {
  return { from: `file:${filePath}`, to: `export:${filePath}:${name}`, kind: "exports" };
}
function usesExportEdge(consumer: string, filePath: string, name: string): GraphEdge {
  return { from: `file:${consumer}`, to: `export:${filePath}:${name}`, kind: "uses_export" };
}

describe("analyzeSafeDelete", () => {
  it("returns safe verdict for file not in graph", () => {
    const g = new DependencyGraph();
    const report = analyzeSafeDelete(g, "nonexistent.ts");

    assert.equal(report.exists, false);
    assert.equal(report.verdict, "safe");
    assert.equal(report.importedBy.length, 0);
  });

  it("returns safe verdict for orphan file with no exports", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("orphan.ts"));

    const report = analyzeSafeDelete(g, "orphan.ts");

    assert.equal(report.exists, true);
    assert.equal(report.verdict, "safe");
    assert.equal(report.importedBy.length, 0);
    assert.ok(report.reason.includes("orphan"));
  });

  it("returns safe verdict for test files", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("src/app.ts"));
    g.addNode(fileNode("test/app.test.ts"));
    g.addEdge(importEdge("test/app.test.ts", "src/app.ts"));

    const report = analyzeSafeDelete(g, "test/app.test.ts");

    assert.equal(report.verdict, "safe");
    assert.equal(report.isTestFile, true);
  });

  it("returns caution for file with few importers", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("util.ts"));
    g.addNode(fileNode("app.ts"));
    g.addEdge(importEdge("app.ts", "util.ts"));

    const report = analyzeSafeDelete(g, "util.ts");

    assert.equal(report.verdict, "caution");
    assert.equal(report.importedBy.length, 1);
    assert.ok(report.importedBy.includes("app.ts"));
  });

  it("returns dangerous for file with many importers and large blast radius", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("core.ts"));

    for (let i = 0; i < 10; i++) {
      const name = `consumer-${i}.ts`;
      g.addNode(fileNode(name));
      g.addEdge(importEdge(name, "core.ts"));
      for (let j = 0; j < 2; j++) {
        const nested = `nested-${i}-${j}.ts`;
        g.addNode(fileNode(nested));
        g.addEdge(importEdge(nested, name));
      }
    }

    const report = analyzeSafeDelete(g, "core.ts");

    assert.equal(report.verdict, "dangerous");
    assert.equal(report.importedBy.length, 10);
    assert.ok(report.blastRadius >= 10);
  });

  it("tracks live and dead exports correctly", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("lib.ts"));
    g.addNode(fileNode("app.ts"));
    g.addNode(exportNode("lib.ts", "used"));
    g.addNode(exportNode("lib.ts", "unused"));
    g.addEdge(exportsEdge("lib.ts", "used"));
    g.addEdge(exportsEdge("lib.ts", "unused"));
    g.addEdge(importEdge("app.ts", "lib.ts"));
    g.addEdge(usesExportEdge("app.ts", "lib.ts", "used"));

    const report = analyzeSafeDelete(g, "lib.ts");

    assert.equal(report.liveExportCount, 1);
    assert.equal(report.deadExportCount, 1);
    assert.ok(report.exports.find((e) => e.name === "used" && !e.dead));
    assert.ok(report.exports.find((e) => e.name === "unused" && e.dead));
  });

  it("generates migration recommendations for live exports", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("lib.ts"));
    g.addNode(fileNode("a.ts"));
    g.addNode(fileNode("b.ts"));
    g.addNode(exportNode("lib.ts", "helper"));
    g.addEdge(exportsEdge("lib.ts", "helper"));
    g.addEdge(importEdge("a.ts", "lib.ts"));
    g.addEdge(importEdge("b.ts", "lib.ts"));
    g.addEdge(usesExportEdge("a.ts", "lib.ts", "helper"));
    g.addEdge(usesExportEdge("b.ts", "lib.ts", "helper"));

    const report = analyzeSafeDelete(g, "lib.ts");

    assert.ok(report.recommendations.length > 0);
    assert.ok(report.recommendations.some((r) => r.includes("helper")));
  });

  it("detects tests covering the file via impact analysis", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("src/util.ts"));
    g.addNode(fileNode("src/app.ts"));
    g.addNode(fileNode("test/util.test.ts"));
    g.addEdge(importEdge("src/app.ts", "src/util.ts"));
    g.addEdge(importEdge("test/util.test.ts", "src/util.ts"));

    const report = analyzeSafeDelete(g, "src/util.ts");

    assert.ok(report.testsCovering.length > 0);
    assert.ok(report.testsCovering.includes("test/util.test.ts"));
  });

  it("recommends gradual migration for high blast radius", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("core.ts"));

    for (let i = 0; i < 15; i++) {
      const name = `file-${i}.ts`;
      g.addNode(fileNode(name));
      g.addEdge(importEdge(name, "core.ts"));
    }

    const report = analyzeSafeDelete(g, "core.ts");

    assert.ok(report.recommendations.some((r) => r.includes("gradual")));
  });
});
