import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";

export function registerExportsCommand(program: Command): void {
  program
    .command("exports")
    .description("Show exports per file — who uses each, and which are dead")
    .argument("[dir]", "Project root directory", ".")
    .option("-f, --file <path>", "Show exports for a specific file only")
    .action(async (dir: string, opts: { file?: string }) => {
      const rootDir = resolve(dir);
      const { graph, stats } = await analyzeProject(rootDir);

      const exportNodes = graph.allNodes().filter((n) => n.kind === "export");
      const allEdges = graph.allEdges();

      const barrelFiles = new Set<string>();
      for (const fileNode of graph.allNodes().filter((n) => n.kind === "file")) {
        const deps = graph.getDependencies(fileNode.id).filter((e) => e.kind === "imports");
        if (deps.length > 0 && deps.every((e) => (e.metadata as Record<string, unknown>)?.reexport === true)) {
          barrelFiles.add(fileNode.filePath);
        }
      }

      const exportsByFile = new Map<string, Array<{ name: string; users: string[]; barrel: boolean }>>();
      for (const exp of exportNodes) {
        const users = allEdges
          .filter((e) => e.to === exp.id && e.kind === "uses_export")
          .map((e) => e.from.replace(/^file:/, ""));

        const list = exportsByFile.get(exp.filePath) ?? [];
        list.push({ name: exp.name, users, barrel: barrelFiles.has(exp.filePath) });
        exportsByFile.set(exp.filePath, list);
      }

      const files = opts.file
        ? [[opts.file, exportsByFile.get(opts.file) ?? []] as const]
        : [...exportsByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));

      let totalExports = 0;
      let deadExports = 0;
      let barrelExports = 0;

      console.log(`\n  Impulse — Export Analysis (${stats.filesScanned} files, ${stats.durationMs}ms)\n`);

      for (const [file, exports] of files) {
        if (exports.length === 0) continue;
        const isBarrel = barrelFiles.has(file);
        const dead = exports.filter((e) => e.users.length === 0 && !e.barrel);
        const barrelUnused = exports.filter((e) => e.users.length === 0 && e.barrel);
        totalExports += exports.length;
        deadExports += dead.length;
        barrelExports += barrelUnused.length;

        const label = isBarrel ? " \x1b[2m[barrel]\x1b[0m" : "";
        const deadLabel = dead.length > 0 ? `, \x1b[31m${dead.length} dead\x1b[0m` : "";
        console.log(`  ${file}${label}  (${exports.length} exports${deadLabel})`);

        for (const exp of exports.sort((a, b) => b.users.length - a.users.length)) {
          if (exp.users.length > 0) {
            console.log(`    \x1b[32m✓\x1b[0m ${exp.name}  — ${exp.users.length} user(s)`);
            for (const user of exp.users.slice(0, 5)) {
              console.log(`        ← ${user}`);
            }
            if (exp.users.length > 5) console.log(`        ...+${exp.users.length - 5} more`);
          } else if (exp.barrel) {
            console.log(`    \x1b[2m↗ ${exp.name}  — re-export (public API)\x1b[0m`);
          } else {
            console.log(`    \x1b[31m✗\x1b[0m ${exp.name}  — unused`);
          }
        }
        console.log();
      }

      const realDead = deadExports;
      console.log(`  Total: ${totalExports} exports, ${realDead} dead, ${barrelExports} barrel re-exports`);
      console.log(`  Dead export rate: ${totalExports > 0 ? Math.round(realDead / (totalExports - barrelExports) * 100) : 0}% (excluding barrels)\n`);
    });
}
