import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeHealth } from "../core/health.js";
import { loadConfig } from "../core/config.js";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Analyze project architecture health — cycles, god files, coupling")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { json?: boolean }) => {
      const rootDir = resolve(dir);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mAnalyzing architecture...\x1b[0m\r`);

      const [{ graph, stats }, config] = await Promise.all([
        analyzeProject(rootDir),
        loadConfig(rootDir),
      ]);
      const report = analyzeHealth(graph, config.boundaries);

      if (opts.json) {
        console.log(JSON.stringify({ ...report, analysisMs: stats.durationMs, filesAnalyzed: stats.filesScanned }, null, 2));
        return;
      }

      process.stdout.write(`\x1b[K`);
      console.log(`  Impulse — Architecture Health Report`);
      console.log(`  ${stats.filesScanned} files analyzed in ${stats.durationMs}ms\n`);

      const gradeColors: Record<string, string> = {
        A: "\x1b[32m", B: "\x1b[32m", C: "\x1b[33m", D: "\x1b[33m", F: "\x1b[31m",
      };
      const color = gradeColors[report.grade] ?? "";
      const reset = "\x1b[0m";
      const dim = "\x1b[2m";

      console.log(`  Score: ${color}${report.score}/100 (${report.grade})${reset}`);
      console.log(`  ${report.summary}\n`);

      const p = report.penalties;
      const penaltyLines: string[] = [];
      if (p.cycles > 0) penaltyLines.push(`    Cycles:            -${p.cycles}`);
      if (p.godFiles > 0) penaltyLines.push(`    God files:         -${p.godFiles}`);
      if (p.deepChains > 0) penaltyLines.push(`    Deep chains:       -${p.deepChains}`);
      if (p.orphans > 0) penaltyLines.push(`    Orphans:           -${p.orphans}`);
      if (p.hubConcentration > 0) penaltyLines.push(`    Hub concentration: -${p.hubConcentration}`);
      if (p.stabilityViolations > 0) penaltyLines.push(`    SDP violations:    -${p.stabilityViolations}`);
      if (penaltyLines.length > 0) {
        console.log("  Penalties:");
        for (const line of penaltyLines) console.log(line);
        console.log();
      }

      console.log("  Stats:");
      console.log(`    Files:             ${report.stats.totalFiles}`);
      console.log(`    Local edges:       ${report.stats.localEdges}`);
      console.log(`    External edges:    ${report.stats.externalEdges}`);
      console.log(`    Avg imports:       ${report.stats.avgImports}`);
      console.log(`    Avg imported by:   ${report.stats.avgImportedBy}`);
      console.log(`    Max imports:       ${report.stats.maxImports}`);
      console.log(`    Max imported by:   ${report.stats.maxImportedBy}`);

      if (report.cycles.length > 0) {
        console.log(`\n  ⚠ Circular Dependencies (${report.cycles.length}):\n`);
        for (const cycle of report.cycles.slice(0, 10)) {
          const display = cycle.severity === "tight-couple"
            ? `${cycle.cycle[0]} ↔ ${cycle.cycle[1]}`
            : cycle.cycle.join(" → ");
          console.log(`    ${display}  ${dim}(${cycle.severity})${reset}`);
        }
        if (report.cycles.length > 10) {
          console.log(`    ...and ${report.cycles.length - 10} more`);
        }
      }

      if (report.godFiles.length > 0) {
        console.log(`\n  ⚠ God Files (high coupling):\n`);
        for (const gf of report.godFiles) {
          const bar = "█".repeat(Math.min(gf.totalConnections, 40));
          console.log(`    ${gf.file}`);
          console.log(`      ${gf.importedBy} dependents, ${gf.imports} imports  ${bar}`);
        }
      }

      if (report.deepestChains.length > 0) {
        console.log(`\n  Deepest dependency chains:\n`);
        for (const dc of report.deepestChains.slice(0, 5)) {
          console.log(`    Depth ${dc.maxDepth}: ${dc.chain.join(" → ")}`);
        }
      }

      if (report.orphans.length > 0) {
        console.log(`\n  Isolated files (no local imports or dependents): ${report.orphans.length}\n`);
        for (const o of report.orphans) {
          console.log(`    ${o}`);
        }
      }

      if (report.stability && report.stability.modules.length > 0) {
        const cyan = "\x1b[36m";
        const green = "\x1b[32m";
        const red = "\x1b[31m";
        const barLen = 20;

        console.log(`\n  Module Stability ${dim}(Stable Dependencies Principle)${reset}\n`);

        const maxNameLen = Math.max(...report.stability.modules.map((m) => m.name.length));

        for (const m of report.stability.modules) {
          const stable = Math.round((1 - m.instability) * barLen);
          const bar = "█".repeat(stable) + "░".repeat(barLen - stable);
          const name = m.name.padEnd(maxNameLen);
          const label = m.instability === 0 ? `${dim}(maximally stable)${reset}`
            : m.instability === 1 ? `${dim}(maximally unstable)${reset}` : "";
          console.log(`    ${cyan}${name}${reset}  ${bar}  I=${m.instability.toFixed(2)}  ${label}`);
        }

        if (report.stability.violations.length > 0) {
          console.log(`\n  ${red}⚠ ${report.stability.violations.length} stability violation(s):${reset}\n`);
          for (const v of report.stability.violations) {
            console.log(`    ${v.from} ${dim}(I=${v.fromInstability.toFixed(2)})${reset} → ${v.to} ${dim}(I=${v.toInstability.toFixed(2)})${reset}`);
            console.log(`      ${dim}Stable module depends on less stable module${reset}`);
          }
        } else {
          console.log(`\n  ${green}✓ Dependencies flow toward stability.${reset}`);
        }
      }

      console.log();
      console.log(`  \x1b[2mTry: impulse suggest .  ·  impulse check .  ·  impulse visualize .\x1b[0m\n`);
    });
}
