import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import { exportGraph } from "../../src/core/export-graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph-types.js";

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}
function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}
function externalEdge(from: string, pkg: string): GraphEdge {
  return { from: `file:${from}`, to: `external:${pkg}`, kind: "imports" };
}

function buildTestGraph(): DependencyGraph {
  const g = new DependencyGraph();
  g.addNode(fileNode("src/app.ts"));
  g.addNode(fileNode("src/util.ts"));
  g.addNode(fileNode("src/types.ts"));
  g.addEdge(importEdge("src/app.ts", "src/util.ts"));
  g.addEdge(importEdge("src/util.ts", "src/types.ts"));
  g.addEdge(externalEdge("src/app.ts", "express"));
  return g;
}

describe("exportGraph", () => {
  describe("mermaid format", () => {
    it("produces valid mermaid output", () => {
      const g = buildTestGraph();
      const output = exportGraph(g, "mermaid");

      assert.ok(output.startsWith("graph TD"));
      assert.ok(output.includes("src_app_ts"));
      assert.ok(output.includes("src_util_ts"));
      assert.ok(output.includes("-->"));
    });

    it("filters external edges when localOnly", () => {
      const g = buildTestGraph();
      const output = exportGraph(g, "mermaid", true);

      assert.ok(!output.includes("express"));
    });
  });

  describe("dot format", () => {
    it("produces valid dot/graphviz output", () => {
      const g = buildTestGraph();
      const output = exportGraph(g, "dot");

      assert.ok(output.startsWith("digraph impulse {"));
      assert.ok(output.includes("->"));
      assert.ok(output.endsWith("}"));
    });

    it("groups files into subgraph clusters by directory", () => {
      const g = buildTestGraph();
      const output = exportGraph(g, "dot");

      assert.ok(output.includes("subgraph"));
      assert.ok(output.includes("cluster_src"));
    });
  });

  describe("json format", () => {
    it("produces valid JSON with nodes and edges", () => {
      const g = buildTestGraph();
      const output = exportGraph(g, "json");
      const parsed = JSON.parse(output);

      assert.ok(Array.isArray(parsed.nodes));
      assert.ok(Array.isArray(parsed.edges));
      assert.ok(parsed.nodes.length >= 3);
      assert.ok(parsed.edges.length >= 1);
    });

    it("strips file: prefix from node ids", () => {
      const g = buildTestGraph();
      const output = exportGraph(g, "json");
      const parsed = JSON.parse(output);

      const files = parsed.nodes.map((n: { file: string }) => n.file);
      assert.ok(files.includes("src/app.ts"));
      assert.ok(files.every((f: string) => !f.startsWith("file:")));
    });

    it("strips prefixes from edge paths", () => {
      const g = buildTestGraph();
      const output = exportGraph(g, "json", true);
      const parsed = JSON.parse(output);

      for (const edge of parsed.edges) {
        assert.ok(!edge.from.startsWith("file:"), `edge.from should be clean: ${edge.from}`);
        assert.ok(!edge.to.startsWith("file:"), `edge.to should be clean: ${edge.to}`);
      }
    });
  });
});
