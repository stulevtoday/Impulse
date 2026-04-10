import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeRisk, type RiskLevel } from "../core/risk.js";

export function registerRiskCommand(program: Command): void {
  program
    .command("risk")
    .description("Unified risk analysis — complexity × churn × impact × coupling in one view")
    .argument("[dir]", "Project root directory", ".")
    .option("-n, --limit <n>", "Number of files to show", "15")
    .option("--risk <level>", "Filter by minimum risk: low, medium, high, critical")
    .option("--commits <n>", "Number of git commits to analyze", "300")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { limit: string; risk?: string; commits: string; json?: boolean }) => {
      const rootDir = resolve(dir);
      const limit = parseInt(opts.limit, 10);
      const maxCommits = parseInt(opts.commits, 10);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mAnalyzing risk across 4 dimensions...\x1b[0m\r`);

      const report = await analyzeRisk(rootDir, maxCommits);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      process.stdout.write(`\x1b[K`);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";

      console.log(`  ${bold}Impulse — Risk Analysis${reset}`);
      console.log(`  ${report.totalFiles} files analyzed in ${report.durationMs}ms\n`);

      let filtered = report.files;
      if (opts.risk) {
        const minRisk = RISK_ORDER[opts.risk as RiskLevel] ?? 0;
        filtered = filtered.filter((f) => RISK_ORDER[f.risk] >= minRisk);
      }

      if (filtered.length === 0 || report.totalFiles === 0) {
        console.log("  No at-risk files found.\n");
        return;
      }

      const shown = filtered.slice(0, limit);
      const maxScore = Math.max(1, shown[0]?.score ?? 1);
      const barLen = 22;

      for (const f of shown) {
        if (f.score === 0) continue;
        const filled = Math.max(1, Math.round((f.score / maxScore) * barLen));
        const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
        const color = RISK_COLORS[f.risk];
        const label = f.risk.toUpperCase();

        console.log(`  ${color}${bar}${reset}  ${bold}${f.file}${reset}`);
        console.log(`  ${dim}risk ${f.score}/100 · ${color}${label}${reset}`);

        const d = f.dimensions;
        const parts: string[] = [];
        if (d.complexity > 0) parts.push(`${dimLabel("complexity", d.complexity)}`);
        if (d.churn > 0) parts.push(`${dimLabel("churn", d.churn)}`);
        if (d.impact > 0) parts.push(`${dimLabel("impact", d.impact)}`);
        if (d.coupling > 0) parts.push(`${dimLabel("coupling", d.coupling)}`);
        if (parts.length > 0) {
          console.log(`  ${dim}${parts.join(" │ ")}${reset}`);
        }
        console.log();
      }

      // Distribution
      const { distribution: dist } = report;
      console.log(`  ${bold}Summary${reset}`);

      const summaryParts: string[] = [];
      if (dist.critical > 0) summaryParts.push(`${RISK_COLORS.critical}${dist.critical} critical${reset}`);
      if (dist.high > 0) summaryParts.push(`${RISK_COLORS.high}${dist.high} high${reset}`);
      if (dist.medium > 0) summaryParts.push(`${RISK_COLORS.medium}${dist.medium} medium${reset}`);
      summaryParts.push(`${dim}${dist.low} low${reset}`);
      console.log(`  ${summaryParts.join("  ·  ")}`);

      if (filtered.length > limit) {
        console.log(`  ${dim}...and ${filtered.length - limit} more (use --limit to show all)${reset}`);
      }

      if (dist.critical > 0) {
        console.log();
        console.log(`  ${RISK_COLORS.critical}${dist.critical} file(s) need immediate attention${reset} ${dim}(high complexity + frequent changes + large blast radius)${reset}`);
      }

      console.log();
    });
}

const RISK_COLORS: Record<RiskLevel, string> = {
  critical: "\x1b[31m",
  high: "\x1b[33m",
  medium: "\x1b[36m",
  low: "\x1b[2m",
};

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function dimLabel(name: string, value: number): string {
  const short = name.slice(0, 4);
  const bar = miniBar(value);
  return `${short} ${bar} ${value}`;
}

function miniBar(value: number): string {
  const filled = Math.round(value / 20);
  return "▓".repeat(filled) + "░".repeat(5 - filled);
}
