import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeDeps, type DepRisk } from "../core/deps.js";

export function registerDepsCommand(program: Command): void {
  program
    .command("deps")
    .description("External dependency analysis — supply chain risk, phantom deps, penetration")
    .argument("[dir]", "Project root directory", ".")
    .option("-n, --limit <n>", "Number of dependencies to show", "20")
    .option("--risk <level>", "Filter by minimum risk: low, medium, high, critical")
    .option("--phantoms", "Show only phantom deps (declared but unused in code)")
    .option("--surface", "Show only surface deps (used by exactly 1 file)")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { limit: string; risk?: string; phantoms?: boolean; surface?: boolean; json?: boolean }) => {
      const rootDir = resolve(dir);
      const limit = parseInt(opts.limit, 10);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mAnalyzing external dependencies...\x1b[0m\r`);

      const { graph } = await analyzeProject(rootDir);
      const report = await analyzeDeps(graph, rootDir);

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

      console.log(`  ${bold}Impulse — Dependency Analysis${reset}`);
      console.log(`  ${report.totalFiles} files, ${report.dependencies.length} external deps (${report.totalPackages} packages) in ${report.durationMs}ms\n`);

      // Phantoms mode
      if (opts.phantoms) {
        if (report.phantoms.length === 0) {
          console.log(`  ${green}✓ No phantom dependencies — everything declared is used.${reset}\n`);
        } else {
          console.log(`  ${yellow}⚠ ${report.phantoms.length} phantom dep(s)${reset} — declared in manifest but not imported in code:\n`);
          for (const p of report.phantoms) {
            console.log(`    ${red}✗${reset} ${bold}${p.name}${reset}  ${dim}(${p.source})${reset}`);
          }
          console.log(`\n  ${dim}These may be unused, or used indirectly (CLI tools, plugins, type-only).${reset}`);
        }
        console.log();
        return;
      }

      // Surface mode
      if (opts.surface) {
        if (report.surfaceDeps.length === 0) {
          console.log(`  ${green}✓ No surface dependencies — all packages are used by 2+ files.${reset}\n`);
        } else {
          console.log(`  ${cyan}${report.surfaceDeps.length} surface dep(s)${reset} — used by exactly 1 file (easy to swap):\n`);
          for (const dep of report.surfaceDeps) {
            console.log(`    ${bold}${dep.name}${reset}  ${dim}← ${dep.usedBy[0]}${reset}`);
          }
        }
        console.log();
        return;
      }

      // Supply chain risk overview
      if (report.topHeavy.length > 0) {
        console.log(`  ${bold}Supply Chain Risk${reset} — dependencies embedded in ≥20% of files\n`);

        for (const dep of report.topHeavy) {
          const barLen = 30;
          const filled = Math.max(1, Math.round((dep.penetration / 100) * barLen));
          const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
          const color = RISK_COLORS[dep.risk];
          const cat = dep.category === "builtin" ? `${dim}builtin${reset}` : "";

          console.log(`  ${color}${bar}${reset}  ${bold}${dep.name}${reset}  ${cat}`);
          console.log(`  ${dim}${dep.usageCount} file(s) · ${dep.penetration}% penetration · ${dep.risk.toUpperCase()}${reset}`);
          console.log();
        }
      }

      // Full list
      let filtered = report.dependencies;
      if (opts.risk) {
        const minRisk = RISK_ORDER[opts.risk as DepRisk] ?? 0;
        filtered = filtered.filter((d) => RISK_ORDER[d.risk] >= minRisk);
      }

      const shown = filtered.slice(0, limit);

      if (shown.length > 0) {
        console.log(`  ${bold}All Dependencies${reset} ${dim}(${filtered.length} total, showing ${shown.length})${reset}\n`);

        const maxName = Math.min(35, Math.max(...shown.map((d) => d.name.length)));
        const maxCount = Math.max(1, shown[0]?.usageCount ?? 1);

        for (const dep of shown) {
          const name = dep.name.length > 35 ? dep.name.slice(0, 32) + "..." : dep.name.padEnd(maxName);
          const barLen = 16;
          const filled = Math.max(1, Math.round((dep.usageCount / maxCount) * barLen));
          const bar = "▓".repeat(filled) + "░".repeat(barLen - filled);
          const color = RISK_COLORS[dep.risk];
          const catTag = dep.category === "builtin" ? `${dim}[builtin]${reset}` :
            dep.category === "system" ? `${dim}[system]${reset}` : "";

          console.log(`    ${color}${bar}${reset}  ${bold}${name}${reset}  ${dep.usageCount} file(s)  ${catTag}`);
        }

        if (filtered.length > limit) {
          console.log(`    ${dim}...and ${filtered.length - limit} more (use --limit to show all)${reset}`);
        }
      }

      // Clusters
      console.log(`\n  ${bold}Categories${reset}`);
      for (const c of report.clusters) {
        console.log(`    ${c.category.padEnd(10)}  ${c.count} dep(s), ${c.totalUsage} import(s)`);
      }

      // Summary
      const { riskDistribution: dist } = report;
      const summaryParts: string[] = [];
      if (dist.critical > 0) summaryParts.push(`${red}${dist.critical} critical${reset}`);
      if (dist.high > 0) summaryParts.push(`${yellow}${dist.high} high${reset}`);
      if (dist.medium > 0) summaryParts.push(`${cyan}${dist.medium} medium${reset}`);
      summaryParts.push(`${dim}${dist.low} low${reset}`);

      console.log(`\n  ${bold}Risk${reset}: ${summaryParts.join("  ·  ")}`);

      if (report.phantoms.length > 0) {
        console.log(`  ${yellow}⚠ ${report.phantoms.length} phantom dep(s)${reset} ${dim}— run impulse deps . --phantoms${reset}`);
      }
      if (report.surfaceDeps.length > 0) {
        console.log(`  ${dim}${report.surfaceDeps.length} surface dep(s) used by only 1 file — run impulse deps . --surface${reset}`);
      }

      console.log();
      console.log(`  ${dim}Try: impulse deps . --phantoms  ·  impulse deps . --surface  ·  impulse deps . --risk high${reset}\n`);
    });
}

const RISK_COLORS: Record<DepRisk, string> = {
  critical: "\x1b[31m",
  high: "\x1b[33m",
  medium: "\x1b[36m",
  low: "\x1b[2m",
};

const RISK_ORDER: Record<DepRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
