import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../../src/core/analyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JAVA_PROJECT = resolve(__dirname, "../fixtures/java-project");

describe("Java language support", () => {
  it("scans all Java files in the project", async () => {
    const { graph, stats } = await analyzeProject(JAVA_PROJECT);
    assert.ok(stats.filesScanned >= 4, `expected >= 4 Java files, got ${stats.filesScanned}`);
    assert.equal(stats.filesFailed, 0, "no files should fail to parse");
  });

  it("resolves local package imports", async () => {
    const { graph } = await analyzeProject(JAVA_PROJECT);

    const appFile = "src/main/java/com/example/App.java";
    const localDeps = graph
      .getDependencies(`file:${appFile}`)
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const targets = localDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(
      targets.includes("src/main/java/com/example/service/UserService.java"),
      `App.java should import UserService — got: ${targets.join(", ")}`,
    );
  });

  it("resolves transitive local dependencies", async () => {
    const { graph } = await analyzeProject(JAVA_PROJECT);

    const serviceFile = "src/main/java/com/example/service/UserService.java";
    const localDeps = graph
      .getDependencies(`file:${serviceFile}`)
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const targets = localDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(
      targets.includes("src/main/java/com/example/model/User.java"),
      "UserService should import User",
    );
    assert.ok(
      targets.includes("src/main/java/com/example/repository/UserRepository.java"),
      "UserService should import UserRepository",
    );
  });

  it("marks Java stdlib imports as external", async () => {
    const { graph } = await analyzeProject(JAVA_PROJECT);

    const userFile = "src/main/java/com/example/model/User.java";
    const externals = graph
      .getDependencies(`file:${userFile}`)
      .filter((e) => e.to.startsWith("external:"));

    assert.ok(externals.length > 0, "User.java should have external imports");
    const extNames = externals.map((e) => e.to.replace("external:", ""));
    assert.ok(
      extNames.some((n) => n.includes("java.io.Serializable")),
      `expected java.io.Serializable in externals — got: ${extNames.join(", ")}`,
    );
  });

  it("detects public class exports", async () => {
    const { graph } = await analyzeProject(JAVA_PROJECT);

    const userFile = "src/main/java/com/example/model/User.java";
    const exports = graph.getFileExports(userFile);
    const names = exports.map((e) => e.name);
    assert.ok(names.includes("User"), `User.java should export User — got: ${names.join(", ")}`);
  });

  it("tracks export usage (uses_export edges)", async () => {
    const { graph } = await analyzeProject(JAVA_PROJECT);

    const userFile = "src/main/java/com/example/model/User.java";
    const exportId = `export:${userFile}:User`;
    const users = graph
      .allEdges()
      .filter((e) => e.to === exportId && e.kind === "uses_export");

    assert.ok(users.length >= 2, `User export should be used by at least 2 files — got ${users.length}`);
  });

  it("computes transitive impact for model changes", async () => {
    const { graph } = await analyzeProject(JAVA_PROJECT);

    const userFile = "src/main/java/com/example/model/User.java";
    const impact = graph.analyzeFileImpact(userFile);
    const affected = impact.affected
      .filter((a) => a.node.kind === "file")
      .map((a) => a.node.filePath);

    assert.ok(
      affected.includes("src/main/java/com/example/service/UserService.java"),
      "User.java change should affect UserService",
    );
    assert.ok(
      affected.includes("src/main/java/com/example/repository/UserRepository.java"),
      "User.java change should affect UserRepository",
    );
    assert.ok(
      affected.includes("src/main/java/com/example/App.java"),
      "User.java change should transitively affect App",
    );
  });

  it("distinguishes local and external import counts", async () => {
    const { graph } = await analyzeProject(JAVA_PROJECT);

    const repoFile = "src/main/java/com/example/repository/UserRepository.java";
    const deps = graph.getDependencies(`file:${repoFile}`).filter((e) => e.kind === "imports");
    const localCount = deps.filter((e) => !e.to.startsWith("external:")).length;
    const extCount = deps.filter((e) => e.to.startsWith("external:")).length;

    assert.ok(localCount >= 1, `UserRepository should have >= 1 local import — got ${localCount}`);
    assert.ok(extCount >= 2, `UserRepository should have >= 2 external imports (ArrayList, List) — got ${extCount}`);
  });
});
