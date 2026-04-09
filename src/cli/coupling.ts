import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/index.js";
import { analyzeCoupling, type CouplingPair } from "../core/coupling.js";

export function registerCouplingCommand(program: Command): void {
  program
    .command("coupling")
    .description("Find hidden coupling — files that co-change in git but have no import relationship")
    .argument("[dir]", "Project root directory", ".")
    .option("--commits <n>", "Number of git commits to analyze", "300")
    .option("--min-cochanges <n>", "Minimum co-changes to report", "3")
    .option("--min-ratio <n>", "Minimum coupling ratio (0-1)", "0.3")
    .option("--all", "Show confirmed coupling too, not just hidden")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: {
      commits: string; minCochanges: string; minRatio: string;
      all?: boolean; json?: boolean;
    }) => {
      const rootDir = resolve(dir);
      const maxCommits = parseInt(opts.commits, 10);
      const minCochanges = parseInt(opts.minCochanges, 10);
      const minRatio = parseFloat(opts.minRatio);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mAnalyzing coupling...\x1b[0m\r`);

      const { graph, stats } = await analyzeProject(rootDir);
      const report = analyzeCoupling(graph, rootDir, maxCommits, minCochanges, minRatio);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
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

      console.log(`  ${bold}Impulse — Coupling Analysis${reset}`);
      console.log(`  ${stats.filesScanned} files, ${report.commitsAnalyzed} commits  ${dim}(${stats.durationMs}ms)${reset}\n`);

      const shown = opts.all ? report.pairs : report.hidden;

      if (shown.length === 0) {
        if (opts.all) {
          console.log(`  ${green}✓ No temporal coupling detected above thresholds.${reset}\n`);
        } else {
          console.log(`  ${green}✓ No hidden coupling found.${reset}`);
          console.log(`  ${dim}All co-changing files have explicit import relationships.${reset}\n`);
        }
        return;
      }

      if (report.hidden.length > 0) {
        console.log(`  ${red}Hidden coupling${reset} ${dim}— co-change in git, NO import relationship:${reset}\n`);
        for (const p of report.hidden.slice(0, 15)) {
          printPair(p, { dim, reset, bold, red, yellow, cyan });
        }
        if (report.hidden.length > 15) {
          console.log(`  ${dim}...and ${report.hidden.length - 15} more${reset}\n`);
        }
      }

      if (opts.all) {
        const confirmed = report.pairs.filter((p) => p.kind === "confirmed");
        if (confirmed.length > 0) {
          console.log(`  ${cyan}Confirmed coupling${reset} ${dim}— co-change AND import relationship:${reset}\n`);
          for (const p of confirmed.slice(0, 10)) {
            printPair(p, { dim, reset, bold, red, yellow, cyan });
          }
          if (confirmed.length > 10) {
            console.log(`  ${dim}...and ${confirmed.length - 10} more${reset}\n`);
          }
        }
      }

      console.log(`  ${dim}Summary: ${report.hidden.length} hidden, ${report.pairs.length - report.hidden.length} confirmed${reset}`);
      if (report.hidden.length > 0) {
        console.log(`  ${dim}Hidden coupling often means a shared concept that should be an explicit module.${reset}`);
      }
      console.log();
    });
}

function printPair(
  p: CouplingPair,
  c: { dim: string; reset: string; bold: string; red: string; yellow: string; cyan: string },
): void {
  const pct = Math.round(p.couplingRatio * 100);
  const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
  const color = p.kind === "hidden" ? c.red : c.cyan;

  console.log(`  ${color}${bar}${c.reset}  ${c.bold}${pct}%${c.reset}  ${c.dim}(${p.cochanges} co-changes)${c.reset}`);
  console.log(`    ${p.fileA}`);
  console.log(`    ${p.fileB}`);
  console.log();
}
