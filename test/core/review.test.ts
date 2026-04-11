import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { runReview, computeVerdict, type FileReview } from "../../src/core/review.js";

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "impulse-review-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });

  writeFileSync(
    join(dir, "utils.ts"),
    'export function add(a: number, b: number) { return a + b; }\n',
  );
  writeFileSync(
    join(dir, "main.ts"),
    'import { add } from "./utils";\nconsole.log(add(1, 2));\n',
  );

  execSync("git add -A && git commit -m 'initial'", { cwd: dir, stdio: "pipe" });

  writeFileSync(
    join(dir, "utils.ts"),
    'export function add(a: number, b: number) { return a + b; }\nexport function multiply(a: number, b: number) { return a * b; }\n',
  );

  return dir;
}

describe("review", () => {
  let testDir: string;

  before(() => {
    testDir = createTestRepo();
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("detects changed files and blast radius", async () => {
    const report = await runReview(testDir);
    assert.ok(report.changedFiles.includes("utils.ts"), "utils.ts should be in changed files");
    assert.ok(report.totalAffected >= 1, "main.ts depends on utils.ts");
    assert.ok(report.durationMs > 0);
  });

  it("computes risk for changed files", async () => {
    const report = await runReview(testDir);
    assert.ok(report.files.length >= 1);
    const utils = report.files.find((f) => f.file === "utils.ts");
    assert.ok(utils, "should have risk data for utils.ts");
    assert.equal(typeof utils.riskScore, "number");
    assert.ok(["critical", "high", "medium", "low"].includes(utils.riskLevel));
  });

  it("populates test targets when test files exist", async () => {
    writeFileSync(
      join(testDir, "utils.test.ts"),
      'import { add } from "./utils";\nimport { describe, it } from "node:test";\nimport assert from "node:assert";\ndescribe("add", () => { it("works", () => assert.equal(add(1, 2), 3)); });\n',
    );
    execSync("git add utils.test.ts && git commit -m 'add test'", { cwd: testDir, stdio: "pipe" });

    writeFileSync(
      join(testDir, "utils.ts"),
      'export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }\n',
    );

    const report = await runReview(testDir);
    assert.ok(report.testTargets.length >= 1, "should suggest running utils.test.ts");
    assert.ok(report.runCommand, "should generate a run command");
  });

  it("returns empty report when no changes", async () => {
    const cleanDir = mkdtempSync(join(tmpdir(), "impulse-review-clean-"));
    execSync("git init", { cwd: cleanDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: cleanDir, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: cleanDir, stdio: "pipe" });
    writeFileSync(join(cleanDir, "a.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'init'", { cwd: cleanDir, stdio: "pipe" });

    const report = await runReview(cleanDir);
    assert.equal(report.changedFiles.length, 0);
    assert.equal(report.verdict.level, "ship");
    assert.equal(report.verdict.reasons[0], "no changes to review");

    rmSync(cleanDir, { recursive: true, force: true });
  });
});

describe("computeVerdict", () => {
  const makeFile = (overrides: Partial<FileReview>): FileReview => ({
    file: "test.ts",
    riskScore: 10,
    riskLevel: "low",
    blastRadius: 2,
    complexity: 3,
    churn: 5,
    couplings: 0,
    ...overrides,
  });

  it("returns ship when all clear", () => {
    const v = computeVerdict([makeFile({})], [], [], [], 5);
    assert.equal(v.level, "ship");
    assert.deepEqual(v.reasons, ["all clear"]);
  });

  it("returns hold for critical-risk files", () => {
    const v = computeVerdict(
      [makeFile({ riskLevel: "critical", riskScore: 75 })],
      [],
      [],
      [],
      5,
    );
    assert.equal(v.level, "hold");
    assert.ok(v.reasons.some((r) => r.includes("critical-risk")));
  });

  it("returns hold for dependency cycles", () => {
    const v = computeVerdict(
      [makeFile({})],
      [{ cycle: ["a.ts", "b.ts", "a.ts"], severity: "tight-couple" }],
      [],
      [],
      5,
    );
    assert.equal(v.level, "hold");
    assert.ok(v.reasons.some((r) => r.includes("cycle")));
  });

  it("returns review for high-risk files", () => {
    const v = computeVerdict(
      [makeFile({ riskLevel: "high", riskScore: 45 })],
      [],
      [],
      [],
      5,
    );
    assert.equal(v.level, "review");
    assert.ok(v.reasons.some((r) => r.includes("high-risk")));
  });

  it("returns review for boundary violations", () => {
    const v = computeVerdict(
      [makeFile({})],
      [],
      [{ from: "cli/a.ts", to: "core/b.ts", fromBoundary: "cli", toBoundary: "core" }],
      [],
      5,
    );
    assert.equal(v.level, "review");
    assert.ok(v.reasons.some((r) => r.includes("boundary")));
  });

  it("returns review for large blast radius", () => {
    const v = computeVerdict([makeFile({})], [], [], [], 25);
    assert.equal(v.level, "review");
    assert.ok(v.reasons.some((r) => r.includes("blast radius")));
  });

  it("hold takes priority over review", () => {
    const v = computeVerdict(
      [makeFile({ riskLevel: "critical", riskScore: 75 })],
      [],
      [{ from: "a.ts", to: "b.ts", fromBoundary: "x", toBoundary: "y" }],
      [],
      25,
    );
    assert.equal(v.level, "hold");
    assert.ok(v.reasons.length >= 2);
  });
});
