import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { focusFile } from "../core/focus.js";

export function registerFocusCommand(program: Command): void {
  program
    .command("focus")
    .description("Deep analysis of a single file — imports, exports, impact, tests, git history")
    .argument("<file>", "Relative path to the file")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .action(async (file: string, dir: string, opts: { json?: boolean }) => {
      const rootDir = resolve(dir);
      const { graph, stats } = await analyzeProject(rootDir);
      const report = focusFile(graph, file, rootDir);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const cyan = "\x1b[36m";
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const yellow = "\x1b[33m";

      console.log(`\n  ${bold}Impulse — Focus: ${file}${reset}  ${dim}(${stats.durationMs}ms)${reset}\n`);

      if (!report.exists) {
        console.log(`  ${red}File not found in the dependency graph.${reset}\n`);
        return;
      }

      // ── Connections ──
      const localImports = report.imports.filter((i) => i.includes("/"));
      const externalImports = report.imports.filter((i) => !i.includes("/"));

      console.log(`  ${cyan}Imports${reset}  ${bold}${localImports.length}${reset} local, ${dim}${externalImports.length} external${reset}`);
      for (const i of localImports) {
        console.log(`    → ${i}`);
      }
      if (externalImports.length > 0) {
        console.log(`    ${dim}${externalImports.join(", ")}${reset}`);
      }

      console.log(`\n  ${cyan}Imported by${reset}  ${bold}${report.importedBy.length}${reset} file(s)`);
      for (const f of report.importedBy.slice(0, 10)) {
        console.log(`    ← ${f}`);
      }
      if (report.importedBy.length > 10) {
        console.log(`    ${dim}...and ${report.importedBy.length - 10} more${reset}`);
      }

      // ── Exports ──
      if (report.exports.length > 0) {
        const dead = report.exports.filter((e) => e.dead);
        const alive = report.exports.filter((e) => !e.dead);

        console.log(`\n  ${cyan}Exports${reset}  ${bold}${report.exports.length}${reset} total${dead.length > 0 ? `, ${red}${dead.length} dead${reset}` : ""}`);
        for (const e of alive) {
          console.log(`    ${green}✓${reset} ${e.name}  ${dim}→ ${e.consumers.length} consumer(s)${reset}`);
        }
        for (const e of dead) {
          console.log(`    ${red}✗${reset} ${e.name}  ${dim}— unused${reset}`);
        }
      }

      // ── Blast radius ──
      console.log(`\n  ${cyan}Blast radius${reset}  ${bold}${report.blastRadius}${reset} file(s)`);
      if (Object.keys(report.impactByDepth).length > 0) {
        const maxDepth = Math.max(...Object.keys(report.impactByDepth).map(Number));
        const maxCount = Math.max(...Object.values(report.impactByDepth));
        for (let d = 1; d <= maxDepth; d++) {
          const count = report.impactByDepth[d] ?? 0;
          const bar = "█".repeat(Math.max(1, Math.round((count / maxCount) * 15)));
          const label = d === 1 ? "direct" : `depth ${d}`;
          console.log(`    ${bar} ${count}  ${dim}(${label})${reset}`);
        }
      }

      // ── Tests ──
      console.log(`\n  ${cyan}Test coverage${reset}  ${report.testsCovering.length > 0 ? `${green}${report.testsCovering.length} test(s)${reset}` : `${red}no tests${reset}`}`);
      for (const t of report.testsCovering) {
        console.log(`    ${green}⚡${reset} ${t}`);
      }

      // ── Git ──
      console.log(`\n  ${cyan}Git${reset}  ${report.gitChanges} change(s)${report.lastChanged ? `, last ${report.lastChanged}` : ""}`);
      if (report.topCochangers.length > 0) {
        console.log(`  ${dim}Often changes with:${reset}`);
        for (const c of report.topCochangers) {
          console.log(`    ${c.file}  ${dim}(${c.cochanges}×)${reset}`);
        }
      }

      console.log();
    });
}
