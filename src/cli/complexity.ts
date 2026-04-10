import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeComplexity, type ComplexityRisk, type FunctionComplexity } from "../core/complexity.js";

export function registerComplexityCommand(program: Command): void {
  program
    .command("complexity")
    .description("Analyze cyclomatic and cognitive complexity per function across all files")
    .argument("[dir]", "Project root directory", ".")
    .option("-n, --limit <n>", "Number of top functions to show", "20")
    .option("--threshold <n>", "Only show functions with cognitive complexity above this", "0")
    .option("--risk <level>", "Filter by minimum risk: simple, moderate, complex, alarming")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { limit: string; threshold: string; risk?: string; json?: boolean }) => {
      const rootDir = resolve(dir);
      const limit = parseInt(opts.limit, 10);
      const threshold = parseInt(opts.threshold, 10);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mAnalyzing complexity...\x1b[0m\r`);

      const report = await analyzeComplexity(rootDir);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      process.stdout.write(`\x1b[K`);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";

      console.log(`  ${bold}Impulse — Complexity Analysis${reset}`);
      console.log(`  ${report.files.length} files, ${report.totalFunctions} functions analyzed\n`);

      if (report.totalFunctions === 0) {
        console.log("  No functions found to analyze.\n");
        return;
      }

      let filtered = report.functions.filter((f) => f.cognitive > threshold);

      if (opts.risk) {
        const minRisk = RISK_ORDER[opts.risk as ComplexityRisk] ?? 0;
        filtered = filtered.filter((f) => RISK_ORDER[f.risk] >= minRisk);
      }

      if (filtered.length === 0) {
        console.log(`  No functions above threshold ${threshold}.\n`);
        return;
      }

      const shown = filtered.slice(0, limit);
      const maxCog = shown[0]?.cognitive ?? 1;
      const barLen = 20;

      for (const fn of shown) {
        const filled = Math.max(1, Math.round((fn.cognitive / Math.max(maxCog, 1)) * barLen));
        const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
        const color = RISK_COLORS[fn.risk];
        const label = fn.risk.toUpperCase().padEnd(8);
        console.log(`  ${color}${bar}${reset}  ${bold}${fn.filePath}${reset} → ${fn.name}`);
        console.log(`  ${dim}${fn.lineCount} lines · cyclomatic ${fn.cyclomatic} · cognitive ${fn.cognitive} · ${color}${label}${reset}`);
        console.log();
      }

      // Distribution
      const d = report.distribution;
      const total = report.totalFunctions;
      const distBarLen = 24;

      console.log(`  ${bold}Distribution${reset}`);
      printDistLine("simple", d.simple, total, distBarLen, RISK_COLORS.simple);
      printDistLine("moderate", d.moderate, total, distBarLen, RISK_COLORS.moderate);
      printDistLine("complex", d.complex, total, distBarLen, RISK_COLORS.complex);
      printDistLine("alarming", d.alarming, total, distBarLen, RISK_COLORS.alarming);
      console.log();

      console.log(`  ${dim}Average: cyclomatic ${report.avgCyclomatic} · cognitive ${report.avgCognitive}${reset}`);

      if (filtered.length > limit) {
        console.log(`  ${dim}...and ${filtered.length - limit} more (use --limit to show all)${reset}`);
      }

      if (d.alarming > 0 || d.complex > 0) {
        console.log();
        const urgent = d.alarming + d.complex;
        console.log(`  ${RISK_COLORS.complex}${urgent} function(s) need attention${reset} ${dim}(cognitive > 10)${reset}`);
      }

      console.log();
    });
}

const RISK_COLORS: Record<ComplexityRisk, string> = {
  simple: "\x1b[32m",
  moderate: "\x1b[36m",
  complex: "\x1b[33m",
  alarming: "\x1b[31m",
};

const RISK_ORDER: Record<ComplexityRisk, number> = {
  simple: 0,
  moderate: 1,
  complex: 2,
  alarming: 3,
};

function printDistLine(label: string, count: number, total: number, barLen: number, color: string): void {
  const reset = "\x1b[0m";
  const dim = "\x1b[2m";
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const filled = total > 0 ? Math.max(0, Math.round((count / total) * barLen)) : 0;
  const bar = "█".repeat(filled) + " ".repeat(barLen - filled);
  const countStr = String(count).padStart(4);
  console.log(`  ${color}${label.padEnd(10)}${bar}${reset} ${countStr} ${dim}(${pct}%)${reset}`);
}
