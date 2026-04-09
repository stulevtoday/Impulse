import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { analyzeStability } from "../../src/core/stability.js";
import type { BoundaryRule } from "../../src/core/config.js";

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}

function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}

const layeredBoundaries: Record<string, BoundaryRule> = {
  core: { path: "src/core/**", allow: [] },
  cli: { path: "src/cli/**", allow: ["core", "server"] },
  server: { path: "src/server/**", allow: ["core"] },
};

describe("analyzeStability", () => {
  describe("clean layered architecture", () => {
    function buildCleanGraph(): DependencyGraph {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/core/graph.ts"));
      g.addNode(fileNode("src/core/types.ts"));
      g.addNode(fileNode("src/server/index.ts"));
      g.addNode(fileNode("src/cli/index.ts"));
      g.addNode(fileNode("src/cli/explore.ts"));

      g.addEdge(importEdge("src/core/graph.ts", "src/core/types.ts"));
      g.addEdge(importEdge("src/server/index.ts", "src/core/graph.ts"));
      g.addEdge(importEdge("src/cli/index.ts", "src/core/graph.ts"));
      g.addEdge(importEdge("src/cli/index.ts", "src/server/index.ts"));
      g.addEdge(importEdge("src/cli/explore.ts", "src/core/types.ts"));

      return g;
    }

    it("computes instability per module", () => {
      const report = analyzeStability(buildCleanGraph(), layeredBoundaries);
      const byName = new Map(report.modules.map((m) => [m.name, m]));

      const core = byName.get("core")!;
      assert.equal(core.ca, 3);
      assert.equal(core.ce, 0);
      assert.equal(core.instability, 0);

      const cli = byName.get("cli")!;
      assert.equal(cli.ce, 3);
      assert.equal(cli.ca, 0);
      assert.equal(cli.instability, 1);

      const server = byName.get("server")!;
      assert.equal(server.ca, 1);
      assert.equal(server.ce, 1);
      assert.equal(server.instability, 0.5);
    });

    it("counts internal edges", () => {
      const report = analyzeStability(buildCleanGraph(), layeredBoundaries);
      const byName = new Map(report.modules.map((m) => [m.name, m]));

      assert.equal(byName.get("core")!.internalEdges, 1);
      assert.equal(byName.get("cli")!.internalEdges, 0);
      assert.equal(byName.get("server")!.internalEdges, 0);
    });

    it("computes cohesion", () => {
      const report = analyzeStability(buildCleanGraph(), layeredBoundaries);
      const core = report.modules.find((m) => m.name === "core")!;
      assert.equal(core.cohesion, 0.25);
    });

    it("reports no SDP violations for clean layered deps", () => {
      const report = analyzeStability(buildCleanGraph(), layeredBoundaries);
      assert.equal(report.violations.length, 0);
    });

    it("sorts modules by instability ascending", () => {
      const report = analyzeStability(buildCleanGraph(), layeredBoundaries);
      for (let i = 1; i < report.modules.length; i++) {
        assert.ok(report.modules[i].instability >= report.modules[i - 1].instability);
      }
    });
  });

  describe("SDP violation detection", () => {
    it("detects when stable module depends on unstable module", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/core/graph.ts"));
      g.addNode(fileNode("src/cli/index.ts"));

      // core (should be stable) depends on cli (unstable) — SDP violation
      g.addEdge(importEdge("src/core/graph.ts", "src/cli/index.ts"));
      g.addEdge(importEdge("src/cli/index.ts", "src/core/graph.ts"));

      // Add more cli→core edges to make core clearly more stable
      g.addNode(fileNode("src/cli/explore.ts"));
      g.addEdge(importEdge("src/cli/explore.ts", "src/core/graph.ts"));

      const report = analyzeStability(g, layeredBoundaries);
      const byName = new Map(report.modules.map((m) => [m.name, m]));

      assert.ok(byName.get("core")!.instability < byName.get("cli")!.instability);
      assert.ok(report.violations.length > 0);

      const violation = report.violations.find((v) => v.from === "core");
      assert.ok(violation);
      assert.equal(violation.to, "cli");
    });

    it("ignores small instability gaps (within 0.1 threshold)", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/core/a.ts"));
      g.addNode(fileNode("src/server/b.ts"));

      g.addEdge(importEdge("src/core/a.ts", "src/server/b.ts"));
      g.addEdge(importEdge("src/server/b.ts", "src/core/a.ts"));

      const report = analyzeStability(g, {
        core: { path: "src/core/**", allow: [] },
        server: { path: "src/server/**", allow: ["core"] },
      });

      assert.equal(report.violations.length, 0);
    });
  });

  describe("edge cases", () => {
    it("handles empty graph", () => {
      const g = new DependencyGraph();
      const report = analyzeStability(g, layeredBoundaries);

      assert.equal(report.modules.length, 3);
      assert.equal(report.violations.length, 0);
      for (const m of report.modules) {
        assert.equal(m.files, 0);
        assert.equal(m.instability, 0);
      }
    });

    it("handles files not assigned to any boundary", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/core/graph.ts"));
      g.addNode(fileNode("lib/utils.ts"));
      g.addEdge(importEdge("src/core/graph.ts", "lib/utils.ts"));

      const report = analyzeStability(g, layeredBoundaries);
      const core = report.modules.find((m) => m.name === "core")!;
      assert.equal(core.files, 1);
      assert.equal(core.ce, 0);
    });

    it("handles single-module project", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/core/a.ts"));
      g.addNode(fileNode("src/core/b.ts"));
      g.addEdge(importEdge("src/core/a.ts", "src/core/b.ts"));

      const report = analyzeStability(g, { core: { path: "src/core/**", allow: [] } });

      assert.equal(report.modules.length, 1);
      assert.equal(report.modules[0].internalEdges, 1);
      assert.equal(report.modules[0].instability, 0);
      assert.equal(report.violations.length, 0);
    });
  });

  describe("file counts", () => {
    it("counts files per boundary correctly", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/core/a.ts"));
      g.addNode(fileNode("src/core/b.ts"));
      g.addNode(fileNode("src/core/c.ts"));
      g.addNode(fileNode("src/cli/index.ts"));

      const report = analyzeStability(g, layeredBoundaries);
      const byName = new Map(report.modules.map((m) => [m.name, m]));

      assert.equal(byName.get("core")!.files, 3);
      assert.equal(byName.get("cli")!.files, 1);
      assert.equal(byName.get("server")!.files, 0);
    });
  });
});
