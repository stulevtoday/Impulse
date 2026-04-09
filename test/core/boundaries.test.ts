import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { checkBoundaries, type BoundaryReport } from "../../src/core/boundaries.js";
import type { BoundaryRule } from "../../src/core/config.js";

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}

function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}

function buildLayeredGraph(): DependencyGraph {
  const g = new DependencyGraph();

  g.addNode(fileNode("src/core/graph.ts"));
  g.addNode(fileNode("src/core/health.ts"));
  g.addNode(fileNode("src/cli/index.ts"));
  g.addNode(fileNode("src/cli/explore.ts"));
  g.addNode(fileNode("src/server/index.ts"));
  g.addNode(fileNode("src/server/routes.ts"));

  g.addEdge(importEdge("src/core/health.ts", "src/core/graph.ts"));
  g.addEdge(importEdge("src/cli/index.ts", "src/core/graph.ts"));
  g.addEdge(importEdge("src/cli/index.ts", "src/server/index.ts"));
  g.addEdge(importEdge("src/cli/explore.ts", "src/core/health.ts"));
  g.addEdge(importEdge("src/server/index.ts", "src/core/graph.ts"));
  g.addEdge(importEdge("src/server/routes.ts", "src/server/index.ts"));

  return g;
}

const validBoundaries: Record<string, BoundaryRule> = {
  core: { path: "src/core/**", allow: [] },
  cli: { path: "src/cli/**", allow: ["core", "server"] },
  server: { path: "src/server/**", allow: ["core"] },
};

describe("checkBoundaries", () => {
  it("reports no violations for valid architecture", () => {
    const g = buildLayeredGraph();
    const report = checkBoundaries(g, validBoundaries);

    assert.equal(report.violations.length, 0);
  });

  it("detects violations when a layer imports forbidden boundary", () => {
    const g = buildLayeredGraph();
    g.addEdge(importEdge("src/core/graph.ts", "src/cli/index.ts"));

    const report = checkBoundaries(g, validBoundaries);

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].from, "src/core/graph.ts");
    assert.equal(report.violations[0].to, "src/cli/index.ts");
    assert.equal(report.violations[0].fromBoundary, "core");
    assert.equal(report.violations[0].toBoundary, "cli");
  });

  it("detects multiple violations", () => {
    const g = buildLayeredGraph();
    g.addEdge(importEdge("src/core/graph.ts", "src/cli/index.ts"));
    g.addEdge(importEdge("src/core/health.ts", "src/server/index.ts"));

    const report = checkBoundaries(g, validBoundaries);

    assert.equal(report.violations.length, 2);
  });

  it("allows imports within the same boundary", () => {
    const g = buildLayeredGraph();
    const report = checkBoundaries(g, validBoundaries);

    const coreStat = report.boundaryStats.find((s) => s.name === "core")!;
    assert.equal(coreStat.internalEdges, 1);
    assert.equal(coreStat.violations, 0);
  });

  it("counts files per boundary", () => {
    const g = buildLayeredGraph();
    const report = checkBoundaries(g, validBoundaries);

    const coreStat = report.boundaryStats.find((s) => s.name === "core")!;
    const cliStat = report.boundaryStats.find((s) => s.name === "cli")!;
    const serverStat = report.boundaryStats.find((s) => s.name === "server")!;

    assert.equal(coreStat.files, 2);
    assert.equal(cliStat.files, 2);
    assert.equal(serverStat.files, 2);
  });

  it("identifies unassigned files", () => {
    const g = buildLayeredGraph();
    g.addNode(fileNode("scripts/deploy.ts"));

    const report = checkBoundaries(g, validBoundaries);
    assert.ok(report.unassigned.includes("scripts/deploy.ts"));
  });

  it("counts cross-boundary imports", () => {
    const g = buildLayeredGraph();
    const report = checkBoundaries(g, validBoundaries);

    const cliStat = report.boundaryStats.find((s) => s.name === "cli")!;
    assert.ok(cliStat.externalEdges > 0);
  });

  it("ignores external dependencies", () => {
    const g = buildLayeredGraph();
    g.addEdge({ from: "file:src/core/graph.ts", to: "external:lodash", kind: "imports" });

    const report = checkBoundaries(g, validBoundaries);
    assert.equal(report.violations.length, 0);
  });

  it("handles empty boundaries", () => {
    const g = buildLayeredGraph();
    const report = checkBoundaries(g, {});

    assert.equal(report.violations.length, 0);
    assert.equal(report.boundaryStats.length, 0);
    assert.ok(report.unassigned.length > 0);
  });

  describe("glob matching", () => {
    it("matches ** patterns for nested paths", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/core/deep/nested/file.ts"));
      g.addNode(fileNode("src/cli/index.ts"));
      g.addEdge(importEdge("src/core/deep/nested/file.ts", "src/cli/index.ts"));

      const report = checkBoundaries(g, {
        core: { path: "src/core/**", allow: [] },
        cli: { path: "src/cli/**", allow: [] },
      });

      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].fromBoundary, "core");
    });
  });
});
