import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeOwnership, getFileOwnership } from "../core/owners.js";

const dim = "\x1b[2m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const cyan = "\x1b[36m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const green = "\x1b[32m";

export function registerOwnersCommand(program: Command): void {
  program
    .command("owners")
    .description(
      "Code ownership — who knows each file, bus factor, knowledge risk",
    )
    .argument("[target]", "File path or '.' for the whole project", ".")
    .argument("[dir]", "Project root directory", ".")
    .option("--commits <n>", "Git commits to analyze", "500")
    .option("--json", "Output as JSON")
    .action(
      async (
        target: string,
        dir: string,
        opts: { commits: string; json?: boolean },
      ) => {
        const rootDir = resolve(dir);
        const maxCommits = parseInt(opts.commits, 10);
        const isProject = target === "." || target === rootDir;

        if (!opts.json)
          process.stdout.write(`\n  ${dim}Analyzing ownership...${reset}\r`);

        if (isProject) {
          const { graph } = await analyzeProject(rootDir);
          const report = analyzeOwnership(graph, rootDir, maxCommits);
          process.stdout.write(`\x1b[K`);

          if (opts.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          printProjectOwnership(report);
        } else {
          const ownership = getFileOwnership(rootDir, target, maxCommits);
          process.stdout.write(`\x1b[K`);

          if (opts.json) {
            console.log(JSON.stringify(ownership, null, 2));
            return;
          }
          printFileOwnership(ownership);
        }
      },
    );
}

function printFileOwnership(o: ReturnType<typeof getFileOwnership>): void {
  console.log(`  ${bold}Impulse — Ownership${reset}\n`);
  console.log(`  ${bold}${o.file}${reset}\n`);

  if (o.topAuthors.length === 0) {
    console.log(`  ${dim}No git history for this file.${reset}\n`);
    return;
  }

  const bfColor = o.busFactor <= 1 ? red : o.busFactor <= 2 ? yellow : green;
  console.log(`  ${bfColor}Bus factor: ${o.busFactor}${reset}  ${dim}·${reset}  ${o.totalAuthors} author(s)\n`);

  for (const a of o.topAuthors) {
    const barLen = 20;
    const filled = Math.max(a.share > 0 ? 1 : 0, Math.round(a.share * barLen));
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    const pct = Math.round(a.share * 100);
    console.log(
      `  ${bar}  ${pct.toString().padStart(3)}%  ${a.name}  ${dim}(${a.commits} commits)${reset}`,
    );
  }

  if (o.lastAuthor) {
    console.log(`\n  ${dim}Last: ${o.lastAuthor}${o.lastDate ? `, ${formatRelative(o.lastDate)}` : ""}${reset}`);
  }

  if (o.busFactor <= 1) {
    console.log(`\n  ${red}⚠${reset}  Single-author file. Knowledge is concentrated in one person.`);
    console.log(`     If they leave, this file has no backup expert.`);
  }

  console.log();
}

function printProjectOwnership(report: ReturnType<typeof analyzeOwnership>): void {
  console.log(`  ${bold}Impulse — Ownership${reset}  ${dim}(${report.durationMs}ms)${reset}\n`);
  console.log(`  ${report.files.length} files  ${dim}·${reset}  ${report.teamSize} author(s)\n`);

  if (report.hotBusFactor.length > 0) {
    console.log(`  ${bold}Knowledge risk${reset} ${dim}(bus factor 1 + high blast radius)${reset}\n`);
    for (const f of report.hotBusFactor.slice(0, 8)) {
      console.log(
        `  ${red}⚠${reset}  ${f.file}  ${dim}bus factor ${f.busFactor} · ${f.blastRadius} dependent(s)${reset}`,
      );
    }
    console.log();
  }

  if (report.busiestAuthors.length > 0) {
    console.log(`  ${bold}Team distribution${reset}\n`);
    const maxFiles = report.busiestAuthors[0]?.files ?? 1;
    for (const a of report.busiestAuthors.slice(0, 6)) {
      const barLen = 20;
      const filled = Math.max(1, Math.round((a.files / maxFiles) * barLen));
      const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
      console.log(`  ${bar}  ${a.name}  ${dim}(${a.files} files)${reset}`);
    }
    console.log();
  }

  const bf1 = report.files.filter((f) => f.busFactor === 1 && f.totalAuthors > 0).length;
  const bfMulti = report.files.filter((f) => f.busFactor >= 2).length;
  const noHistory = report.files.filter((f) => f.totalAuthors === 0).length;

  console.log(`  ${dim}Summary:${reset}  ${red}${bf1}${reset} single-owner  ${dim}·${reset}  ${green}${bfMulti}${reset} shared  ${dim}·${reset}  ${dim}${noHistory} no history${reset}`);

  if (bf1 > bfMulti && bf1 > 5) {
    console.log(`\n  ${yellow}⚠${reset}  Most files have a single owner. Knowledge is fragile.`);
    console.log(`     Consider pair reviews or rotation to spread expertise.`);
  }

  console.log();
}

function formatRelative(isoDate: string): string {
  try {
    const then = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const mins = Math.round(diffMs / 60_000);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour(s) ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day(s) ago`;
    const months = Math.round(days / 30);
    return `${months} month(s) ago`;
  } catch {
    return isoDate;
  }
}
