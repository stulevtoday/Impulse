import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";

function fileNode(path: string): GraphNode {
  return { id: `file:${path}`, kind: "file", filePath: path, name: path };
}

function exportNode(filePath: string, name: string): GraphNode {
  return {
    id: `export:${filePath}:${name}`,
    kind: "export",
    filePath,
    name,
  };
}

function importEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, kind: "imports" };
}

function exportsEdge(filePath: string, name: string): GraphEdge {
  return {
    from: `file:${filePath}`,
    to: `export:${filePath}:${name}`,
    kind: "exports",
  };
}

function usesExportEdge(consumer: string, filePath: string, name: string): GraphEdge {
  return {
    from: `file:${consumer}`,
    to: `export:${filePath}:${name}`,
    kind: "uses_export",
  };
}

describe("DependencyGraph", () => {
  describe("node operations", () => {
    it("adds and retrieves nodes", () => {
      const g = new DependencyGraph();
      const node = fileNode("a.ts");
      g.addNode(node);

      assert.deepStrictEqual(g.getNode("file:a.ts"), node);
      assert.equal(g.allNodes().length, 1);
    });

    it("returns undefined for missing nodes", () => {
      const g = new DependencyGraph();
      assert.equal(g.getNode("file:nope"), undefined);
    });

    it("overwrites nodes with same id", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode({ id: "file:a.ts", kind: "file", filePath: "a.ts", name: "renamed" });

      assert.equal(g.getNode("file:a.ts")!.name, "renamed");
      assert.equal(g.allNodes().length, 1);
    });

    it("getNodesByFile returns all nodes for a file", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(exportNode("a.ts", "Foo"));
      g.addNode(exportNode("a.ts", "Bar"));
      g.addNode(fileNode("b.ts"));

      const nodes = g.getNodesByFile("a.ts");
      assert.equal(nodes.length, 3);
    });
  });

  describe("edge operations", () => {
    it("adds edges and retrieves forward/reverse", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addEdge(importEdge("a.ts", "b.ts"));

      const deps = g.getDependencies("file:a.ts");
      assert.equal(deps.length, 1);
      assert.equal(deps[0].to, "file:b.ts");

      const dependents = g.getDependents("file:b.ts");
      assert.equal(dependents.length, 1);
      assert.equal(dependents[0].from, "file:a.ts");
    });

    it("returns empty arrays for nodes with no edges", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));

      assert.deepStrictEqual(g.getDependencies("file:a.ts"), []);
      assert.deepStrictEqual(g.getDependents("file:a.ts"), []);
    });
  });

  describe("removeNode", () => {
    it("removes node and all associated edges", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(fileNode("c.ts"));
      g.addEdge(importEdge("a.ts", "b.ts"));
      g.addEdge(importEdge("b.ts", "c.ts"));

      g.removeNode("file:b.ts");

      assert.equal(g.getNode("file:b.ts"), undefined);
      assert.equal(g.getDependencies("file:a.ts").length, 0);
      assert.equal(g.getDependents("file:c.ts").length, 0);
    });
  });

  describe("removeFileOutgoing", () => {
    it("preserves incoming edges from other files", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(fileNode("c.ts"));
      g.addEdge(importEdge("a.ts", "b.ts"));
      g.addEdge(importEdge("b.ts", "c.ts"));

      g.removeFileOutgoing("b.ts");

      // a.ts → b.ts edge should still exist (incoming to b)
      const aDeps = g.getDependencies("file:a.ts");
      assert.equal(aDeps.length, 1);
      assert.equal(aDeps[0].to, "file:b.ts");

      // b.ts → c.ts edge should be gone (outgoing from b)
      assert.equal(g.getDependents("file:c.ts").length, 0);
    });

    it("removes owned export nodes", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(exportNode("a.ts", "Foo"));
      g.addEdge(exportsEdge("a.ts", "Foo"));

      g.removeFileOutgoing("a.ts");

      assert.equal(g.getNode("export:a.ts:Foo"), undefined);
    });
  });

  describe("analyzeImpact (BFS)", () => {
    it("finds direct dependents", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addEdge(importEdge("b.ts", "a.ts"));

      const result = g.analyzeImpact("file:a.ts");
      assert.equal(result.affected.length, 1);
      assert.equal(result.affected[0].node.filePath, "b.ts");
      assert.equal(result.affected[0].depth, 1);
    });

    it("finds transitive dependents", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(fileNode("c.ts"));
      g.addEdge(importEdge("b.ts", "a.ts"));
      g.addEdge(importEdge("c.ts", "b.ts"));

      const result = g.analyzeImpact("file:a.ts");
      assert.equal(result.affected.length, 2);

      const byDepth = result.affected.sort((a, b) => a.depth - b.depth);
      assert.equal(byDepth[0].node.filePath, "b.ts");
      assert.equal(byDepth[0].depth, 1);
      assert.equal(byDepth[1].node.filePath, "c.ts");
      assert.equal(byDepth[1].depth, 2);
    });

    it("respects maxDepth", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(fileNode("c.ts"));
      g.addNode(fileNode("d.ts"));
      g.addEdge(importEdge("b.ts", "a.ts"));
      g.addEdge(importEdge("c.ts", "b.ts"));
      g.addEdge(importEdge("d.ts", "c.ts"));

      // maxDepth=N processes nodes up to depth N, which discovers children at N+1
      const result = g.analyzeImpact("file:a.ts", 1);
      const filePaths = result.affected.map((a) => a.node.filePath);
      assert.ok(filePaths.includes("b.ts"));
      assert.ok(filePaths.includes("c.ts"));
      assert.ok(!filePaths.includes("d.ts"));
    });

    it("handles cycles without infinite loop", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addEdge(importEdge("a.ts", "b.ts"));
      g.addEdge(importEdge("b.ts", "a.ts"));

      const result = g.analyzeImpact("file:a.ts");
      assert.equal(result.affected.length, 1);
      assert.equal(result.affected[0].node.filePath, "b.ts");
    });

    it("returns empty for leaf nodes", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));

      const result = g.analyzeImpact("file:a.ts");
      assert.equal(result.affected.length, 0);
    });
  });

  describe("analyzeFileImpact", () => {
    it("merges impact from file node and its export nodes", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));
      g.addNode(fileNode("consumer.ts"));
      g.addNode(exportNode("lib.ts", "Foo"));
      g.addEdge(importEdge("consumer.ts", "lib.ts"));
      g.addEdge(exportsEdge("lib.ts", "Foo"));
      g.addEdge(usesExportEdge("consumer.ts", "lib.ts", "Foo"));

      const result = g.analyzeFileImpact("lib.ts");
      const filePaths = result.affected
        .filter((a) => a.node.kind === "file")
        .map((a) => a.node.filePath);
      assert.ok(filePaths.includes("consumer.ts"));
    });
  });

  describe("analyzeExportImpact (symbol-level)", () => {
    it("traces only consumers of a specific export", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));
      g.addNode(fileNode("uses-foo.ts"));
      g.addNode(fileNode("uses-bar.ts"));
      g.addNode(exportNode("lib.ts", "Foo"));
      g.addNode(exportNode("lib.ts", "Bar"));
      g.addEdge(exportsEdge("lib.ts", "Foo"));
      g.addEdge(exportsEdge("lib.ts", "Bar"));
      g.addEdge(importEdge("uses-foo.ts", "lib.ts"));
      g.addEdge(importEdge("uses-bar.ts", "lib.ts"));
      g.addEdge(usesExportEdge("uses-foo.ts", "lib.ts", "Foo"));
      g.addEdge(usesExportEdge("uses-bar.ts", "lib.ts", "Bar"));

      const fooImpact = g.analyzeExportImpact("lib.ts", "Foo");
      const files = fooImpact.affected.filter((a) => a.node.kind === "file");
      assert.equal(files.length, 1);
      assert.equal(files[0].node.filePath, "uses-foo.ts");
    });

    it("follows re-exports through barrel files", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));
      g.addNode(fileNode("index.ts"));
      g.addNode(fileNode("consumer.ts"));

      g.addNode(exportNode("lib.ts", "Foo"));
      g.addNode(exportNode("index.ts", "Foo"));

      g.addEdge(exportsEdge("lib.ts", "Foo"));
      g.addEdge(exportsEdge("index.ts", "Foo"));
      g.addEdge(importEdge("index.ts", "lib.ts"));
      g.addEdge(importEdge("consumer.ts", "index.ts"));

      g.addEdge(usesExportEdge("index.ts", "lib.ts", "Foo"));
      g.addEdge(usesExportEdge("consumer.ts", "index.ts", "Foo"));

      const result = g.analyzeExportImpact("lib.ts", "Foo");
      const files = result.affected.filter((a) => a.node.kind === "file");
      assert.equal(files.length, 2);

      const paths = files.map((f) => f.node.filePath).sort();
      assert.deepStrictEqual(paths, ["consumer.ts", "index.ts"]);
    });

    it("returns empty for nonexistent export", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));

      const result = g.analyzeExportImpact("lib.ts", "NoSuchExport");
      assert.equal(result.affected.length, 0);
    });
  });

  describe("analyzeExportsImpact (multi-symbol)", () => {
    it("merges impact from multiple exports", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(exportNode("lib.ts", "Foo"));
      g.addNode(exportNode("lib.ts", "Bar"));
      g.addEdge(exportsEdge("lib.ts", "Foo"));
      g.addEdge(exportsEdge("lib.ts", "Bar"));
      g.addEdge(importEdge("a.ts", "lib.ts"));
      g.addEdge(importEdge("b.ts", "lib.ts"));
      g.addEdge(usesExportEdge("a.ts", "lib.ts", "Foo"));
      g.addEdge(usesExportEdge("b.ts", "lib.ts", "Bar"));

      const { merged, perSymbol } = g.analyzeExportsImpact("lib.ts", ["Foo", "Bar"]);
      assert.equal(merged.affected.filter((a) => a.node.kind === "file").length, 2);
      assert.equal(perSymbol.size, 2);
    });
  });

  describe("getDeclaredExports vs getFileExports", () => {
    it("getDeclaredExports only returns exports with 'exports' edge", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));
      g.addNode(fileNode("consumer.ts"));
      g.addNode(exportNode("lib.ts", "Real"));
      g.addNode(exportNode("lib.ts", "Phantom"));

      g.addEdge(exportsEdge("lib.ts", "Real"));
      // Phantom has no exports edge — created by importer
      g.addEdge(usesExportEdge("consumer.ts", "lib.ts", "Phantom"));

      const declared = g.getDeclaredExports("lib.ts");
      assert.equal(declared.length, 1);
      assert.equal(declared[0].name, "Real");

      const all = g.getFileExports("lib.ts");
      assert.equal(all.length, 2);
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trips nodes and edges", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addEdge(importEdge("a.ts", "b.ts"));

      const serialized = g.serialize();
      const restored = DependencyGraph.deserialize(serialized);

      assert.equal(restored.allNodes().length, 2);
      assert.equal(restored.allEdges().length, 1);
      assert.equal(restored.getDependencies("file:a.ts").length, 1);
      assert.equal(restored.getDependents("file:b.ts").length, 1);
    });

    it("preserves node properties", () => {
      const g = new DependencyGraph();
      const node: GraphNode = {
        id: "file:x.ts",
        kind: "file",
        filePath: "x.ts",
        name: "x.ts",
        line: 42,
        metadata: { foo: "bar" },
      };
      g.addNode(node);

      const restored = DependencyGraph.deserialize(g.serialize());
      const n = restored.getNode("file:x.ts")!;
      assert.equal(n.line, 42);
      assert.deepStrictEqual(n.metadata, { foo: "bar" });
    });
  });

  describe("stats", () => {
    it("counts nodes, edges, files, exports", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(exportNode("a.ts", "Foo"));
      g.addEdge(importEdge("a.ts", "b.ts"));
      g.addEdge(exportsEdge("a.ts", "Foo"));

      const s = g.stats;
      assert.equal(s.nodes, 3);
      assert.equal(s.edges, 2);
      assert.equal(s.files, 2);
      assert.equal(s.exports, 1);
    });
  });
});
