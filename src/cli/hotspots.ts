import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject, analyzeHotspots, type HotspotRisk } from "../core/index.js";

export function registerHotspotsCommand(program: Command): void {
  program
    .command("hotspots")
    .description("Find high-risk files — change frequently AND affect many files")
    .argument("[dir]", "Project root directory", ".")
    .option("-n, --limit <n>", "Number of hotspots to show", "15")
    .option("--commits <n>", "Number of git commits to analyze", "200")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { limit: string; commits: string; json?: boolean }) => {
      const rootDir = resolve(dir);
      const limit = parseInt(opts.limit, 10);
      const maxCommits = parseInt(opts.commits, 10);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mAnalyzing hotspots...\x1b[0m\r`);

      const { graph, stats } = await analyzeProject(rootDir);
      const report = analyzeHotspots(graph, rootDir, maxCommits);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      process.stdout.write(`\x1b[K`);
      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";

      console.log(`  ${bold}Impulse — Hotspot Analysis${reset}`);
      console.log(`  ${stats.filesScanned} files, ${report.commitsAnalyzed} commits analyzed in ${stats.durationMs}ms\n`);

      if (report.hotspots.length === 0) {
        console.log("  No hotspots found (no git history or no impactful changes).\n");
        return;
      }

      const riskColors: Record<HotspotRisk, string> = {
        critical: "\x1b[31m", high: "\x1b[33m", medium: "\x1b[36m", low: "\x1b[2m",
      };
      const barLen = 20;
      const shown = report.hotspots.slice(0, limit);
      const maxScore = shown[0]?.score ?? 1;

      for (const h of shown) {
        const color = riskColors[h.risk];
        const filled = Math.max(1, Math.round((h.score / Math.max(maxScore, 1)) * barLen));
        const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
        const label = h.risk.toUpperCase().padEnd(8);
        console.log(`  ${color}${bar}${reset}  ${bold}${h.file}${reset}`);
        console.log(`  ${dim}${h.changes} changes · ${h.affected} affected · score ${h.score} · ${color}${label}${reset}`);
        console.log();
      }

      const byRisk = (r: HotspotRisk) => report.hotspots.filter((h) => h.risk === r).length;
      const critical = byRisk("critical");
      const high = byRisk("high");
      const medium = byRisk("medium");

      const parts: string[] = [];
      if (critical > 0) parts.push(`\x1b[31m${critical} critical${reset}`);
      if (high > 0) parts.push(`\x1b[33m${high} high${reset}`);
      if (medium > 0) parts.push(`\x1b[36m${medium} medium${reset}`);
      if (parts.length > 0) {
        console.log(`  ${parts.join("  ·  ")}`);
      }

      if (report.hotspots.length > limit) {
        console.log(`  ${dim}...and ${report.hotspots.length - limit} more (use --limit to show all)${reset}`);
      }
      console.log();
    });
}
