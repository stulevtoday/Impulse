import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "impulse-hook-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  return dir;
}

function getHookPath(repoDir: string): string {
  const gitDir = execSync("git rev-parse --git-dir", {
    cwd: repoDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return join(repoDir, gitDir, "hooks", "pre-push");
}

function runCli(repoDir: string, args: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(
      `node ${join(process.cwd(), "dist/cli/index.js")} ${args}`,
      { cwd: repoDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

describe("impulse hook", () => {
  let repoDir: string;

  before(() => {
    repoDir = createTestRepo();
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("status reports no hook initially", () => {
    const { stdout } = runCli(repoDir, "hook status");
    assert.ok(stdout.includes("No pre-push hook"), stdout);
  });

  it("installs pre-push hook", () => {
    const { stdout } = runCli(repoDir, "hook install");
    assert.ok(stdout.includes("Installed"), stdout);

    const hookPath = getHookPath(repoDir);
    assert.ok(existsSync(hookPath));

    const content = readFileSync(hookPath, "utf-8");
    assert.ok(content.includes("impulse-review-hook"));
    assert.ok(content.includes("impulse-analyzer review"));
  });

  it("status reports hook is active", () => {
    const { stdout } = runCli(repoDir, "hook status");
    assert.ok(stdout.includes("active"), stdout);
  });

  it("skips if already installed", () => {
    const { stdout } = runCli(repoDir, "hook install");
    assert.ok(stdout.includes("already installed"), stdout);
  });

  it("uninstalls the hook", () => {
    const { stdout } = runCli(repoDir, "hook uninstall");
    assert.ok(stdout.includes("Removed"), stdout);
    assert.ok(!existsSync(getHookPath(repoDir)));
  });

  it("does not remove non-impulse hooks", () => {
    const hookPath = getHookPath(repoDir);
    mkdirSync(join(repoDir, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\necho custom\n", { mode: 0o755 });

    const { stdout } = runCli(repoDir, "hook uninstall");
    assert.ok(stdout.includes("not installed by Impulse"), stdout);
    assert.ok(existsSync(hookPath));
  });

  it("refuses to overwrite existing hook without --force", () => {
    const { stdout, code } = runCli(repoDir, "hook install");
    assert.ok(stdout.includes("already exists"), stdout);
    assert.equal(code, 1);
  });

  it("overwrites existing hook with --force", () => {
    const { stdout } = runCli(repoDir, "hook install --force");
    assert.ok(stdout.includes("Installed"), stdout);

    const content = readFileSync(getHookPath(repoDir), "utf-8");
    assert.ok(content.includes("impulse-review-hook"));
  });
});
