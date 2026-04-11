import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyzeProject } from "../../src/core/analyzer.js";
import { analyzeOwnership, getFileOwnership } from "../../src/core/owners.js";

const ROOT = resolve(".");

describe("getFileOwnership", () => {
  it("returns ownership data for a known file", () => {
    const result = getFileOwnership(ROOT, "src/core/graph.ts");
    assert.equal(result.file, "src/core/graph.ts");
    assert.ok(result.topAuthors.length >= 1);
    assert.ok(result.totalAuthors >= 1);
    assert.ok(result.busFactor >= 1);
    assert.ok(result.lastAuthor);
  });

  it("author shares sum to approximately 1", () => {
    const result = getFileOwnership(ROOT, "src/core/graph.ts");
    const totalShare = result.topAuthors.reduce((sum, a) => sum + a.share, 0);
    assert.ok(totalShare >= 0.9 && totalShare <= 1.01, `shares sum to ${totalShare}`);
  });

  it("returns empty for nonexistent file", () => {
    const result = getFileOwnership(ROOT, "nonexistent.ts");
    assert.equal(result.topAuthors.length, 0);
    assert.equal(result.busFactor, 0);
  });

  it("sorts authors by commit count descending", () => {
    const result = getFileOwnership(ROOT, "src/core/graph.ts");
    for (let i = 1; i < result.topAuthors.length; i++) {
      assert.ok(result.topAuthors[i].commits <= result.topAuthors[i - 1].commits);
    }
  });
});

describe("analyzeOwnership", () => {
  it("produces a complete report", async () => {
    const { graph } = await analyzeProject(ROOT);
    const report = analyzeOwnership(graph, ROOT, 200);

    assert.ok(report.files.length > 0);
    assert.ok(report.teamSize >= 1);
    assert.ok(report.durationMs >= 0);
    assert.ok(Array.isArray(report.busiestAuthors));
    assert.ok(Array.isArray(report.hotBusFactor));
  });

  it("identifies files with bus factor 1", async () => {
    const { graph } = await analyzeProject(ROOT);
    const report = analyzeOwnership(graph, ROOT, 200);

    const bf1 = report.files.filter((f) => f.busFactor === 1 && f.totalAuthors > 0);
    assert.ok(bf1.length >= 1, "should have at least one single-owner file");
  });

  it("hot bus factor includes blast radius", async () => {
    const { graph } = await analyzeProject(ROOT);
    const report = analyzeOwnership(graph, ROOT, 200);

    for (const f of report.hotBusFactor) {
      assert.equal(f.busFactor, 1);
      assert.ok(f.blastRadius >= 3);
    }
  });

  it("busiest authors are sorted by file count", async () => {
    const { graph } = await analyzeProject(ROOT);
    const report = analyzeOwnership(graph, ROOT, 200);

    for (let i = 1; i < report.busiestAuthors.length; i++) {
      assert.ok(report.busiestAuthors[i].files <= report.busiestAuthors[i - 1].files);
    }
  });
});
