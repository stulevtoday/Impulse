import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeDebt, type DebtDimension, type DebtTrend } from "../core/debt.js";

export function registerDebtCommand(program: Command): void {
  program
    .command("debt")
    .description("Technical debt score — aggregated from 5 dimensions with trend tracking")
    .argument("[dir]", "Project root directory", ".")
    .option("--trend", "Show historical trend")
    .option("--budget <n>", "Fail if debt score exceeds this threshold (for CI)")
    .option("--commits <n>", "Number of git commits to analyze", "300")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { trend?: boolean; budget?: string; commits: string; json?: boolean }) => {
      const rootDir = resolve(dir);
      const maxCommits = parseInt(opts.commits, 10);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mCalculating technical debt...\x1b[0m\r`);

      const report = await analyzeDebt(rootDir, maxCommits);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        if (opts.budget) {
          const threshold = parseInt(opts.budget, 10);
          if (report.score > threshold) process.exit(1);
        }
        return;
      }

      process.stdout.write(`\x1b[K`);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const red = "\x1b[31m";
      const yellow = "\x1b[33m";
      const green = "\x1b[32m";
      const cyan = "\x1b[36m";

      const gradeColor = report.score <= 20 ? green : report.score <= 35 ? yellow : red;

      console.log(`  ${bold}Impulse — Technical Debt Report${reset}`);
      console.log(`  ${report.totalFiles} files analyzed in ${report.durationMs}ms\n`);

      // Score display
      const scoreBar = renderBar(report.score, 40);
      console.log(`  ${bold}Debt Score:${reset} ${gradeColor}${report.score}/100 (${report.grade})${reset}`);
      console.log(`  ${scoreBar}\n`);

      // Dimension breakdown
      console.log(`  ${bold}Dimensions${reset}\n`);

      const maxNameLen = Math.max(...report.dimensions.map((d) => d.name.length));

      for (const d of report.dimensions) {
        const name = d.name.padEnd(maxNameLen);
        const pct = Math.round(d.weight * 100);
        const bar = renderMiniBar(d.score);
        const color = d.score <= 15 ? green : d.score <= 35 ? yellow : d.score >= 60 ? red : cyan;
        console.log(`    ${color}${name}${reset}  ${bar}  ${bold}${d.score}${reset}/100  ${dim}(${pct}% weight)${reset}`);
        console.log(`    ${dim}${" ".repeat(maxNameLen)}  ${d.details}${reset}`);
      }

      // Top contributors
      if (report.topContributors.length > 0) {
        console.log(`\n  ${bold}Top Debt Contributors${reset}\n`);

        const shown = report.topContributors.slice(0, 10);
        const maxDebt = shown[0]?.debt ?? 1;

        for (const c of shown) {
          const filled = Math.max(1, Math.round((c.debt / maxDebt) * 18));
          const bar = "█".repeat(filled) + "░".repeat(18 - filled);
          const color = c.debt > maxDebt * 0.7 ? red : c.debt > maxDebt * 0.4 ? yellow : dim;
          console.log(`    ${color}${bar}${reset}  ${bold}${c.file}${reset}`);
          console.log(`    ${dim}debt ${c.debt} · ${c.reasons.slice(0, 3).join(", ")}${reset}`);
          if (c.reasons.length > 3) {
            console.log(`    ${dim}...and ${c.reasons.length - 3} more reason(s)${reset}`);
          }
          console.log();
        }
      }

      // Trend
      if (opts.trend && report.trend.snapshots.length > 1) {
        printTrend(report.trend);
      } else if (report.trend.snapshots.length > 1) {
        const arrow = report.trend.direction === "improving" ? `${green}↓` :
          report.trend.direction === "worsening" ? `${red}↑` : `${dim}→`;
        const sign = report.trend.delta > 0 ? "+" : "";
        console.log(`  ${bold}Trend:${reset} ${arrow} ${report.trend.direction}${reset} (${sign}${report.trend.delta} since last run)`);
      }

      // Budget check
      if (opts.budget) {
        const threshold = parseInt(opts.budget, 10);
        console.log();
        if (report.score > threshold) {
          console.log(`  ${red}✗ OVER BUDGET${reset}  debt ${report.score} exceeds threshold ${threshold}`);
          console.log();
          process.exit(1);
        } else {
          console.log(`  ${green}✓ WITHIN BUDGET${reset}  debt ${report.score} ≤ ${threshold}`);
        }
      }

      console.log();
      console.log(`  ${dim}Try: impulse debt . --trend  ·  impulse debt . --budget 30  ·  impulse suggest .${reset}\n`);
    });
}

function renderBar(score: number, width: number): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";

  const color = score <= 20 ? green : score <= 35 ? yellow : red;
  return `  ${color}${"█".repeat(filled)}${dim}${"░".repeat(empty)}${reset}`;
}

function renderMiniBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}

function printTrend(trend: DebtTrend): void {
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const cyan = "\x1b[36m";

  console.log(`\n  ${bold}Debt Trend${reset} ${dim}(${trend.snapshots.length} snapshots)${reset}\n`);

  const maxScore = Math.max(...trend.snapshots.map((s) => s.score), 1);
  const chartHeight = 8;
  const snapshots = trend.snapshots.slice(-20);

  for (let row = chartHeight; row >= 1; row--) {
    const threshold = Math.round((row / chartHeight) * maxScore);
    const label = String(threshold).padStart(3);
    let line = `    ${dim}${label}${reset} │`;

    for (const snap of snapshots) {
      const barHeight = Math.round((snap.score / maxScore) * chartHeight);
      if (barHeight >= row) {
        const color = snap.score <= 20 ? green : snap.score <= 35 ? yellow : red;
        line += `${color}█${reset}`;
      } else {
        line += " ";
      }
    }
    console.log(line);
  }

  const axis = `    ${dim}    └${"─".repeat(snapshots.length)}${reset}`;
  console.log(axis);

  const arrow = trend.direction === "improving" ? `${green}↓ improving` :
    trend.direction === "worsening" ? `${red}↑ worsening` : `${cyan}→ stable`;
  const sign = trend.delta > 0 ? "+" : "";
  console.log(`    ${dim}     ${arrow}${reset} ${dim}(${sign}${trend.delta} since previous)${reset}`);
}
