#!/usr/bin/env node

import { analyzeProject, getFileImpact } from "../core/analyzer.js";
import { analyzeHealth, type HealthReport, type Penalties } from "../core/health.js";
import type { DependencyGraph } from "../core/graph.js";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";

// ── Types ──────────────────────────────────────────────────────────

interface CIConfig {
  projectRoot: string;
  baseRef: string;
  prNumber: number;
  repo: string;
  token: string;
  threshold: number;
}

interface BranchAnalysis {
  health: HealthReport;
  filesScanned: number;
  durationMs: number;
}

interface FileImpact {
  file: string;
  affectedCount: number;
  maxDepth: number;
}

interface ImpactSummary {
  perFile: FileImpact[];
  allAffected: Array<[string, { depth: number; via: string }]>;
  totalAffected: number;
}

// ── Config ─────────────────────────────────────────────────────────

function loadConfig(): CIConfig {
  const projectRoot = resolve(process.argv[2] ?? ".");
  const token = process.env.GITHUB_TOKEN ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const prNumber = parseInt(process.env.IMPULSE_PR_NUMBER ?? "0", 10);
  const threshold = parseInt(process.env.IMPULSE_THRESHOLD ?? "0", 10);

  let baseRef = process.env.IMPULSE_BASE_REF ?? "";
  if (!baseRef) {
    baseRef = "origin/main";
  }

  return { projectRoot, baseRef, prNumber, repo, token, threshold };
}

// ── Analysis ───────────────────────────────────────────────────────

async function analyzeBranch(dir: string): Promise<BranchAnalysis> {
  const { graph, stats } = await analyzeProject(dir);
  const health = analyzeHealth(graph);
  return { health, filesScanned: stats.filesScanned, durationMs: stats.durationMs };
}

