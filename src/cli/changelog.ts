import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { generateChangelog, type ChangelogReport } from "../core/changelog.js";

const dim = "\x1b[2m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const cyan = "\x1b[36m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const green = "\x1b[32m";

const RISK_COLORS: Record<string, string> = {
  critical: red, high: yellow, medium: cyan, low: dim,
};

export function registerChangelogCommand(program: Command): void {
  program
    .command("changelog")
    .description(
      "Semantic changelog — what changed, what's affected, what broke",
    )
    .argument("<base>", "Base ref (branch, tag, or commit)")
    .argument("[dir]", "Project root directory", ".")
    .option("--head <ref>", "Head ref", "HEAD")
    .option("--json", "Output as JSON")
    .option("--markdown", "Output as Markdown (for PR descriptions)")
    .action(
      async (
        base: string,
        dir: string,
        opts: { head: string; json?: boolean; markdown?: boolean },
      ) => {
        const rootDir = resolve(dir);

        if (!opts.json && !opts.markdown)
          process.stdout.write(`\n  ${dim}Generating changelog...${reset}\r`);

        const { graph } = await analyzeProject(rootDir);
        const report = generateChangelog(graph, rootDir, base, opts.head);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        process.stdout.write(`\x1b[K`);

        if (opts.markdown) {
          printMarkdown(report);
        } else {
          printChangelog(report);
        }
      },
    );
}

function printChangelog(report: ChangelogReport): void {
  console.log(`  ${bold}Impulse — Changelog${reset}  ${dim}(${report.durationMs}ms)${reset}\n`);
  console.log(`  ${dim}${report.base}...${report.head}${reset}\n`);
  console.log(`  ${report.totalCommits} commit(s)  ${dim}·${reset}  ${report.filesChanged.length} file(s) changed  ${dim}·${reset}  ${report.totalAffected} affected\n`);

  if (report.breakingChanges.length > 0) {
    console.log(`  ${red}${bold}Breaking changes${reset}\n`);
    for (const b of report.breakingChanges) {
      console.log(`  ${red}✗${reset} ${b.file}: removed ${bold}${b.export}${reset}  ${dim}(${b.consumers} consumer(s))${reset}`);
    }
    console.log();
  }

  if (report.modules.length > 0) {
    console.log(`  ${bold}Modules${reset}\n`);
    for (const m of report.modules) {
      const color = RISK_COLORS[m.riskLevel] ?? dim;
      console.log(`  ${color}${m.riskLevel.toUpperCase().padEnd(8)}${reset} ${m.name}  ${dim}${m.filesChanged} file(s) · blast radius ${m.blastRadius}${reset}`);
    }
    console.log();
  }

  if (report.topContributors.length > 0) {
    console.log(`  ${bold}Contributors${reset}\n`);
    for (const c of report.topContributors) {
      console.log(`  ${c.name}  ${dim}(${c.commits} commits)${reset}`);
    }
    console.log();
  }

  if (report.commits.length > 0) {
    console.log(`  ${bold}Commits${reset}\n`);
    for (const c of report.commits.slice(0, 20)) {
      console.log(`  ${dim}${c.shortHash}${reset}  ${c.message}  ${dim}(${c.author})${reset}`);
    }
    if (report.commits.length > 20) {
      console.log(`  ${dim}...and ${report.commits.length - 20} more${reset}`);
    }
    console.log();
  }
}

function printMarkdown(report: ChangelogReport): void {
  console.log(`## Summary\n`);
  console.log(report.summary);
  console.log();

  if (report.breakingChanges.length > 0) {
    console.log(`## Breaking Changes\n`);
    for (const b of report.breakingChanges) {
      console.log(`- **${b.file}**: removed \`${b.export}\` (${b.consumers} consumer(s))`);
    }
    console.log();
  }

  if (report.modules.length > 0) {
    console.log(`## Impact by Module\n`);
    console.log(`| Module | Files | Blast Radius | Risk |`);
    console.log(`|---|---|---|---|`);
    for (const m of report.modules) {
      console.log(`| ${m.name} | ${m.filesChanged} | ${m.blastRadius} | ${m.riskLevel} |`);
    }
    console.log();
  }

  if (report.commits.length > 0) {
    console.log(`## Commits (${report.totalCommits})\n`);
    for (const c of report.commits.slice(0, 30)) {
      console.log(`- ${c.shortHash} ${c.message} *(${c.author})*`);
    }
    if (report.commits.length > 30) {
      console.log(`- ...and ${report.commits.length - 30} more`);
    }
    console.log();
  }
}
