import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyzeProject } from "../../src/core/analyzer.js";
import { explainFile, explainProject } from "../../src/core/explain.js";

const ROOT = resolve(".");

describe("explainFile", () => {
  it("explains a hub file with multiple sections", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainFile(graph, "src/core/graph.ts", ROOT);

    assert.equal(result.file, "src/core/graph.ts");
    assert.ok(result.summary.includes("hub") || result.summary.includes("import"));
    assert.ok(result.sections.length >= 2);

    const headings = result.sections.map((s) => s.heading);
    assert.ok(headings.includes("Blast radius"));
    assert.ok(headings.includes("Tests"));
  });

  it("explains a leaf file", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainFile(graph, "src/cli/index.ts", ROOT);

    assert.equal(result.file, "src/cli/index.ts");
    assert.ok(result.summary.length > 0);
  });

  it("handles a file not in the graph", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainFile(graph, "nonexistent.ts", ROOT);

    assert.ok(result.summary.includes("not in the dependency graph"));
    assert.equal(result.sections.length, 0);
  });

  it("includes complexity section for complex files", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainFile(graph, "src/core/graph.ts", ROOT);

    const cx = result.sections.find((s) => s.heading === "Complexity");
    assert.ok(cx, "should have complexity section");
    assert.ok(cx.lines.some((l) => l.includes("cognitive complexity")));
  });

  it("includes blast radius with depth info", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainFile(graph, "src/core/graph.ts", ROOT);

    const blast = result.sections.find((s) => s.heading === "Blast radius");
    assert.ok(blast, "should have blast radius section");
    assert.ok(blast.lines.some((l) => l.includes("% of the codebase")));
  });

  it("returns JSON-serializable output", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainFile(graph, "src/core/graph.ts", ROOT);

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    assert.equal(parsed.file, "src/core/graph.ts");
    assert.ok(Array.isArray(parsed.sections));
  });
});

describe("explainProject", () => {
  it("produces a project summary with sections", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainProject(graph, ROOT);

    assert.ok(result.summary.includes("files"));
    assert.ok(result.summary.includes("health"));
    assert.ok(result.sections.length >= 2);
  });

  it("includes core files section", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainProject(graph, ROOT);

    const core = result.sections.find((s) => s.heading === "Core");
    assert.ok(core, "should have Core section");
    assert.ok(core.lines.some((l) => l.includes("heart")));
  });

  it("includes actionable next steps", async () => {
    const { graph } = await analyzeProject(ROOT);
    const result = await explainProject(graph, ROOT);

    const next = result.sections.find((s) => s.heading === "What to do next");
    assert.ok(next, "should have next steps");
    assert.ok(next.lines.length > 0);
  });
});
