import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../../src/core/analyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KOTLIN_PROJECT = resolve(__dirname, "../fixtures/kotlin-project");

describe("Kotlin language support", () => {
  it("scans all Kotlin files in the project", async () => {
    const { graph, stats } = await analyzeProject(KOTLIN_PROJECT);
    assert.ok(stats.filesScanned >= 3, `expected >= 3 Kotlin files, got ${stats.filesScanned}`);
    assert.equal(stats.filesFailed, 0, "no files should fail to parse");
  });

  it("resolves local package imports", async () => {
    const { graph } = await analyzeProject(KOTLIN_PROJECT);

    const appFile = "src/main/kotlin/com/example/App.kt";
    const localDeps = graph
      .getDependencies(`file:${appFile}`)
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const targets = localDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(
      targets.includes("src/main/kotlin/com/example/service/UserService.kt"),
      `App.kt should import UserService — got: ${targets.join(", ")}`,
    );
  });

  it("resolves transitive local dependencies", async () => {
    const { graph } = await analyzeProject(KOTLIN_PROJECT);

    const serviceFile = "src/main/kotlin/com/example/service/UserService.kt";
    const localDeps = graph
      .getDependencies(`file:${serviceFile}`)
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const targets = localDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(
      targets.includes("src/main/kotlin/com/example/model/User.kt"),
      "UserService should import User",
    );
  });

  it("marks Kotlin/Java stdlib imports as external", async () => {
    const { graph } = await analyzeProject(KOTLIN_PROJECT);

    const userFile = "src/main/kotlin/com/example/model/User.kt";
    const externals = graph
      .getDependencies(`file:${userFile}`)
      .filter((e) => e.to.startsWith("external:"));

    assert.ok(externals.length > 0, "User.kt should have external imports");
    const extNames = externals.map((e) => e.to.replace("external:", ""));
    assert.ok(
      extNames.some((n) => n.includes("kotlin.")),
      `expected kotlin.* in externals — got: ${extNames.join(", ")}`,
    );
  });

  it("detects data class exports", async () => {
    const { graph } = await analyzeProject(KOTLIN_PROJECT);

    const userFile = "src/main/kotlin/com/example/model/User.kt";
    const exports = graph.getFileExports(userFile);
    const names = exports.map((e) => e.name);
    assert.ok(names.includes("User"), `User.kt should export User — got: ${names.join(", ")}`);
  });

  it("excludes private classes from exports", async () => {
    const { graph } = await analyzeProject(KOTLIN_PROJECT);

    const userFile = "src/main/kotlin/com/example/model/User.kt";
    const exports = graph.getFileExports(userFile);
    const names = exports.map((e) => e.name);
    assert.ok(!names.includes("InternalHelper"), "private class should not be exported");
  });

  it("detects top-level function exports", async () => {
    const { graph } = await analyzeProject(KOTLIN_PROJECT);

    const appFile = "src/main/kotlin/com/example/App.kt";
    const exports = graph.getFileExports(appFile);
    const names = exports.map((e) => e.name);
    assert.ok(names.includes("main"), `App.kt should export main — got: ${names.join(", ")}`);
  });

  it("computes transitive impact for model changes", async () => {
    const { graph } = await analyzeProject(KOTLIN_PROJECT);

    const userFile = "src/main/kotlin/com/example/model/User.kt";
    const impact = graph.analyzeFileImpact(userFile);
    const affected = impact.affected
      .filter((a) => a.node.kind === "file")
      .map((a) => a.node.filePath);

    assert.ok(
      affected.includes("src/main/kotlin/com/example/service/UserService.kt"),
      "User.kt change should affect UserService",
    );
    assert.ok(
      affected.includes("src/main/kotlin/com/example/App.kt"),
      "User.kt change should transitively affect App",
    );
  });
});
