import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DependencyGraph } from "../../src/core/graph.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph.js";
import { analyzeDeps } from "../../src/core/deps.js";

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
  locals: Array<[string, string]>,
  externals: Array<[string, string]>,
): DependencyGraph {
  const g = new DependencyGraph();
  for (const f of files) g.addNode(fileNode(f));
  for (const [from, to] of locals) g.addEdge(importEdge(from, to));
  for (const [from, pkg] of externals) g.addEdge(externalEdge(from, pkg));
  return g;
}

describe("analyzeDeps", () => {
  it("finds all external dependencies with usage counts", async () => {
    const g = buildGraph(
      ["a.ts", "b.ts", "c.ts"],
      [["a.ts", "b.ts"]],
      [["a.ts", "lodash"], ["b.ts", "lodash"], ["c.ts", "express"]],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    assert.equal(report.dependencies.length, 2);

    const lodash = report.dependencies.find((d) => d.name === "lodash")!;
    assert.ok(lodash);
    assert.equal(lodash.usageCount, 2);
    assert.equal(lodash.category, "package");

    const express = report.dependencies.find((d) => d.name === "express")!;
    assert.ok(express);
    assert.equal(express.usageCount, 1);
  });

  it("categorizes node builtins correctly", async () => {
    const g = buildGraph(
      ["a.ts"],
      [],
      [["a.ts", "node:fs"], ["a.ts", "node:path"]],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    for (const dep of report.dependencies) {
      assert.equal(dep.category, "builtin", `${dep.name} should be builtin`);
    }
  });

  it("categorizes java stdlib as builtin", async () => {
    const g = buildGraph(
      ["App.java"],
      [],
      [["App.java", "java.util.List"], ["App.java", "javax.servlet.http"]],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    for (const dep of report.dependencies) {
      assert.equal(dep.category, "builtin", `${dep.name} should be builtin`);
    }
  });

  it("calculates penetration correctly", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
    const g = buildGraph(
      files,
      [],
      [
        ["a.ts", "react"], ["b.ts", "react"], ["c.ts", "react"],
        ["d.ts", "react"], ["e.ts", "react"],
      ],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    const react = report.dependencies.find((d) => d.name === "react")!;
    assert.equal(react.penetration, 100);
    assert.equal(react.risk, "critical");
  });

  it("classifies risk based on penetration", async () => {
    const files: string[] = [];
    const externals: Array<[string, string]> = [];

    for (let i = 0; i < 100; i++) {
      files.push(`f${i}.ts`);
    }

    for (let i = 0; i < 50; i++) externals.push([`f${i}.ts`, "lodash"]);
    for (let i = 0; i < 25; i++) externals.push([`f${i}.ts`, "express"]);
    for (let i = 0; i < 8; i++) externals.push([`f${i}.ts`, "chalk"]);
    externals.push(["f0.ts", "tiny-lib"]);

    const g = buildGraph(files, [], externals);
    const report = await analyzeDeps(g, "/nonexistent");

    const lodash = report.dependencies.find((d) => d.name === "lodash")!;
    assert.equal(lodash.risk, "critical");

    const express = report.dependencies.find((d) => d.name === "express")!;
    assert.equal(express.risk, "high");

    const chalk = report.dependencies.find((d) => d.name === "chalk")!;
    assert.equal(chalk.risk, "medium");

    const tiny = report.dependencies.find((d) => d.name === "tiny-lib")!;
    assert.equal(tiny.risk, "low");
  });

  it("identifies top-heavy dependencies", async () => {
    const files: string[] = [];
    const externals: Array<[string, string]> = [];
    for (let i = 0; i < 10; i++) {
      files.push(`f${i}.ts`);
      externals.push([`f${i}.ts`, "core-lib"]);
    }

    const g = buildGraph(files, [], externals);
    const report = await analyzeDeps(g, "/nonexistent");

    assert.ok(report.topHeavy.length > 0);
    assert.equal(report.topHeavy[0].name, "core-lib");
  });

  it("identifies surface deps (used by only 1 file)", async () => {
    const g = buildGraph(
      ["a.ts", "b.ts", "c.ts"],
      [],
      [["a.ts", "lodash"], ["a.ts", "express"], ["b.ts", "tiny-lib"]],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    assert.ok(report.surfaceDeps.some((d) => d.name === "tiny-lib"));
  });

  it("sorts dependencies by usage count descending", async () => {
    const g = buildGraph(
      ["a.ts", "b.ts", "c.ts"],
      [],
      [
        ["a.ts", "less-used"], ["a.ts", "most-used"], ["b.ts", "most-used"],
        ["c.ts", "most-used"],
      ],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    assert.equal(report.dependencies[0].name, "most-used");
    assert.ok(report.dependencies[0].usageCount >= report.dependencies[1].usageCount);
  });

  it("handles empty graph", async () => {
    const g = new DependencyGraph();
    const report = await analyzeDeps(g, "/nonexistent");
    assert.equal(report.dependencies.length, 0);
    assert.equal(report.totalFiles, 0);
    assert.equal(report.totalPackages, 0);
  });

  it("handles graph with no external deps", async () => {
    const g = buildGraph(
      ["a.ts", "b.ts"],
      [["a.ts", "b.ts"]],
      [],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    assert.equal(report.dependencies.length, 0);
    assert.equal(report.totalFiles, 2);
  });

  it("builds correct cluster statistics", async () => {
    const g = buildGraph(
      ["a.ts", "b.ts"],
      [],
      [["a.ts", "node:fs"], ["a.ts", "lodash"], ["b.ts", "express"]],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    assert.ok(report.clusters.length >= 1);

    const builtinCluster = report.clusters.find((c) => c.category === "builtin");
    const pkgCluster = report.clusters.find((c) => c.category === "package");
    assert.ok(builtinCluster);
    assert.ok(pkgCluster);
    assert.equal(builtinCluster.count, 1);
    assert.equal(pkgCluster.count, 2);
  });

  it("tracks usedBy file paths correctly", async () => {
    const g = buildGraph(
      ["src/app.ts", "src/lib.ts"],
      [],
      [["src/app.ts", "react"], ["src/lib.ts", "react"]],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    const react = report.dependencies.find((d) => d.name === "react")!;
    assert.deepEqual(react.usedBy, ["src/app.ts", "src/lib.ts"]);
  });

  it("categorizes system/local path imports as system", async () => {
    const g = buildGraph(
      ["main.c"],
      [],
      [["main.c", "include/user.h"]],
    );

    const report = await analyzeDeps(g, "/nonexistent");
    const dep = report.dependencies.find((d) => d.name === "include/user.h")!;
    assert.equal(dep.category, "system");
  });
});
