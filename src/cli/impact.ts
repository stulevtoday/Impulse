import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject, getFileImpact } from "../core/analyzer.js";

export function registerImpactCommand(program: Command): void {
  program
    .command("impact")
    .description("Show what is affected by changing a file (or a specific export)")
    .argument("<file>", "Relative path to the changed file")
    .argument("[dir]", "Project root directory", ".")
    .option("-d, --depth <n>", "Maximum traversal depth", "5")
    .option("-s, --symbol <name>", "Specific export name (symbol-level precision)")
    .option("--json", "Output as JSON")
    .action(async (file: string, dir: string, opts: { depth: string; symbol?: string; json?: boolean }) => {
      const rootDir = resolve(dir);
      const maxDepth = parseInt(opts.depth, 10);

      const { graph, stats } = await analyzeProject(rootDir);

      if (opts.symbol) {
        const impact = graph.analyzeExportImpact(file, opts.symbol, maxDepth);
        const fileAffected = impact.affected.filter((a) => a.node.kind === "file");

        if (opts.json) {
          console.log(JSON.stringify({
            changed: file,
            symbol: opts.symbol,
            affected: fileAffected.map((a) => ({ file: a.node.filePath, depth: a.depth })),
            count: fileAffected.length,
            analysisMs: stats.durationMs,
          }, null, 2));
          return;
        }

        const allExports = graph.getFileExports(file);
        const fileImpact = getFileImpact(graph, file, maxDepth);
        const totalFileAffected = fileImpact.affected.filter((a) => a.node.kind === "file").length;

        console.log(`\n  Impulse — symbol-level impact\n`);
        console.log(`  File:    ${file}`);
        console.log(`  Symbol:  ${opts.symbol}`);

        if (fileAffected.length === 0) {
          console.log(`\n  No files depend on this export.\n`);
        } else {
          console.log(`\n  \x1b[36m${fileAffected.length}\x1b[0m file(s) affected (vs ${totalFileAffected} at file level — \x1b[32m${Math.round((1 - fileAffected.length / Math.max(totalFileAffected, 1)) * 100)}% more precise\x1b[0m)\n`);
          for (const item of fileAffected) {
            const depthLabel = item.depth === 1 ? "direct" : `depth ${item.depth}`;
            console.log(`    → ${item.node.filePath}  (${depthLabel})`);
          }
        }

        if (allExports.length > 1) {
          console.log(`\n  Other exports in ${file}:`);
          for (const exp of allExports) {
            if (exp.name === opts.symbol) continue;
            const symImpact = graph.analyzeExportImpact(file, exp.name, maxDepth);
            const symFiles = symImpact.affected.filter((a) => a.node.kind === "file").length;
            console.log(`    ${exp.name}  → ${symFiles} file(s)`);
          }
        }

        console.log(`\n  ${stats.durationMs}ms\n`);
        return;
      }

      const impact = getFileImpact(graph, file, maxDepth);

      if (opts.json) {
        console.log(JSON.stringify({
          changed: file,
          affected: impact.affected.map((a) => ({ file: a.node.filePath, depth: a.depth })),
          count: impact.affected.length,
          analysisMs: stats.durationMs,
        }, null, 2));
        return;
      }

      console.log(`\n  Impulse — analyzing impact of ${file}\n`);

      if (impact.affected.length === 0) {
        console.log("  No dependents found. This file is a leaf node.\n");
        return;
      }

      console.log(`  Changing ${file} affects:\n`);
      for (const item of impact.affected) {
        const indent = "  ".repeat(item.depth);
        const depthLabel = item.depth === 1 ? "direct" : `depth ${item.depth}`;
        console.log(`  ${indent}→ ${item.node.filePath}  (${depthLabel})`);
      }

      const exports = graph.getFileExports(file);
      if (exports.length > 0) {
        console.log(`\n  Tip: use --symbol <name> for precision. Exports in this file:`);
        for (const exp of exports) {
          const symImpact = graph.analyzeExportImpact(file, exp.name, maxDepth);
          const symFiles = symImpact.affected.filter((a) => a.node.kind === "file").length;
          console.log(`    ${exp.name}  → ${symFiles} file(s)`);
        }
      }

      console.log(
        `\n  Total: ${impact.affected.length} affected nodes (scanned ${stats.filesScanned} files in ${stats.durationMs}ms)\n`,
      );
    });
}
