import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeSafeDelete, type SafetyVerdict } from "../core/safe-delete.js";

export function registerSafeDeleteCommand(program: Command): void {
  program
    .command("safe-delete")
    .description("Check if a file can be safely deleted — shows dependents, exports, and blast radius")
    .argument("<file>", "File to check")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .action(async (file: string, dir: string, opts: { json?: boolean }) => {
      const rootDir = resolve(dir);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const cyan = "\x1b[36m";
      const green = "\x1b[32m";
      const yellow = "\x1b[33m";
      const red = "\x1b[31m";

      if (!opts.json) process.stdout.write(`\n  ${dim}Analyzing...${reset}\r`);

      const { graph } = await analyzeProject(rootDir);
      const report = analyzeSafeDelete(graph, file);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      process.stdout.write(`\r\x1b[K`);

      console.log(`  ${bold}Impulse — Safe Delete Analysis${reset}\n`);
      console.log(`  File: ${cyan}${file}${reset}\n`);

      if (!report.exists) {
        console.log(`  ${yellow}File not found in the dependency graph.${reset}`);
        console.log(`  ${green}Safe to delete${reset} — not tracked by Impulse.\n`);
        return;
      }

      // ── Verdict ──
      const verdictColors: Record<SafetyVerdict, string> = {
        safe: green, caution: yellow, risky: red, dangerous: red,
      };
      const verdictIcons: Record<SafetyVerdict, string> = {
        safe: "✓", caution: "⚠", risky: "⚠", dangerous: "✗",
      };
      const vc = verdictColors[report.verdict];
      console.log(`  ${vc}${verdictIcons[report.verdict]} ${report.verdict.toUpperCase()}${reset} — ${report.reason}\n`);

      // ── Dependents ──
      if (report.importedBy.length > 0) {
        console.log(`  ${bold}Imported by${reset} ${dim}(${report.importedBy.length})${reset}`);
        for (const f of report.importedBy.slice(0, 10)) {
          console.log(`    ${red}←${reset} ${f}`);
        }
        if (report.importedBy.length > 10) {
          console.log(`    ${dim}...and ${report.importedBy.length - 10} more${reset}`);
        }
        console.log();
      }

      // ── Exports ──
      if (report.exports.length > 0) {
        console.log(`  ${bold}Exports${reset} ${dim}(${report.liveExportCount} alive, ${report.deadExportCount} dead)${reset}`);
        for (const exp of report.exports) {
          if (exp.dead) {
            console.log(`    ${red}✗${reset} ${exp.name} ${dim}— unused${reset}`);
          } else {
            console.log(`    ${green}✓${reset} ${exp.name} ${dim}— ${exp.consumers.length} consumer(s)${reset}`);
          }
        }
        console.log();
      }

      // ── Blast Radius ──
      if (report.blastRadius > 0) {
        console.log(`  ${bold}Blast radius:${reset} ${report.blastRadius} file(s) transitively affected`);
        console.log();
      }

      // ── Tests ──
      if (report.testsCovering.length > 0) {
        console.log(`  ${bold}Tests covering this file:${reset} ${report.testsCovering.length}`);
        for (const t of report.testsCovering.slice(0, 5)) {
          console.log(`    ${green}⚡${reset} ${t}`);
        }
        console.log();
      }

      // ── Recommendations ──
      if (report.recommendations.length > 0) {
        console.log(`  ${bold}Recommendations:${reset}`);
        for (let i = 0; i < report.recommendations.length; i++) {
          console.log(`    ${yellow}${i + 1}.${reset} ${report.recommendations[i]}`);
        }
        console.log();
      }
    });
}