function ensureBaseRef(projectRoot: string, baseRef: string): void {
  try {
    execSync(`git rev-parse --verify ${baseRef}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    const branch = baseRef.replace(/^origin\//, "");
    try {
      execSync(`git fetch origin ${branch} --depth=1`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch {
      // fetch failed — we'll handle it downstream
    }
  }
}

async function analyzeBaseViaWorktree(
  projectRoot: string,
  baseRef: string,
): Promise<BranchAnalysis | null> {
  const tmpDir = mkdtempSync(join(tmpdir(), "impulse-base-"));

  try {
    execSync(`git worktree add "${tmpDir}" ${baseRef}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });

    return await analyzeBranch(tmpDir);
  } catch {
    return null;
  } finally {
    try {
      execSync(`git worktree remove "${tmpDir}" --force`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ── Changed files & impact ─────────────────────────────────────────

function getChangedFiles(projectRoot: string, baseRef: string): string[] {
  const commands = [
    `git diff --name-only ${baseRef}...HEAD`,
    `git diff --name-only ${baseRef} HEAD`,
    `git diff --name-only HEAD~1 HEAD`,
  ];

  for (const cmd of commands) {
    try {
      const raw = execSync(cmd, {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      if (raw) return raw.split("\n").filter((f) => f.length > 0);
    } catch {
      continue;
    }
  }
  return [];
}

function computeImpactFromGraph(
  graph: DependencyGraph,
  changedFiles: string[],
): ImpactSummary {
  const allAffected = new Map<string, { depth: number; via: string }>();
  const changedSet = new Set(changedFiles);

  for (const file of changedFiles) {
    const impact = getFileImpact(graph, file);
    for (const item of impact.affected) {
      if (item.node.kind !== "file") continue;
      if (changedSet.has(item.node.filePath)) continue;
      const existing = allAffected.get(item.node.filePath);
      if (!existing || item.depth < existing.depth) {
        allAffected.set(item.node.filePath, { depth: item.depth, via: file });
      }
    }
  }

  const perFile = changedFiles.map((file) => {
    const impact = getFileImpact(graph, file);
    const affected = impact.affected.filter(
      (a) => a.node.kind === "file" && !changedSet.has(a.node.filePath),
    );
    const maxDepth = affected.length > 0
      ? Math.max(...affected.map((a) => a.depth))
      : 0;
    return { file, affectedCount: affected.length, maxDepth };
  });

  const sorted = [...allAffected.entries()].sort((a, b) => a[1].depth - b[1].depth);

  return {
    perFile: perFile.sort((a, b) => b.affectedCount - a.affectedCount),
    allAffected: sorted,
    totalAffected: sorted.length,
  };
}

// ── Report generation ──────────────────────────────────────────────

const COMMENT_MARKER = "<!-- impulse-ci-report -->";

function deltaStr(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "0";
}

function penaltyDeltaRow(
  name: string,
  baseVal: number,
  headVal: number,
): string {
  const d = headVal - baseVal;
  const ds = d === 0 ? "—" : deltaStr(d);
  return `| ${name} | ${baseVal} | ${headVal} | ${ds} |`;
}

function generateReport(
  head: BranchAnalysis,
  base: BranchAnalysis | null,
  changedFiles: string[],
  impact: ImpactSummary,
  config: CIConfig,
): string {
  const lines: string[] = [COMMENT_MARKER, ""];

  // ── Header ──
  const score = `**${head.health.score}**/100 (${head.health.grade})`;

  if (base) {
    const delta = head.health.score - base.health.score;
    if (delta === 0) {
      lines.push(`## 🫀 Impulse — ${score} · no change`);
    } else {
      const emoji = delta > 0 ? "📈" : "📉";
      const baseName = config.baseRef.replace(/^origin\//, "");
      lines.push(
        `## 🫀 Impulse — ${score} · ${emoji} **${deltaStr(delta)}** from \`${baseName}\``,
      );
    }
  } else {
    lines.push(`## 🫀 Impulse — ${score}`);
  }
  lines.push("");

  // ── New / resolved issues ──
  if (base) {
    const issues: string[] = [];

    const baseCycleKeys = new Set(
      base.health.cycles.map((c) => c.cycle.join("→")),
    );
    const headCycleKeys = new Set(
      head.health.cycles.map((c) => c.cycle.join("→")),
    );

    for (const cycle of head.health.cycles) {
      if (!baseCycleKeys.has(cycle.cycle.join("→"))) {
        const label =
          cycle.severity === "tight-couple"
            ? `\`${cycle.cycle[0]}\` ↔ \`${cycle.cycle[1]}\``
            : cycle.cycle.map((f) => `\`${f}\``).join(" → ");
        issues.push(`⚠️ New cycle: ${label} (${cycle.severity})`);
      }
    }

    for (const cycle of base.health.cycles) {
      if (!headCycleKeys.has(cycle.cycle.join("→"))) {
        issues.push(`✅ Resolved cycle: \`${cycle.cycle[0]}\` ↔ \`${cycle.cycle[1]}\``);
      }
    }

    const baseGodSet = new Set(base.health.godFiles.map((g) => g.file));
    for (const god of head.health.godFiles) {
      if (!baseGodSet.has(god.file)) {
        issues.push(
          `⚠️ New god file: \`${god.file}\` (${god.totalConnections} connections)`,
        );
      }
    }

    if (issues.length > 0) {
      for (const issue of issues) lines.push(issue);
      lines.push("");
    }
  }

  // ── Impact summary ──
  if (changedFiles.length > 0) {
    lines.push(
      `### ${changedFiles.length} file(s) changed → ${impact.totalAffected} file(s) affected`,
    );
    lines.push("");

    if (impact.totalAffected === 0 && changedFiles.length <= 10) {
      for (const f of changedFiles) {
        lines.push(`- \`${f}\` — no dependents affected`);
      }
      lines.push("");
    }

    const withImpact = impact.perFile.filter((f) => f.affectedCount > 0);

    if (withImpact.length > 0) {
      lines.push("| Changed | Affected | Max Depth |");
      lines.push("|---|---|---|");
      for (const f of withImpact.slice(0, 15)) {
        lines.push(`| \`${f.file}\` | ${f.affectedCount} | ${f.maxDepth} |`);
      }
      if (withImpact.length > 15) {
        lines.push(`| *...${withImpact.length - 15} more* | | |`);
      }
      lines.push("");
    }

    if (impact.allAffected.length > 0) {
      lines.push("<details>");
      lines.push(
        `<summary>📋 All affected files (${impact.allAffected.length})</summary>`,
      );
      lines.push("");
      lines.push("| File | Depth | Via |");
      lines.push("|---|---|---|");
      for (const [file, info] of impact.allAffected.slice(0, 50)) {
        const depth = info.depth === 1 ? "direct" : `${info.depth}`;
        lines.push(`| \`${file}\` | ${depth} | \`${info.via}\` |`);
      }
      if (impact.allAffected.length > 50) {
        lines.push(`| *...${impact.allAffected.length - 50} more* | | |`);
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  } else {
    lines.push("No source files changed in this PR.");
    lines.push("");
  }

  // ── Score breakdown ──
  const p = head.health.penalties;
  const hasPenalties = Object.values(p).some((v) => v > 0);

  if (hasPenalties || base) {
    lines.push("<details>");
    lines.push("<summary>📊 Score breakdown</summary>");
    lines.push("");

    if (base) {
      const bp = base.health.penalties;
      lines.push("| Penalty | Base | PR | Delta |");
      lines.push("|---|---|---|---|");
      lines.push(penaltyDeltaRow("Cycles", bp.cycles, p.cycles));
      lines.push(penaltyDeltaRow("God files", bp.godFiles, p.godFiles));
      lines.push(penaltyDeltaRow("Deep chains", bp.deepChains, p.deepChains));
      lines.push(penaltyDeltaRow("Orphans", bp.orphans, p.orphans));
      lines.push(
        penaltyDeltaRow("Hub concentration", bp.hubConcentration, p.hubConcentration),
      );
    } else {
      lines.push("| Penalty | Points |");
      lines.push("|---|---|");
      if (p.cycles > 0) lines.push(`| Cycles | -${p.cycles} |`);
      if (p.godFiles > 0) lines.push(`| God files | -${p.godFiles} |`);
      if (p.deepChains > 0) lines.push(`| Deep chains | -${p.deepChains} |`);
      if (p.orphans > 0) lines.push(`| Orphans | -${p.orphans} |`);
      if (p.hubConcentration > 0) lines.push(`| Hub concentration | -${p.hubConcentration} |`);
    }

    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // ── Footer ──
  const totalMs = head.durationMs + (base?.durationMs ?? 0);
  lines.push("---");
  lines.push(
    `<sub>⚡ ${head.filesScanned} files analyzed in ${totalMs}ms · <a href="https://github.com/stulevtoday/Impulse">Impulse</a></sub>`,
  );

  return lines.join("\n");
}

// ── GitHub API ─────────────────────────────────────────────────────

async function findExistingComment(
  repo: string,
  prNumber: number,
  token: string,
): Promise<number | null> {
  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) return null;

  const comments = (await res.json()) as Array<{ id: number; body: string }>;
  return comments.find((c) => c.body.includes(COMMENT_MARKER))?.id ?? null;
}

async function postOrUpdateComment(
  repo: string,
  prNumber: number,
  token: string,
  body: string,
): Promise<void> {
  const existingId = await findExistingComment(repo, prNumber, token);

  if (existingId) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/comments/${existingId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body }),
      },
    );
    if (res.ok) {
      console.log(`  Updated existing comment #${existingId}`);
      return;
    }
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );

  if (res.ok) {
    console.log("  Posted new comment");
  } else {
    const text = await res.text();
    console.error(`  Failed to post comment: ${res.status} ${text}`);
  }
}

// ── GitHub Actions outputs ─────────────────────────────────────────

function setOutputs(
  head: BranchAnalysis,
  base: BranchAnalysis | null,
  impact: ImpactSummary,
): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;

  appendFileSync(outputFile, `score=${head.health.score}\n`);
  appendFileSync(outputFile, `grade=${head.health.grade}\n`);
  appendFileSync(outputFile, `affected=${impact.totalAffected}\n`);
  if (base) {
    appendFileSync(
      outputFile,
      `delta=${head.health.score - base.health.score}\n`,
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("\n  🫀 Impulse CI\n");
  console.log(`  Project:   ${config.projectRoot}`);
  console.log(`  Base ref:  ${config.baseRef}`);
  if (config.prNumber > 0) console.log(`  PR:        #${config.prNumber}`);
  if (config.threshold > 0) console.log(`  Threshold: ${config.threshold}`);
  console.log();

  // 1. Analyze PR branch
  console.log("  Analyzing PR branch...");
  const { graph: headGraph, stats: headStats } = await analyzeProject(config.projectRoot);
  const headHealth = analyzeHealth(headGraph);
  const head: BranchAnalysis = {
    health: headHealth,
    filesScanned: headStats.filesScanned,
    durationMs: headStats.durationMs,
  };
  console.log(
    `  → ${head.health.score}/100 (${head.health.grade}) — ${head.filesScanned} files, ${head.durationMs}ms`,
  );

  // 2. Analyze base branch via worktree
  ensureBaseRef(config.projectRoot, config.baseRef);
  console.log(`\n  Analyzing base (${config.baseRef})...`);
  const base = await analyzeBaseViaWorktree(config.projectRoot, config.baseRef);
  if (base) {
    console.log(
      `  → ${base.health.score}/100 (${base.health.grade}) — ${base.filesScanned} files, ${base.durationMs}ms`,
    );
  } else {
    console.log("  → Skipped (could not checkout base ref)");
  }

  // 3. Changed files + impact (reuse the already-built graph)
  const changedFiles = getChangedFiles(config.projectRoot, config.baseRef);
  console.log(`\n  Changed files: ${changedFiles.length}`);

  const impact = computeImpactFromGraph(headGraph, changedFiles);
  if (impact.totalAffected > 0) {
    console.log(`  Affected files: ${impact.totalAffected}`);
  }

  // 4. Generate report
  const report = generateReport(head, base, changedFiles, impact, config);

  // 5. Post comment or print to stdout
  if (config.token && config.prNumber > 0 && config.repo) {
    console.log("\n  Posting comment...");
    await postOrUpdateComment(config.repo, config.prNumber, config.token, report);
  } else {
    console.log("\n  ─── Report ───────────────────────────────────────\n");
    console.log(report);
    console.log("\n  ─────────────────────────────────────────────────\n");
  }

  // 6. Set GitHub Actions outputs
  setOutputs(head, base, impact);

  // 7. Threshold gate
  if (config.threshold > 0 && head.health.score < config.threshold) {
    console.error(
      `\n  ❌ Health score ${head.health.score} is below threshold ${config.threshold}`,
    );
    process.exit(1);
  }

  console.log("\n  ✅ Impulse CI complete\n");
}

main().catch((err) => {
  console.error("\n  Impulse CI error:", err);
  process.exit(1);
});
