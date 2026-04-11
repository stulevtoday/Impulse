import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import {
  explainFile,
  explainProject,
  type ExplainSection,
} from "../core/explain.js";

const dim = "\x1b[2m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const cyan = "\x1b[36m";

export function registerExplainCommand(program: Command): void {
  program
    .command("explain")
    .description(
      "Explain a file or project in plain language — why it matters, what's risky, what to do",
    )
    .argument("[target]", "File path or '.' for the whole project", ".")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .option("--commits <n>", "Git commits for churn analysis", "300")
    .action(
      async (
        target: string,
        dir: string,
        opts: { json?: boolean; commits: string },
      ) => {
        const rootDir = resolve(dir);
        const maxCommits = parseInt(opts.commits, 10);
        const isProject = target === "." || target === rootDir;

        if (!opts.json)
          process.stdout.write(`\n  ${dim}Analyzing...${reset}\r`);

        const { graph } = await analyzeProject(rootDir);

        process.stdout.write(`\x1b[K`);

        if (isProject) {
          const explanation = await explainProject(graph, rootDir, maxCommits);
          if (opts.json) {
            console.log(JSON.stringify(explanation, null, 2));
            return;
          }
          printProjectExplanation(explanation.summary, explanation.sections);
        } else {
          const explanation = await explainFile(graph, target, rootDir, maxCommits);
          if (opts.json) {
            console.log(JSON.stringify(explanation, null, 2));
            return;
          }
          printFileExplanation(explanation.file, explanation.summary, explanation.sections);
        }
      },
    );
}

function printFileExplanation(
  file: string,
  summary: string,
  sections: ExplainSection[],
): void {
  console.log(`  ${bold}Impulse — Explain${reset}\n`);
  console.log(`  ${bold}${file}${reset}`);
  console.log(`  ${summary}\n`);

  if (sections.length === 0) {
    console.log(`  ${dim}No additional analysis available.${reset}\n`);
    return;
  }

  for (const section of sections) {
    console.log(`  ${cyan}${section.heading}${reset}`);
    for (const line of section.lines) {
      console.log(`  ${line}`);
    }
    console.log();
  }
}

function printProjectExplanation(
  summary: string,
  sections: ExplainSection[],
): void {
  console.log(`  ${bold}Impulse — Project Explanation${reset}\n`);
  console.log(`  ${summary}\n`);

  for (const section of sections) {
    console.log(`  ${cyan}${section.heading}${reset}`);
    for (const line of section.lines) {
      console.log(`  ${line}`);
    }
    console.log();
  }
}
