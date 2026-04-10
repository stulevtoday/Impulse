import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { planDeadExportRemovals, applyRefactorPlan } from "../core/refactor.js";

export function registerRefactorCommand(program: Command): void {
  program
    .command("refactor")
    .description("Auto-apply safe refactorings — remove dead exports (more actions coming)")
    .argument("[dir]", "Project root directory", ".")
    .option("--dry-run", "Show what would change without modifying files", false)
    .option("--json", "Output plan as JSON")
    .action(async (dir: string, opts: { dryRun: boolean; json?: boolean }) => {
      const rootDir = resolve(dir);

      if (!opts.json) process.stdout.write(`\n  \x1b[2mPlanning refactorings...\x1b[0m\r`);

      const { graph } = await analyzeProject(rootDir);
      const plan = planDeadExportRemovals(graph, rootDir);

      if (opts.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      process.stdout.write(`\x1b[K`);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const yellow = "\x1b[33m";

      console.log(`  ${bold}Impulse — Refactor${reset}`);

      if (plan.actions.length === 0) {
        console.log("  No safe refactorings found.\n");
        return;
      }

      console.log(`  ${plan.exportsRemoved} dead export(s) in ${plan.filesAffected} file(s)\n`);

      const byFile = new Map<string, typeof plan.actions>();
      for (const a of plan.actions) {
        const list = byFile.get(a.file) ?? [];
        list.push(a);
        byFile.set(a.file, list);
      }

      for (const [file, actions] of byFile) {
        console.log(`  ${bold}${file}${reset}`);
        for (const a of actions) {
          if (a.type === "remove-export") {
            console.log(`    ${red}- ${dim}${a.before.trim()}${reset}`);
            console.log(`    ${green}+ ${dim}${a.after.trim()}${reset}`);
          } else {
            console.log(`    ${red}- ${dim}${a.before.trim()}${reset}`);
          }
        }
        console.log();
      }

      if (opts.dryRun) {
        console.log(`  ${yellow}Dry run — no files modified.${reset}`);
        console.log(`  ${dim}Run without --dry-run to apply.${reset}\n`);
        return;
      }

      const result = applyRefactorPlan(plan, rootDir);

      console.log(`  ${green}Applied: ${result.applied.length} change(s) to ${result.filesWritten.length} file(s)${reset}`);
      if (result.skipped.length > 0) {
        console.log(`  ${yellow}Skipped: ${result.skipped.length} (source changed since analysis)${reset}`);
      }
      console.log();
    });
}
