import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../src/core/analyzer.js";
import { analyzeHealth } from "../src/core/health.js";
import { generateSuggestions } from "../src/core/suggest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "fixtures/mini-project");

describe("integration: full pipeline", () => {
  it("scans a real TypeScript project", async () => {
    const { graph, stats } = await analyzeProject(FIXTURE_DIR);

    assert.ok(stats.filesScanned >= 6, `expected >= 6 files, got ${stats.filesScanned}`);
    assert.equal(stats.filesFailed, 0);
    assert.ok(stats.durationMs >= 0);
    assert.ok(stats.nodeCount > 0);
    assert.ok(stats.edgeCount > 0);
  });

  it("builds correct dependency edges", async () => {
    const { graph } = await analyzeProject(FIXTURE_DIR);

    const appDeps = graph
      .getDependencies("file:src/app.ts")
      .filter((e) => e.kind === "imports" && !e.to.startsWith("external:"));

    const appTargets = appDeps.map((e) => e.to.replace("file:", ""));
    assert.ok(appTargets.includes("src/user-service.ts"), "app.ts should import user-service.ts");
    assert.ok(appTargets.includes("src/post-service.ts"), "app.ts should import post-service.ts");
  });

  it("resolves transitive dependencies", async () => {
    const { graph } = await analyzeProject(FIXTURE_DIR);

    // app.ts → user-service.ts → utils/format.ts → types.ts
    const impact = graph.analyzeFileImpact("src/types.ts");
    const affected = impact.affected
      .filter((a) => a.node.kind === "file")
      .map((a) => a.node.filePath);

    assert.ok(affected.includes("src/utils/format.ts"), "types.ts change should affect format.ts");
    assert.ok(affected.includes("src/user-service.ts"), "types.ts change should affect user-service.ts");
    assert.ok(affected.includes("src/app.ts"), "types.ts change should affect app.ts");
  });

  it("detects exports and their consumers", async () => {
    const { graph } = await analyzeProject(FIXTURE_DIR);

    const typeExports = graph.getDeclaredExports("src/types.ts");
    const exportNames = typeExports.map((e) => e.name).sort();
    assert.ok(exportNames.includes("User"), "types.ts should export User");
    assert.ok(exportNames.includes("Post"), "types.ts should export Post");
  });

  it("orphan.ts has no import dependents", async () => {
    const { graph } = await analyzeProject(FIXTURE_DIR);

    const dependents = graph
      .getDependents("file:src/orphan.ts")
      .filter((e) => e.kind === "imports");
    assert.equal(dependents.length, 0, "nobody should import orphan.ts");

    const deps = graph
      .getDependencies("file:src/orphan.ts")
      .filter((e) => e.kind === "imports");
    assert.equal(deps.length, 0, "orphan.ts should not import anything");
  });

  it("produces a valid health report", async () => {
    const { graph } = await analyzeProject(FIXTURE_DIR);
    const health = analyzeHealth(graph);

    assert.ok(health.score >= 0 && health.score <= 100);
    assert.ok(["A", "B", "C", "D", "F"].includes(health.grade));
    assert.ok(health.summary.length > 0);
    assert.ok(health.stats.totalFiles >= 6);
    assert.ok(health.stats.localEdges >= 4);
    assert.equal(health.cycles.length, 0);
  });

  it("produces valid suggestions", async () => {
    const { graph } = await analyzeProject(FIXTURE_DIR);
    const health = analyzeHealth(graph);
    const suggestions = generateSuggestions(graph, health);

    assert.ok(Array.isArray(suggestions.suggestions));
    assert.ok(suggestions.estimatedScoreImprovement >= 0);

    // orphan.ts exports `unused` which has no consumers
    const deadSugs = suggestions.suggestions.filter(
      (s) => s.kind === "remove-dead-exports",
    );
    const orphanDead = deadSugs.find(
      (s) => s.kind === "remove-dead-exports" && s.file === "src/orphan.ts",
    );
    assert.ok(orphanDead, "orphan.ts exports should be flagged as dead");
  });

  it("symbol-level impact is more precise than file-level", async () => {
    const { graph } = await analyzeProject(FIXTURE_DIR);

    const fileImpact = graph.analyzeFileImpact("src/types.ts");
    const fileCount = fileImpact.affected.filter((a) => a.node.kind === "file").length;

    const userImpact = graph.analyzeExportImpact("src/types.ts", "User");
    const userCount = userImpact.affected.filter((a) => a.node.kind === "file").length;

    const postImpact = graph.analyzeExportImpact("src/types.ts", "Post");
    const postCount = postImpact.affected.filter((a) => a.node.kind === "file").length;

    assert.ok(
      userCount <= fileCount,
      `User impact (${userCount}) should be <= file impact (${fileCount})`,
    );
    assert.ok(
      postCount <= fileCount,
      `Post impact (${postCount}) should be <= file impact (${fileCount})`,
    );
  });
});
