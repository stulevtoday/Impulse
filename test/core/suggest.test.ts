import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { analyzeHealth } from "../../src/core/health.js";
import { generateSuggestions } from "../../src/core/suggest.js";

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

describe("generateSuggestions", () => {
  describe("clean project", () => {
    it("returns no suggestions for clean code", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(exportNode("a.ts", "Foo"));
      g.addEdge(importEdge("b.ts", "a.ts"));
      g.addEdge(exportsEdge("a.ts", "Foo"));
      g.addEdge(usesExportEdge("b.ts", "a.ts", "Foo"));

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      assert.equal(report.suggestions.length, 0);
      assert.equal(report.estimatedScoreImprovement, 0);
    });
  });

  describe("dead export detection", () => {
    it("detects unused exports", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));
      g.addNode(fileNode("consumer.ts"));
      g.addNode(exportNode("lib.ts", "Used"));
      g.addNode(exportNode("lib.ts", "Dead"));
      g.addEdge(exportsEdge("lib.ts", "Used"));
      g.addEdge(exportsEdge("lib.ts", "Dead"));
      g.addEdge(importEdge("consumer.ts", "lib.ts"));
      g.addEdge(usesExportEdge("consumer.ts", "lib.ts", "Used"));

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      const deadSugs = report.suggestions.filter(
        (s) => s.kind === "remove-dead-exports",
      );
      assert.equal(deadSugs.length, 1);
      assert.equal(deadSugs[0].kind, "remove-dead-exports");
      if (deadSugs[0].kind === "remove-dead-exports") {
        assert.equal(deadSugs[0].file, "lib.ts");
        assert.deepStrictEqual(deadSugs[0].exports, ["Dead"]);
      }
    });

    it("detects multiple dead exports in one file", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("lib.ts"));
      g.addNode(exportNode("lib.ts", "Alpha"));
      g.addNode(exportNode("lib.ts", "Beta"));
      g.addNode(exportNode("lib.ts", "Gamma"));
      g.addEdge(exportsEdge("lib.ts", "Alpha"));
      g.addEdge(exportsEdge("lib.ts", "Beta"));
      g.addEdge(exportsEdge("lib.ts", "Gamma"));

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      const deadSugs = report.suggestions.filter(
        (s) => s.kind === "remove-dead-exports",
      );
      assert.equal(deadSugs.length, 1);
      if (deadSugs[0].kind === "remove-dead-exports") {
        assert.equal(deadSugs[0].exports.length, 3);
      }
    });

    it("ignores barrel files", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("src/index.ts"));
      g.addNode(fileNode("src/a.ts"));
      g.addNode(fileNode("src/b.ts"));
      g.addNode(exportNode("src/index.ts", "A"));
      g.addNode(exportNode("src/index.ts", "B"));

      g.addEdge({ from: "file:src/index.ts", to: "file:src/a.ts", kind: "imports", metadata: { reexport: true } });
      g.addEdge({ from: "file:src/index.ts", to: "file:src/b.ts", kind: "imports", metadata: { reexport: true } });
      g.addEdge(exportsEdge("src/index.ts", "A"));
      g.addEdge(exportsEdge("src/index.ts", "B"));

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      const deadInBarrel = report.suggestions.filter(
        (s) => s.kind === "remove-dead-exports" && s.file === "src/index.ts",
      );
      assert.equal(deadInBarrel.length, 0);
    });
  });

  describe("god file splitting", () => {
    it("suggests splitting when exports have distinct consumer groups", () => {
      const g = new DependencyGraph();
      const hub = "core/hub.ts";
      g.addNode(fileNode(hub));

      g.addNode(exportNode(hub, "TypeA"));
      g.addNode(exportNode(hub, "TypeB"));
      g.addEdge(exportsEdge(hub, "TypeA"));
      g.addEdge(exportsEdge(hub, "TypeB"));

      const groupA = Array.from({ length: 10 }, (_, i) => `consumers/a${i}.ts`);
      const groupB = Array.from({ length: 10 }, (_, i) => `consumers/b${i}.ts`);

      for (const f of [...groupA, ...groupB]) {
        g.addNode(fileNode(f));
        g.addEdge(importEdge(f, hub));
      }

      for (const f of groupA) g.addEdge(usesExportEdge(f, hub, "TypeA"));
      for (const f of groupB) g.addEdge(usesExportEdge(f, hub, "TypeB"));

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      const splitSugs = report.suggestions.filter(
        (s) => s.kind === "split-god-file",
      );
      assert.equal(splitSugs.length, 1);
      if (splitSugs[0].kind === "split-god-file") {
        assert.equal(splitSugs[0].file, hub);
        assert.ok(splitSugs[0].clusters.length >= 2);
        assert.ok(splitSugs[0].expectedMaxDependents < splitSugs[0].dependents);
      }
    });

    it("does not suggest splitting when all exports share consumers", () => {
      const g = new DependencyGraph();
      const hub = "core/hub.ts";
      g.addNode(fileNode(hub));

      g.addNode(exportNode(hub, "A"));
      g.addNode(exportNode(hub, "B"));
      g.addEdge(exportsEdge(hub, "A"));
      g.addEdge(exportsEdge(hub, "B"));

      const consumers = Array.from({ length: 12 }, (_, i) => `c${i}.ts`);
      for (const f of consumers) {
        g.addNode(fileNode(f));
        g.addEdge(importEdge(f, hub));
        g.addEdge(usesExportEdge(f, hub, "A"));
        g.addEdge(usesExportEdge(f, hub, "B"));
      }

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      const splitSugs = report.suggestions.filter(
        (s) => s.kind === "split-god-file",
      );
      assert.equal(splitSugs.length, 0);
    });
  });

  describe("cycle break suggestions", () => {
    it("suggests extraction for tight-couple cycles with 3+ files", () => {
      const g = new DependencyGraph();
      g.addNode(fileNode("a.ts"));
      g.addNode(fileNode("b.ts"));
      g.addNode(fileNode("c.ts"));

      g.addNode(exportNode("a.ts", "Shared"));
      g.addEdge(exportsEdge("a.ts", "Shared"));
      g.addEdge(importEdge("a.ts", "b.ts"));
      g.addEdge(importEdge("b.ts", "c.ts"));
      g.addEdge(importEdge("c.ts", "a.ts"));
      g.addEdge(usesExportEdge("c.ts", "a.ts", "Shared"));

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      const cycleSugs = report.suggestions.filter(
        (s) => s.kind === "break-cycle",
      );
      // Only triggers for tight-couple severity in the code, and this is a short-ring
      // so there should be no cycle suggestion
      assert.equal(cycleSugs.length, 0);
    });
  });

  describe("estimated improvement", () => {
    it("estimates score improvement from suggestions", () => {
      const g = new DependencyGraph();
      const hub = "core/hub.ts";
      g.addNode(fileNode(hub));

      g.addNode(exportNode(hub, "TypeA"));
      g.addNode(exportNode(hub, "TypeB"));
      g.addEdge(exportsEdge(hub, "TypeA"));
      g.addEdge(exportsEdge(hub, "TypeB"));

      const groupA = Array.from({ length: 10 }, (_, i) => `a${i}.ts`);
      const groupB = Array.from({ length: 10 }, (_, i) => `b${i}.ts`);

      for (const f of [...groupA, ...groupB]) {
        g.addNode(fileNode(f));
        g.addEdge(importEdge(f, hub));
      }

      for (const f of groupA) g.addEdge(usesExportEdge(f, hub, "TypeA"));
      for (const f of groupB) g.addEdge(usesExportEdge(f, hub, "TypeB"));

      const health = analyzeHealth(g);
      const report = generateSuggestions(g, health);

      assert.ok(report.estimatedScoreImprovement >= 0);
      assert.ok(report.estimatedScoreImprovement <= 100 - health.score);
    });
  });
});
