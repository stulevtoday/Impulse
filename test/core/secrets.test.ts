import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { analyzeProject } from "../../src/core/analyzer.js";
import { analyzeSecrets } from "../../src/core/secrets.js";

function createProject(opts: {
  gitignore?: string;
  envContent?: string;
  envFiles?: Record<string, string>;
  packageJson?: object;
  sourceFile?: string;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "impulse-secrets-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });

  if (opts.gitignore !== undefined) {
    writeFileSync(join(dir, ".gitignore"), opts.gitignore);
  }
  if (opts.envContent) {
    writeFileSync(join(dir, ".env"), opts.envContent);
  }
  if (opts.envFiles) {
    for (const [name, content] of Object.entries(opts.envFiles)) {
      writeFileSync(join(dir, name), content);
    }
  }
  if (opts.packageJson) {
    writeFileSync(join(dir, "package.json"), JSON.stringify(opts.packageJson));
  }
  if (opts.sourceFile) {
    writeFileSync(join(dir, "app.ts"), opts.sourceFile);
  }

  return dir;
}

describe("analyzeSecrets", () => {
  it("detects .env not in .gitignore", async () => {
    const dir = createProject({
      envContent: "PORT=3000\n",
      gitignore: "node_modules\n",
    });

    const { graph } = await analyzeProject(dir);
    const report = await analyzeSecrets(graph, dir);

    assert.ok(report.envFilesExposed.includes(".env"));
    const issue = report.issues.find((i) => i.category === "gitignore");
    assert.ok(issue, "should detect unignored .env");
    assert.equal(issue.severity, "critical");

    rmSync(dir, { recursive: true, force: true });
  });

  it("does not flag .env when in .gitignore", async () => {
    const dir = createProject({
      envContent: "PORT=3000\n",
      gitignore: "node_modules\n.env\n",
    });

    const { graph } = await analyzeProject(dir);
    const report = await analyzeSecrets(graph, dir);

    assert.ok(report.envFilesIgnored.includes(".env"));
    const gitignoreIssues = report.issues.filter((i) => i.category === "gitignore");
    assert.equal(gitignoreIssues.length, 0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("detects weak defaults for secret variables", async () => {
    const dir = createProject({
      envContent: "JWT_SECRET=changeme\nPORT=3000\n",
      gitignore: ".env\n",
    });

    const { graph } = await analyzeProject(dir);
    const report = await analyzeSecrets(graph, dir);

    const weak = report.issues.find((i) => i.category === "weak-default");
    assert.ok(weak, "should detect weak default for JWT_SECRET");
    assert.ok(weak.message.includes("JWT_SECRET"));

    rmSync(dir, { recursive: true, force: true });
  });

  it("detects client-exposed secrets in Next.js projects", async () => {
    const dir = createProject({
      packageJson: { dependencies: { next: "^14.0.0" } },
      envContent: "NEXT_PUBLIC_API_SECRET=abc123\n",
      gitignore: ".env\n",
      sourceFile: 'const key = process.env.NEXT_PUBLIC_API_SECRET;\n',
    });

    const { graph } = await analyzeProject(dir);
    const report = await analyzeSecrets(graph, dir);

    assert.equal(report.framework, "next");
    assert.equal(report.clientPrefix, "NEXT_PUBLIC_");
    const exposed = report.issues.find((i) => i.category === "client-exposed");
    assert.ok(exposed, "should detect client-exposed secret");
    assert.equal(exposed.severity, "critical");

    rmSync(dir, { recursive: true, force: true });
  });

  it("reports clean when no issues", async () => {
    const dir = createProject({
      envContent: "PORT=3000\nNODE_ENV=development\n",
      gitignore: ".env\n.env.*\n",
    });

    const { graph } = await analyzeProject(dir);
    const report = await analyzeSecrets(graph, dir);

    assert.equal(report.issues.length, 0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("handles projects without .env files", async () => {
    const dir = createProject({
      sourceFile: 'console.log("hello");\n',
    });

    const { graph } = await analyzeProject(dir);
    const report = await analyzeSecrets(graph, dir);

    assert.equal(report.envFilesFound.length, 0);
    assert.ok(report.durationMs >= 0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("sorts issues by severity (critical first)", async () => {
    const dir = createProject({
      envContent: "AWS_SECRET_ACCESS_KEY=changeme\n",
      gitignore: "node_modules\n",
    });

    const { graph } = await analyzeProject(dir);
    const report = await analyzeSecrets(graph, dir);

    if (report.issues.length >= 2) {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      for (let i = 1; i < report.issues.length; i++) {
        assert.ok(
          severityOrder[report.issues[i].severity] >= severityOrder[report.issues[i - 1].severity],
        );
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });
});
