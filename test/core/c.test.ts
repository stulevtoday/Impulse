import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyzeProject } from "../../src/core/analyzer.js";
import { computeFileComplexity } from "../../src/core/complexity.js";
import { parseFile } from "../../src/core/parser.js";

const ROOT = resolve(import.meta.dirname, "../fixtures/c-project");

describe("C language support", () => {
  it("scans all C files in the project", async () => {
    const { stats } = await analyzeProject(ROOT);
    assert.ok(stats.filesScanned >= 5, `Expected at least 5 files (3 .c + 2 .h), got ${stats.filesScanned}`);
  });

  it("resolves local #include directives", async () => {
    const { graph } = await analyzeProject(ROOT);
    const mainDeps = graph.getDependencies("file:src/main.c")
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const targets = mainDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(targets.includes("include/user.h"), `main.c should include user.h, got: ${targets}`);
  });

  it("marks system includes as external", async () => {
    const { graph } = await analyzeProject(ROOT);
    const mainDeps = graph.getDependencies("file:src/main.c")
      .filter((e) => e.to.startsWith("external:"));

    const externals = mainDeps.map((e) => e.to.replace("external:", ""));
    assert.ok(externals.includes("stdlib.h"), `main.c should have external stdlib.h, got: ${externals}`);
  });

  it("resolves transitive #include chains", async () => {
    const { graph } = await analyzeProject(ROOT);
    const userDeps = graph.getDependencies("file:src/user.c")
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"))
      .map((e) => e.to.replace("file:", ""));

    assert.ok(userDeps.includes("include/user.h"), "user.c should include user.h");
    assert.ok(userDeps.includes("include/utils.h"), "user.c should include utils.h");
  });

  it("detects function exports", async () => {
    const { graph } = await analyzeProject(ROOT);
    const exports = graph.getDeclaredExports("src/user.c");
    const names = exports.map((e) => e.name);
    assert.ok(names.includes("create_user"), `Should export create_user, got: ${names}`);
    assert.ok(names.includes("print_user"), `Should export print_user, got: ${names}`);
  });

  it("detects typedef exports in headers", async () => {
    const { graph } = await analyzeProject(ROOT);
    const exports = graph.getDeclaredExports("include/user.h");
    const names = exports.map((e) => e.name);
    assert.ok(names.includes("User"), `Header should export User typedef, got: ${names}`);
  });

  it("computes impact from header changes", async () => {
    const { graph } = await analyzeProject(ROOT);
    const impact = graph.analyzeFileImpact("include/user.h");
    const affected = impact.affected.filter((a) => a.node.kind === "file").map((a) => a.node.filePath);
    assert.ok(affected.length >= 1, `Changing user.h should affect at least 1 file, got: ${affected}`);
  });

  it("computes complexity for C functions", async () => {
    const parsed = await parseFile(resolve(import.meta.dirname, "../.."), "test/fixtures/c-project/src/utils.c");
    assert.ok(parsed, "Should parse utils.c");
    const fns = computeFileComplexity(parsed!);
    assert.ok(fns.length >= 2, `Should find at least 2 functions, got ${fns.length}`);

    const names = fns.map((f) => f.name);
    assert.ok(names.includes("string_length"), "Should find string_length");
    assert.ok(names.includes("string_copy"), "Should find string_copy");

    for (const fn of fns) {
      assert.ok(fn.cyclomatic >= 1, `${fn.name} should have cyclomatic >= 1`);
    }
  });
});
