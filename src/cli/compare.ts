import type { Command } from "commander";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeHealth, type HealthReport } from "../core/health.js";
import { loadConfig } from "../core/config.js";

interface BranchSnapshot {
  score: number;
  grade: string;
  files: number;
  cycles: number;
  godFiles: number;
  orphans: number;
  summary: string;
  cycleDetails: Array<{ cycle: string[]; severity: string }>;
  godFileDetails: Array<{ file: string; totalConnections: number }>;
}

async function analyzeRef(
  rootDir: string,
  ref: string | null,
): Promise<BranchSnapshot | null> {
  const targetDir = ref ? mkdtempSync(join(tmpdir(), "impulse-compare-")) : rootDir;

  try {
    if (ref) {
      execSync(`git worktree add "${targetDir}" ${ref} --quiet`, {
        cwd: rootDir,
        stdio: "pipe",
      });
    }

    const [{ graph, stats }, config] = await Promise.all([
      analyzeProject(targetDir),
      loadConfig(targetDir),
    ]);
    const health = analyzeHealth(graph, config.boundaries);

    return {
      score: health.score,
      grade: health.grade,
      files: stats.filesScanned,
      cycles: health.cycles.length,
      godFiles: health.godFiles.length,
      orphans: health.orphans.length,
      summary: health.summary,
      cycleDetails: health.cycles.map((c) => ({ cycle: c.cycle, severity: c.severity })),
      godFileDetails: health.godFiles.map((g) => ({ file: g.file, totalConnections: g.totalConnections })),
    };
  } catch {
    return null;
  } finally {
    if (ref) {
      try {
        execSync(`git worktree remove "${targetDir}" --force`, { cwd: rootDir, stdio: "pipe" });
      } catch {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  }
}

function formatDelta(current: number, target: number): string {
  const delta = current - target;
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  if (delta > 0) return `${green}+${delta}${reset}`;
  if (delta < 0) return `${red}${delta}${reset}`;
  return "=";
}

function formatScoreDelta(current: number, target: number): string {
  const delta = current - target;
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  if (delta > 0) return `${green}▲ +${delta}${reset}`;
  if (delta < 0) return `${red}▼ ${delta}${reset}`;
  return "unchanged";
}

export function registerCompareCommand(program: Command): void {
  program
    .command("compare")
    .description("Compare architecture health between current state and a branch/commit")
    .argument("<ref>", "Branch, tag, or commit hash to compare against")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .action(async (ref: string, dir: string, opts: { json?: boolean }) => {
      const rootDir = resolve(dir);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const cyan = "\x1b[36m";
      const green = "\x1b[32m";
      const yellow = "\x1b[33m";
      const red = "\x1b[31m";

      if (!opts.json) console.log(`\n  ${bold}Impulse — Branch Comparison${reset}`);
      if (!opts.json) console.log(`  ${dim}Current (HEAD) vs ${ref}${reset}\n`);

      if (!opts.json) process.stdout.write(`  ${dim}Analyzing current state...${reset}\r`);
      const current = await analyzeRef(rootDir, null);
      if (!current) {
        console.log(`  ${red}Failed to analyze current state.${reset}\n`);
        return;
      }

      if (!opts.json) process.stdout.write(`\x1b[K  ${dim}Analyzing ${ref}...${reset}\r`);
      const target = await analyzeRef(rootDir, ref);
      if (!target) {
        console.log(`\x1b[K  ${red}Failed to analyze ${ref}. Check the ref exists.${reset}\n`);
        return;
      }

      if (!opts.json) process.stdout.write(`\x1b[K`);

      if (opts.json) {
        console.log(JSON.stringify({ current, target, ref }, null, 2));
        return;
      }

      const rows = [
        ["Health score", String(current.score) + " (" + current.grade + ")", String(target.score) + " (" + target.grade + ")", formatScoreDelta(current.score, target.score)],
        ["Files", String(current.files), String(target.files), formatDelta(current.files, target.files)],
        ["Cycles", String(current.cycles), String(target.cycles), formatDelta(current.cycles, target.cycles)],
        ["God files", String(current.godFiles), String(target.godFiles), formatDelta(current.godFiles, target.godFiles)],
        ["Orphans", String(current.orphans), String(target.orphans), formatDelta(current.orphans, target.orphans)],
      ];

      const col0 = 20;
      const col1 = 14;
      const col2 = 14;

      console.log(`  ${"Metric".padEnd(col0)} ${"Current".padEnd(col1)} ${"Target".padEnd(col2)} Delta`);
      console.log(`  ${"─".repeat(col0 + col1 + col2 + 10)}`);
      for (const [label, cur, tgt, delta] of rows) {
        console.log(`  ${label.padEnd(col0)} ${cur.padEnd(col1)} ${tgt.padEnd(col2)} ${delta}`);
      }

      const currentCycleKeys = new Set(current.cycleDetails.map((c) => c.cycle.sort().join("|")));
      const targetCycleKeys = new Set(target.cycleDetails.map((c) => c.cycle.sort().join("|")));
      const newCycles = current.cycleDetails.filter((c) => !targetCycleKeys.has(c.cycle.sort().join("|")));
      const removedCycles = target.cycleDetails.filter((c) => !currentCycleKeys.has(c.cycle.sort().join("|")));

      if (newCycles.length > 0) {
        console.log(`\n  ${red}New cycles (${newCycles.length}):${reset}`);
        for (const c of newCycles.slice(0, 5)) {
          console.log(`    ${red}+${reset} ${c.cycle.join(" → ")} ${dim}(${c.severity})${reset}`);
        }
      }

      if (removedCycles.length > 0) {
        console.log(`\n  ${green}Resolved cycles (${removedCycles.length}):${reset}`);
        for (const c of removedCycles.slice(0, 5)) {
          console.log(`    ${green}✓${reset} ${c.cycle.join(" → ")} ${dim}(${c.severity})${reset}`);
        }
      }

      const currentGodSet = new Set(current.godFileDetails.map((g) => g.file));
      const targetGodSet = new Set(target.godFileDetails.map((g) => g.file));
      const newGods = current.godFileDetails.filter((g) => !targetGodSet.has(g.file));
      const removedGods = target.godFileDetails.filter((g) => !currentGodSet.has(g.file));

      if (newGods.length > 0) {
        console.log(`\n  ${red}New god files (${newGods.length}):${reset}`);
        for (const g of newGods) {
          console.log(`    ${red}+${reset} ${g.file} ${dim}(${g.totalConnections} connections)${reset}`);
        }
      }

      if (removedGods.length > 0) {
        console.log(`\n  ${green}No longer god files (${removedGods.length}):${reset}`);
        for (const g of removedGods) {
          console.log(`    ${green}✓${reset} ${g.file}`);
        }
      }

      // ── Final Summary ──
      const scoreDelta = current.score - target.score;
      console.log();
      if (scoreDelta > 0) {
        console.log(`  ${green}▲ Architecture improved by ${scoreDelta} point(s)${reset}`);
      } else if (scoreDelta < 0) {
        console.log(`  ${red}▼ Architecture degraded by ${Math.abs(scoreDelta)} point(s)${reset}`);
      } else {
        console.log(`  ${dim}Architecture health unchanged${reset}`);
      }
      console.log();
    });
}
