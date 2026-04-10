import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../../src/core/analyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PHP_PROJECT = resolve(__dirname, "../fixtures/php-project");

describe("PHP language support", () => {
  it("scans all PHP files in the project", async () => {
    const { graph, stats } = await analyzeProject(PHP_PROJECT);
    assert.ok(stats.filesScanned >= 3, `expected >= 3 PHP files, got ${stats.filesScanned}`);
    assert.equal(stats.filesFailed, 0, "no files should fail to parse");
  });

  it("resolves local namespace imports via PSR-4", async () => {
    const { graph } = await analyzeProject(PHP_PROJECT);

    const controllerFile = "src/Http/Controllers/UserController.php";
    const localDeps = graph
      .getDependencies(`file:${controllerFile}`)
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const targets = localDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(
      targets.includes("src/Services/UserService.php"),
      `UserController should import UserService — got: ${targets.join(", ")}`,
    );
    assert.ok(
      targets.includes("src/Models/User.php"),
      `UserController should import User — got: ${targets.join(", ")}`,
    );
  });

  it("resolves transitive local dependencies", async () => {
    const { graph } = await analyzeProject(PHP_PROJECT);

    const serviceFile = "src/Services/UserService.php";
    const localDeps = graph
      .getDependencies(`file:${serviceFile}`)
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const targets = localDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(
      targets.includes("src/Models/User.php"),
      "UserService should import User",
    );
  });

  it("marks framework imports as external", async () => {
    const { graph } = await analyzeProject(PHP_PROJECT);

    const userFile = "src/Models/User.php";
    const externals = graph
      .getDependencies(`file:${userFile}`)
      .filter((e) => e.to.startsWith("external:"));

    assert.ok(externals.length > 0, "User.php should have external imports");
    const extNames = externals.map((e) => e.to.replace("external:", ""));
    assert.ok(
      extNames.some((n) => n.includes("Illuminate")),
      `expected Illuminate\\* in externals — got: ${extNames.join(", ")}`,
    );
  });

  it("detects class exports", async () => {
    const { graph } = await analyzeProject(PHP_PROJECT);

    const userFile = "src/Models/User.php";
    const exports = graph.getFileExports(userFile);
    const names = exports.map((e) => e.name);
    assert.ok(names.includes("User"), `User.php should export User — got: ${names.join(", ")}`);
  });

  it("tracks export usage (uses_export edges)", async () => {
    const { graph } = await analyzeProject(PHP_PROJECT);

    const userFile = "src/Models/User.php";
    const exportId = `export:${userFile}:User`;
    const users = graph
      .allEdges()
      .filter((e) => e.to === exportId && e.kind === "uses_export");

    assert.ok(users.length >= 2, `User export should be used by >= 2 files — got ${users.length}`);
  });

  it("computes transitive impact for model changes", async () => {
    const { graph } = await analyzeProject(PHP_PROJECT);

    const userFile = "src/Models/User.php";
    const impact = graph.analyzeFileImpact(userFile);
    const affected = impact.affected
      .filter((a) => a.node.kind === "file")
      .map((a) => a.node.filePath);

    assert.ok(
      affected.includes("src/Services/UserService.php"),
      "User.php change should affect UserService",
    );
    assert.ok(
      affected.includes("src/Http/Controllers/UserController.php"),
      "User.php change should transitively affect UserController",
    );
  });
});
