import type { Command } from "commander";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeHealth, type HealthReport } from "../core/health.js";

interface CommitInfo {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  author: string;
}

interface HistoryPoint {
  commit: CommitInfo;
  score: number;
  grade: string;
  files: number;
  cycles: number;
  godFiles: number;
  durationMs: number;
}

function getCommits(rootDir: string, count: number): CommitInfo[] {
  const raw = execSync(
    `git log --format="%H|%h|%ai|%s|%an" -n ${count} --no-merges`,
    { cwd: rootDir, encoding: "utf-8", stdio: "pipe" },
  ).trim();

  if (!raw) return [];

  return raw.split("\n").map((line) => {
    const [hash, shortHash, date, subject, author] = line.split("|");
    return {
      hash,
      shortHash,
      date: date.slice(0, 10),
      subject: subject.length > 50 ? subject.slice(0, 47) + "..." : subject,
      author,
    };
  });
}

async function analyzeCommit(
  rootDir: string,
  hash: string,
  worktreeDir: string,
): Promise<{ health: HealthReport; files: number; durationMs: number } | null> {
  try {
    execSync(`git checkout ${hash} --quiet`, {
      cwd: worktreeDir,
      stdio: "pipe",
    });

    const { graph, stats } = await analyzeProject(worktreeDir);
    const health = analyzeHealth(graph);
    return { health, files: stats.filesScanned, durationMs: stats.durationMs };
  } catch {
    return null;
  }
}

function renderChart(points: HistoryPoint[]): string {
  if (points.length === 0) return "";

  const scores = points.map((p) => p.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);

  const chartHeight = 12;
  const colWidth = 3;

  const padding = Math.max(3, Math.ceil((maxScore - minScore) * 0.2));
  const top = Math.min(100, maxScore + padding);
  const bottom = Math.max(0, minScore - padding);
  const span = Math.max(top - bottom, 10);

  const lines: string[] = [];

  for (let row = chartHeight; row >= 0; row--) {
    const scoreAtRow = bottom + (row / chartHeight) * span;
    const label = Math.round(scoreAtRow).toString().padStart(3);

    let line = "";
    for (let i = 0; i < points.length; i++) {
      const normalized = ((points[i].score - bottom) / span) * chartHeight;
      const rounded = Math.round(normalized);

      if (rounded === row) {
        const grade = points[i].grade;
        const color =
          grade === "A" ? "\x1b[32m" :
          grade === "B" ? "\x1b[32m" :
          grade === "C" ? "\x1b[33m" :
          grade === "D" ? "\x1b[33m" :
          "\x1b[31m";
        line += `${color}●\x1b[0m` + " ".repeat(colWidth - 1);
      } else {
        line += row === 0 ? "─".repeat(colWidth) : " ".repeat(colWidth);
      }
    }

    if (row === chartHeight || row === 0 || row === Math.round(chartHeight / 2)) {
      lines.push(`  ${label} ┤${line}`);
    } else {
      lines.push(`      │${line}`);
    }
  }

  const first = points[0].commit.date;
  const last = points[points.length - 1].commit.date;
  const datePad = " ".repeat(Math.max(0, points.length * colWidth - last.length - first.length));
  lines.push(`      └${"─".repeat(points.length * colWidth)}`);
  lines.push(`       ${last}${datePad}${first}`);

  return lines.join("\n");
}

