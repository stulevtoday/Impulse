import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { findTestTargets, isTestFile } from "../../src/core/test-targets.js";

function node(id: string, filePath: string, kind: "file" | "export" = "file"): GraphNode {
  return { id, filePath, kind, name: filePath };
}
function edge(from: string, to: string, kind: "imports" | "exports" | "uses_export" = "imports"): GraphEdge {
  return { from, to, kind, metadata: {} };
}

describe("isTestFile", () => {
  it("detects .test.ts files", () => {
    assert.ok(isTestFile("src/core/graph.test.ts"));
    assert.ok(isTestFile("test/core/graph.test.ts"));
  });

  it("detects .spec.ts files", () => {
    assert.ok(isTestFile("src/utils.spec.ts"));
  });

  it("detects files in test/ directories", () => {
    assert.ok(isTestFile("test/integration.ts"));
    assert.ok(isTestFile("tests/e2e.ts"));
  });

  it("detects __tests__ directory", () => {
    assert.ok(isTestFile("src/__tests__/graph.ts"));
  });

  it("detects Go test files", () => {
    assert.ok(isTestFile("pkg/graph_test.go"));
  });

  it("detects Python test files", () => {
    assert.ok(isTestFile("tests/test_graph.py"));
    assert.ok(isTestFile("graph_test.py"));
  });

  it("rejects non-test files", () => {
    assert.ok(!isTestFile("src/core/graph.ts"));
    assert.ok(!isTestFile("src/cli/index.ts"));
    assert.ok(!isTestFile("README.md"));
  });
});

describe("findTestTargets", () => {
  it("finds tests that depend on a changed file", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core/graph.ts", "src/core/graph.ts"));
    graph.addNode(node("file:src/core/analyzer.ts", "src/core/analyzer.ts"));
    graph.addNode(node("file:test/core/graph.test.ts", "test/core/graph.test.ts"));
    graph.addEdge(edge("file:src/core/analyzer.ts", "file:src/core/graph.ts"));
    graph.addEdge(edge("file:test/core/graph.test.ts", "file:src/core/graph.ts"));

    const report = findTestTargets(graph, ["src/core/graph.ts"]);

    assert.equal(report.targets.length, 1);
    assert.equal(report.targets[0].testFile, "test/core/graph.test.ts");
    assert.equal(report.targets[0].triggeredBy, "src/core/graph.ts");
    assert.equal(report.targets[0].depth, 1);
  });

  it("finds transitive test dependencies", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/types.ts", "src/types.ts"));
    graph.addNode(node("file:src/graph.ts", "src/graph.ts"));
    graph.addNode(node("file:test/graph.test.ts", "test/graph.test.ts"));
    graph.addEdge(edge("file:src/graph.ts", "file:src/types.ts"));
    graph.addEdge(edge("file:test/graph.test.ts", "file:src/graph.ts"));

    const report = findTestTargets(graph, ["src/types.ts"]);

    assert.equal(report.targets.length, 1);
    assert.equal(report.targets[0].testFile, "test/graph.test.ts");
    assert.equal(report.targets[0].depth, 2);
  });

  it("includes changed test files at depth 0", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:test/foo.test.ts", "test/foo.test.ts"));

    const report = findTestTargets(graph, ["test/foo.test.ts"]);

    assert.equal(report.targets.length, 1);
    assert.equal(report.targets[0].depth, 0);
    assert.equal(report.targets[0].triggeredBy, "test/foo.test.ts");
  });

  it("returns empty when no tests are affected", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/a.ts", "src/a.ts"));
    graph.addNode(node("file:src/b.ts", "src/b.ts"));
    graph.addEdge(edge("file:src/b.ts", "file:src/a.ts"));

    const report = findTestTargets(graph, ["src/a.ts"]);
    assert.equal(report.targets.length, 0);
    assert.equal(report.runCommand, null);
  });

  it("deduplicates tests reachable through multiple paths", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/a.ts", "src/a.ts"));
    graph.addNode(node("file:src/b.ts", "src/b.ts"));
    graph.addNode(node("file:test/ab.test.ts", "test/ab.test.ts"));
    graph.addEdge(edge("file:test/ab.test.ts", "file:src/a.ts"));
    graph.addEdge(edge("file:test/ab.test.ts", "file:src/b.ts"));

    const report = findTestTargets(graph, ["src/a.ts", "src/b.ts"]);
    assert.equal(report.targets.length, 1);
  });

  it("picks the shortest path when multiple paths exist", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/a.ts", "src/a.ts"));
    graph.addNode(node("file:src/b.ts", "src/b.ts"));
    graph.addNode(node("file:test/x.test.ts", "test/x.test.ts"));
    graph.addEdge(edge("file:src/b.ts", "file:src/a.ts"));
    graph.addEdge(edge("file:test/x.test.ts", "file:src/a.ts"));
    graph.addEdge(edge("file:test/x.test.ts", "file:src/b.ts"));

    const report = findTestTargets(graph, ["src/a.ts"]);
    assert.equal(report.targets[0].depth, 1);
  });

  it("generates a node --test run command for TS/JS tests", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core.ts", "src/core.ts"));
    graph.addNode(node("file:test/core.test.ts", "test/core.test.ts"));
    graph.addEdge(edge("file:test/core.test.ts", "file:src/core.ts"));

    const report = findTestTargets(graph, ["src/core.ts"]);
    assert.ok(report.runCommand);
    assert.ok(report.runCommand.includes("node --test"));
    assert.ok(report.runCommand.includes("test/core.test.ts"));
  });

  it("generates a pytest command for Python tests", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/core.py", "src/core.py"));
    graph.addNode(node("file:tests/test_core.py", "tests/test_core.py"));
    graph.addEdge(edge("file:tests/test_core.py", "file:src/core.py"));

    const report = findTestTargets(graph, ["src/core.py"]);
    assert.ok(report.runCommand);
    assert.ok(report.runCommand.startsWith("pytest"));
  });

  it("generates a go test command for Go tests", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:pkg/graph.go", "pkg/graph.go"));
    graph.addNode(node("file:pkg/graph_test.go", "pkg/graph_test.go"));
    graph.addEdge(edge("file:pkg/graph_test.go", "file:pkg/graph.go"));

    const report = findTestTargets(graph, ["pkg/graph.go"]);
    assert.ok(report.runCommand);
    assert.ok(report.runCommand.startsWith("go test"));
  });

  it("handles changed files not in graph gracefully", () => {
    const graph = new DependencyGraph();
    graph.addNode(node("file:src/a.ts", "src/a.ts"));

    const report = findTestTargets(graph, ["nonexistent.ts"]);
    assert.equal(report.targets.length, 0);
  });
});
