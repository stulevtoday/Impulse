import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeHealth } from "../core/health.js";
import { generateSuggestions, type Suggestion } from "../core/suggest.js";

function printSuggestion(idx: number, s: Suggestion): void {
  if (s.kind === "split-god-file") {
    console.log(
      `  \x1b[33m${idx}.\x1b[0m Split god file: \x1b[1m${s.file}\x1b[0m (${s.dependents} dependents)`,
    );
    console.log();
    for (const cluster of s.clusters) {
      const label = cluster.suggestedFile === s.file ? "\x1b[2m(keep here)\x1b[0m" : `→ \x1b[36m${cluster.suggestedFile}\x1b[0m`;
      console.log(
        `     ${cluster.exports.join(", ")}  ${label}`,
      );
      console.log(
        `     \x1b[2mused by ${cluster.consumers.length} file(s)\x1b[0m`,
      );
      console.log();
    }
    console.log(
      `     Expected: max dependents ${s.dependents} → ${s.expectedMaxDependents}\n`,
    );
  }

  if (s.kind === "remove-dead-exports") {
    console.log(
      `  \x1b[33m${idx}.\x1b[0m Dead exports in \x1b[1m${s.file}\x1b[0m`,
    );
    for (const exp of s.exports) {
      console.log(`     \x1b[31m✗\x1b[0m ${exp}`);
    }
    console.log();
  }

  if (s.kind === "break-cycle") {
    console.log(
      `  \x1b[33m${idx}.\x1b[0m Break cycle: \x1b[1m${s.cycle[0]}\x1b[0m ↔ \x1b[1m${s.cycle[1]}\x1b[0m`,
    );
    console.log(
      `     Extract ${s.sharedSymbols.join(", ")} → ${s.suggestedExtraction}`,
    );
    console.log();
  }
}

export function registerSuggestCommand(program: Command): void {
  program
    .command("suggest")
    .description("Actionable refactoring suggestions based on graph analysis")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { json?: boolean }) => {
      const rootDir = resolve(dir);
      const { graph, stats } = await analyzeProject(rootDir);
      const health = analyzeHealth(graph);
      const report = generateSuggestions(graph, health);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(`\n  \x1b[36mImpulse — Refactoring Suggestions\x1b[0m`);
      console.log(`  ${stats.filesScanned} files analyzed in ${stats.durationMs}ms\n`);

      if (report.suggestions.length === 0) {
        console.log("  No suggestions — architecture looks clean.\n");
        return;
      }

      let idx = 1;
      for (const s of report.suggestions) {
        printSuggestion(idx++, s);
      }

      const actionable = report.suggestions.filter(
        (s) => s.kind !== "remove-dead-exports",
      ).length;
      const deadCount = report.suggestions
        .filter((s): s is Extract<Suggestion, { kind: "remove-dead-exports" }> => s.kind === "remove-dead-exports")
        .reduce((sum, s) => sum + s.exports.length, 0);

      console.log(`  ─────────────────────────────────────────`);
      if (actionable > 0) {
        console.log(`  ${actionable} structural suggestion(s)`);
      }
      if (deadCount > 0) {
        console.log(`  ${deadCount} dead export(s) to remove`);
      }
      if (report.estimatedScoreImprovement > 0) {
        console.log(
          `  Estimated score improvement: \x1b[32m+${report.estimatedScoreImprovement}\x1b[0m (${health.score} → ${health.score + report.estimatedScoreImprovement})`,
        );
      }
      console.log();
    });
}
