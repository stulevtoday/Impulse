import type { Command } from "commander";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { analyzeProject } from "../core/analyzer.js";
import { findTestTargets, getChangedFiles, isTestFile } from "../core/test-targets.js";

export function registerTestCommand(program: Command): void {
  program
    .command("test")
    .description("Find which tests to run based on your uncommitted changes")
    .argument("[dir]", "Project root directory", ".")
    .option("--staged", "Only analyze staged changes")
    .option("--run", "Run the detected tests")
    .option("--json", "Output as JSON")
    .option("-f, --files <paths...>", "Explicit changed files (instead of git diff)")
    .action(async (dir: string, opts: { staged?: boolean; run?: boolean; json?: boolean; files?: string[] }) => {
      const rootDir = resolve(dir);
      const t0 = Date.now();

      const changedFiles = opts.files ?? getChangedFiles(rootDir, opts.staged ?? false);

      if (changedFiles.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ changedFiles: [], targets: [], runCommand: null }));
        } else {
          console.log("\n  No changes detected.\n");
        }
        return;
      }

      const { graph } = await analyzeProject(rootDir);
      const report = findTestTargets(graph, changedFiles);
      report.analysisMs = Date.now() - t0;

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const cyan = "\x1b[36m";
      const green = "\x1b[32m";
      const yellow = "\x1b[33m";

      console.log(`\n  ${bold}Impulse — Test Targeting${reset}`);
      console.log(`  ${changedFiles.length} changed file(s) → ${cyan}${report.targets.length} test(s) to run${reset}  ${dim}(${report.analysisMs}ms)${reset}\n`);

      if (report.targets.length === 0) {
        console.log(`  ${green}✓ No tests affected by your changes.${reset}\n`);
        return;
      }

      const directTests = report.targets.filter((t) => t.depth === 0);
      const triggeredTests = report.targets.filter((t) => t.depth > 0);

      if (directTests.length > 0) {
        console.log(`  ${yellow}Changed test files (${directTests.length}):${reset}\n`);
        for (const t of directTests) {
          console.log(`    ${bold}${t.testFile}${reset}`);
        }
        console.log();
      }

      if (triggeredTests.length > 0) {
        console.log(`  ${cyan}Affected tests (${triggeredTests.length}):${reset}\n`);
        for (const t of triggeredTests) {
          const depth = t.depth === 1 ? "direct" : `depth ${t.depth}`;
          console.log(`    ${bold}${t.testFile}${reset}`);

          const chainDisplay = t.chain
            .filter((f) => !isTestFile(f))
            .slice(0, 4);
          if (chainDisplay.length > 0) {
            console.log(`      ${dim}← ${chainDisplay.join(" ← ")}${reset}`);
          }
          console.log(`      ${dim}(${depth} via ${t.triggeredBy})${reset}`);
          console.log();
        }
      }

      if (report.runCommand) {
        console.log(`  ${dim}Run:${reset}  ${bold}${report.runCommand}${reset}\n`);
      }

      if (opts.run && report.runCommand) {
        console.log(`  ${cyan}Running tests...${reset}\n`);
        try {
          execSync(report.runCommand, {
            cwd: rootDir,
            stdio: "inherit",
          });
        } catch {
          process.exitCode = 1;
        }
      }
    });
}
