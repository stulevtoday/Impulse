import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeHotspots } from "../../src/core/hotspots.js";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}

function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}

describe("analyzeHotspots", () => {
  it("runs on the real project without errors", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("src/core/graph.ts"));
    g.addNode(fileNode("src/core/health.ts"));
    g.addNode(fileNode("src/cli/index.ts"));

    g.addEdge(importEdge("src/core/health.ts", "src/core/graph.ts"));
    g.addEdge(importEdge("src/cli/index.ts", "src/core/graph.ts"));

    const report = analyzeHotspots(g, process.cwd(), 50);

    assert.ok(Array.isArray(report.hotspots));
    assert.equal(typeof report.totalFiles, "number");
    assert.equal(typeof report.commitsAnalyzed, "number");
  });

  it("hotspot score is 0 for files with no git changes", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("nonexistent-file-abc.ts"));

    const report = analyzeHotspots(g, process.cwd(), 50);

    const match = report.hotspots.find((h) => h.file === "nonexistent-file-abc.ts");
    assert.equal(match, undefined);
  });

  it("sorts by score descending", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("src/core/graph.ts"));
    g.addNode(fileNode("src/core/health.ts"));
    g.addNode(fileNode("src/cli/index.ts"));
    g.addNode(fileNode("src/core/analyzer.ts"));

    g.addEdge(importEdge("src/core/health.ts", "src/core/graph.ts"));
    g.addEdge(importEdge("src/cli/index.ts", "src/core/graph.ts"));
    g.addEdge(importEdge("src/core/analyzer.ts", "src/core/graph.ts"));

    const report = analyzeHotspots(g, process.cwd(), 100);

    for (let i = 1; i < report.hotspots.length; i++) {
      assert.ok(report.hotspots[i].score <= report.hotspots[i - 1].score);
    }
  });

  it("classifies risk levels correctly", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("src/core/graph.ts"));
    g.addNode(fileNode("src/core/health.ts"));
    g.addEdge(importEdge("src/core/health.ts", "src/core/graph.ts"));

    const report = analyzeHotspots(g, process.cwd(), 200);

    for (const h of report.hotspots) {
      if (h.score >= 60) assert.equal(h.risk, "critical");
      else if (h.score >= 40) assert.equal(h.risk, "high");
      else if (h.score >= 20) assert.equal(h.risk, "medium");
      else assert.equal(h.risk, "low");
    }
  });

  it("handles non-git directory gracefully", () => {
    const g = new DependencyGraph();
    g.addNode(fileNode("test.ts"));

    const report = analyzeHotspots(g, "/tmp", 50);

    assert.equal(report.commitsAnalyzed, 0);
    assert.equal(report.hotspots.length, 0);
  });
});