function renderSummary(points: HistoryPoint[]): string {
  if (points.length === 0) return "  No data points.";

  const lines: string[] = [];
  const current = points[0];
  const scores = points.map((p) => p.score);
  const best = points.reduce((a, b) => (a.score >= b.score ? a : b));
  const worst = points.reduce((a, b) => (a.score <= b.score ? a : b));
  const trend = current.score - points[points.length - 1].score;

  lines.push(`  Current:  ${current.score}/100 (${current.grade})  ← ${current.commit.shortHash}`);
  lines.push(`  Best:     ${best.score}/100 (${best.grade})  ← ${best.commit.shortHash}  ${best.commit.subject}`);
  lines.push(`  Worst:    ${worst.score}/100 (${worst.grade})  ← ${worst.commit.shortHash}  ${worst.commit.subject}`);

  const arrow = trend > 0 ? "\x1b[32m↗\x1b[0m" : trend < 0 ? "\x1b[31m↘\x1b[0m" : "→";
  const sign = trend > 0 ? "+" : "";
  lines.push(`  Trend:    ${arrow} ${sign}${trend} over ${points.length} commits`);

  return lines.join("\n");
}

function renderSignificantChanges(points: HistoryPoint[]): string {
  if (points.length < 2) return "";

  const changes: Array<{ delta: number; point: HistoryPoint; prev: HistoryPoint }> = [];

  for (let i = 0; i < points.length - 1; i++) {
    const delta = points[i].score - points[i + 1].score;
    if (Math.abs(delta) >= 3) {
      changes.push({ delta, point: points[i], prev: points[i + 1] });
    }
  }

  if (changes.length === 0) return "";

  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const lines: string[] = ["", "  Significant changes:"];
  for (const c of changes.slice(0, 8)) {
    const emoji = c.delta > 0 ? "\x1b[32m▲\x1b[0m" : "\x1b[31m▼\x1b[0m";
    const sign = c.delta > 0 ? "+" : "";
    lines.push(
      `    ${emoji} ${sign}${c.delta}  ${c.point.commit.shortHash}  ${c.point.commit.subject}`,
    );
  }

  return lines.join("\n");
}

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("Show project health over time — architecture evolution across commits")
    .argument("[dir]", "Project root directory", ".")
    .option("-n, --count <n>", "Number of commits to analyze", "20")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { count: string; json?: boolean }) => {
      const { resolve } = await import("node:path");
      const rootDir = resolve(dir);
      const count = parseInt(opts.count, 10);

      console.log("\n  \x1b[36mImpulse — Health Timeline\x1b[0m\n");

      const commits = getCommits(rootDir, count);
      if (commits.length === 0) {
        console.log("  No commits found.");
        return;
      }

      console.log(`  Analyzing ${commits.length} commits...`);

      const worktreeDir = mkdtempSync(join(tmpdir(), "impulse-history-"));
      const points: HistoryPoint[] = [];

      try {
        execSync(`git worktree add "${worktreeDir}" HEAD --quiet`, {
          cwd: rootDir,
          stdio: "pipe",
        });

        for (let i = 0; i < commits.length; i++) {
          const commit = commits[i];
          const progress = `[${i + 1}/${commits.length}]`;
          process.stdout.write(`\r  ${progress} ${commit.shortHash} ${commit.subject.slice(0, 40)}...`.padEnd(70));

          const result = await analyzeCommit(rootDir, commit.hash, worktreeDir);
          if (result) {
            points.push({
              commit,
              score: result.health.score,
              grade: result.health.grade,
              files: result.files,
              cycles: result.health.cycles.length,
              godFiles: result.health.godFiles.length,
              durationMs: result.durationMs,
            });
          }
        }

        process.stdout.write("\r" + " ".repeat(70) + "\r");
      } finally {
        try {
          execSync(`git worktree remove "${worktreeDir}" --force`, {
            cwd: rootDir,
            stdio: "pipe",
          });
        } catch {
          rmSync(worktreeDir, { recursive: true, force: true });
        }
      }

      if (points.length === 0) {
        console.log("  No analyzable commits found.");
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(points, null, 2));
        return;
      }

      console.log(renderChart(points));
      console.log();
      console.log(renderSummary(points));
      console.log(renderSignificantChanges(points));

      const totalMs = points.reduce((s, p) => s + p.durationMs, 0);
      console.log(`\n  \x1b[2m${points.length} commits analyzed in ${totalMs}ms\x1b[0m\n`);
    });
}
