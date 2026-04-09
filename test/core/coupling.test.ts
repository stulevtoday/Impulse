import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { analyzeCoupling } from "../../src/core/coupling.js";

function node(id: string, filePath: string): GraphNode {
  return { id, filePath, kind: "file", name: filePath };
}
function edge(from: string, to: string): GraphEdge {
  return { from, to, kind: "imports", metadata: {} };
}

describe("analyzeCoupling", () => {
  it("runs on the real project without errors", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/a.ts", "src/a.ts"));
    const report = analyzeCoupling(graph, ".", 50, 1, 0.1);
    assert.ok(Array.isArray(report.pairs));
    assert.ok(typeof report.commitsAnalyzed === "number");
  });

  it("returns empty when no git history", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/a.ts", "src/a.ts"));
    const report = analyzeCoupling(graph, "/tmp/no-git-here", 50, 1, 0.1);
    assert.equal(report.pairs.length, 0);
    assert.equal(report.commitsAnalyzed, 0);
  });

  it("classifies pairs as hidden when no dependency exists", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core/graph.ts", "src/core/graph.ts"));
    graph.addNode(node("file:src/core/parser.ts", "src/core/parser.ts"));

    const report = analyzeCoupling(graph, ".", 200, 2, 0.1);

    for (const pair of report.hidden) {
      assert.equal(pair.kind, "hidden");
      assert.equal(pair.hasDependency, false);
    }
  });

  it("classifies pairs as confirmed when dependency exists", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core/graph.ts", "src/core/graph.ts"));
    graph.addNode(node("file:src/core/health.ts", "src/core/health.ts"));
    graph.addEdge(edge("file:src/core/health.ts", "file:src/core/graph.ts"));

    const report = analyzeCoupling(graph, ".", 200, 2, 0.1);
    const confirmed = report.pairs.filter((p) => p.kind === "confirmed");

    for (const pair of confirmed) {
      assert.equal(pair.hasDependency, true);
    }
  });

  it("respects minCochanges threshold", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core/graph.ts", "src/core/graph.ts"));
    graph.addNode(node("file:src/core/parser.ts", "src/core/parser.ts"));

    const loose = analyzeCoupling(graph, ".", 200, 1, 0.01);
    const strict = analyzeCoupling(graph, ".", 200, 100, 0.01);
    assert.ok(strict.pairs.length <= loose.pairs.length);
  });

  it("respects minRatio threshold", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core/graph.ts", "src/core/graph.ts"));
    graph.addNode(node("file:src/core/parser.ts", "src/core/parser.ts"));

    const loose = analyzeCoupling(graph, ".", 200, 1, 0.01);
    const strict = analyzeCoupling(graph, ".", 200, 1, 0.99);
    assert.ok(strict.pairs.length <= loose.pairs.length);
  });

  it("sorts hidden pairs before confirmed", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core/graph.ts", "src/core/graph.ts"));
    graph.addNode(node("file:src/core/parser.ts", "src/core/parser.ts"));
    graph.addNode(node("file:src/core/health.ts", "src/core/health.ts"));
    graph.addEdge(edge("file:src/core/health.ts", "file:src/core/graph.ts"));

    const report = analyzeCoupling(graph, ".", 200, 1, 0.01);

    if (report.pairs.length >= 2) {
      const firstHiddenIdx = report.pairs.findIndex((p) => p.kind === "hidden");
      const firstConfirmedIdx = report.pairs.findIndex((p) => p.kind === "confirmed");
      if (firstHiddenIdx >= 0 && firstConfirmedIdx >= 0) {
        assert.ok(firstHiddenIdx < firstConfirmedIdx);
      }
    }
  });

  it("coupling ratio is between 0 and 1", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core/graph.ts", "src/core/graph.ts"));
    graph.addNode(node("file:src/core/parser.ts", "src/core/parser.ts"));

    const report = analyzeCoupling(graph, ".", 200, 1, 0.01);

    for (const pair of report.pairs) {
      assert.ok(pair.couplingRatio >= 0 && pair.couplingRatio <= 1,
        `ratio ${pair.couplingRatio} out of range for ${pair.fileA} ↔ ${pair.fileB}`);
    }
  });
});
