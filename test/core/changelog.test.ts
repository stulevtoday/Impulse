import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { analyzeProject } from "../../src/core/analyzer.js";
import { generateChangelog } from "../../src/core/changelog.js";

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "impulse-changelog-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Alice'", { cwd: dir, stdio: "pipe" });

  writeFileSync(join(dir, "utils.ts"), 'export function add(a: number, b: number) { return a + b; }\n');
  writeFileSync(join(dir, "main.ts"), 'import { add } from "./utils";\nconsole.log(add(1, 2));\n');
  execSync("git add -A && git commit -m 'feat: initial commit'", { cwd: dir, stdio: "pipe" });

  writeFileSync(join(dir, "utils.ts"), 'export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }\n');
  execSync("git add -A && git commit -m 'feat: add sub function'", { cwd: dir, stdio: "pipe" });

  execSync("git config user.name 'Bob'", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "helper.ts"), 'import { add } from "./utils";\nexport const sum = (x: number) => add(x, 1);\n');
  execSync("git add -A && git commit -m 'feat: add helper'", { cwd: dir, stdio: "pipe" });

  return dir;
}

describe("generateChangelog", () => {
  let testDir: string;

  before(() => {
    testDir = createTestRepo();
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("generates changelog between refs", async () => {
    const { graph } = await analyzeProject(testDir);
    const report = generateChangelog(graph, testDir, "HEAD~2");

    assert.ok(report.totalCommits >= 1);
    assert.ok(report.filesChanged.length >= 1);
    assert.ok(report.durationMs >= 0);
    assert.ok(report.summary.length > 0);
  });

  it("groups files by module", async () => {
    const { graph } = await analyzeProject(testDir);
    const report = generateChangelog(graph, testDir, "HEAD~2");

    assert.ok(report.modules.length >= 1);
    for (const m of report.modules) {
      assert.ok(m.name.length > 0);
      assert.ok(m.filesChanged > 0);
      assert.ok(typeof m.blastRadius === "number");
      assert.ok(["critical", "high", "medium", "low"].includes(m.riskLevel));
    }
  });

  it("tracks contributors", async () => {
    const { graph } = await analyzeProject(testDir);
    const report = generateChangelog(graph, testDir, "HEAD~2");

    assert.ok(report.topContributors.length >= 1);
    const bob = report.topContributors.find((c) => c.name === "Bob");
    assert.ok(bob, "Bob should be in contributors");
  });

  it("computes blast radius across changes", async () => {
    const { graph } = await analyzeProject(testDir);
    const report = generateChangelog(graph, testDir, "HEAD~2");

    assert.ok(typeof report.totalAffected === "number");
  });

  it("returns empty for no changes", async () => {
    const { graph } = await analyzeProject(testDir);
    const report = generateChangelog(graph, testDir, "HEAD", "HEAD");

    assert.equal(report.totalCommits, 0);
    assert.equal(report.filesChanged.length, 0);
  });

  it("is JSON-serializable", async () => {
    const { graph } = await analyzeProject(testDir);
    const report = generateChangelog(graph, testDir, "HEAD~2");

    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    assert.ok(parsed.commits);
    assert.ok(parsed.modules);
    assert.ok(parsed.summary);
  });
});
