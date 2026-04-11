import type { Command } from "commander";
import { resolve } from "node:path";
import {
  runReview,
  type ReviewReport,
  type VerdictLevel,
} from "../core/review.js";
import type { RiskLevel } from "../core/risk.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description(
      "Pre-push review — risk, blast radius, tests, and verdict in one view",
    )
    .argument("[dir]", "Project root directory", ".")
    .option("--staged", "Only analyze staged changes")
    .option(
      "--base <ref>",
      "Compare against a base branch (e.g. origin/main)",
    )
    .option("--commits <n>", "Git commits for churn analysis", "300")
    .option("--json", "Output as JSON")
    .action(
      async (
        dir: string,
        opts: {
          staged?: boolean;
          base?: string;
          commits: string;
          json?: boolean;
        },
      ) => {
        const rootDir = resolve(dir);
        const maxCommits = parseInt(opts.commits, 10);

        if (!opts.json)
          process.stdout.write(`\n  \x1b[2mReviewing changes...\x1b[0m\r`);

        const report = await runReview(rootDir, {
          staged: opts.staged,
          base: opts.base,
          maxCommits,
        });

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        process.stdout.write(`\x1b[K`);
        printReview(report);
      },
    );
}

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

const dim = "\x1b[2m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const green = "\x1b[32m";
const cyan = "\x1b[36m";

const RISK_COLORS: Record<RiskLevel, string> = {
  critical: red,
  high: yellow,
  medium: cyan,
  low: dim,
};

const VERDICT_STYLES: Record<
  VerdictLevel,
  { color: string; icon: string; label: string }
> = {
  ship: { color: green, icon: "✓", label: "SHIP IT" },
  review: { color: yellow, icon: "⚠", label: "REVIEW" },
  hold: { color: red, icon: "✗", label: "HOLD" },
};

function printReview(report: ReviewReport): void {
  if (report.changedFiles.length === 0) {
    console.log(`  ${bold}Impulse — Review${reset}\n`);
    console.log(`  ${green}No changes to review.${reset}\n`);
    return;
  }

  console.log(`  ${bold}Impulse — Review${reset}  ${dim}(${report.durationMs}ms)${reset}\n`);

  const radiusLabel =
    report.totalAffected > 0
      ? ` → ${report.totalAffected} in blast radius`
      : "";
  console.log(
    `  ${report.changedFiles.length} file(s) changed${radiusLabel}\n`,
  );

  // Per-file risk details
  printFileRisks(report);

  // Architecture signals
  printSignals(report);

  // Tests
  printTests(report);

  // Verdict
  printVerdict(report);
}

function printFileRisks(report: ReviewReport): void {
  const barLen = 22;

  for (const f of report.files) {
    const filled = Math.max(
      f.riskScore > 0 ? 1 : 0,
      Math.round((f.riskScore / 100) * barLen),
    );
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    const color = RISK_COLORS[f.riskLevel];
    const label = f.riskLevel.toUpperCase();

    console.log(`  ${bold}${f.file}${reset}`);
    console.log(
      `    ${color}${bar}${reset}  ${color}${f.riskScore}${reset} ${color}${label}${reset}  ${dim}·${reset}  ${f.blastRadius} dependent(s)`,
    );

    const details: string[] = [];
    if (f.complexity > 0) details.push(`complexity ${f.complexity}`);
    if (f.churn > 0) details.push(`churn ${f.churn}`);
    if (f.couplings > 0)
      details.push(`${f.couplings} hidden coupling(s)`);
    if (details.length > 0) {
      console.log(`    ${dim}${details.join("  ·  ")}${reset}`);
    }
    console.log();
  }

  // Non-code files (in changedFiles but not in files)
  const analyzed = new Set(report.files.map((f) => f.file));
  const nonCode = report.changedFiles.filter((f) => !analyzed.has(f));
  if (nonCode.length > 0) {
    console.log(
      `  ${dim}${nonCode.length} non-code file(s) not analyzed: ${nonCode.slice(0, 3).join(", ")}${nonCode.length > 3 ? ` +${nonCode.length - 3} more` : ""}${reset}\n`,
    );
  }
}

function printSignals(report: ReviewReport): void {
  let hasSignals = false;

  for (const c of report.cycles) {
    const short = c.cycle.map((f) => f.split("/").pop()).join(" → ");
    console.log(`  ${yellow}⚠${reset} cycle: ${short}`);
    hasSignals = true;
  }

  for (const v of report.boundaryViolations) {
    console.log(
      `  ${red}✗${reset} boundary: ${v.from} → ${v.to}  ${dim}(${v.fromBoundary} → ${v.toBoundary})${reset}`,
    );
    hasSignals = true;
  }

  for (const v of report.pluginViolations) {
    const icon = v.severity === "error" ? `${red}✗${reset}` : `${yellow}⚠${reset}`;
    console.log(
      `  ${icon} ${v.file}: ${v.message}  ${dim}(${v.rule})${reset}`,
    );
    hasSignals = true;
  }

  if (hasSignals) console.log();
}

function printTests(report: ReviewReport): void {
  if (report.testTargets.length === 0) return;

  console.log(
    `  ${bold}Tests${reset} ${dim}(${report.testTargets.length})${reset}`,
  );

  for (const t of report.testTargets.slice(0, 8)) {
    const detail =
      t.depth === 0 ? "changed" : t.depth === 1 ? "direct" : `depth ${t.depth}`;
    console.log(
      `    ${cyan}⚡${reset} ${t.testFile}  ${dim}(${detail})${reset}`,
    );
  }
  if (report.testTargets.length > 8) {
    console.log(
      `    ${dim}...and ${report.testTargets.length - 8} more${reset}`,
    );
  }

  if (report.runCommand) {
    console.log(`\n    ${dim}${report.runCommand}${reset}`);
  }
  console.log();
}

function printVerdict(report: ReviewReport): void {
  const v = VERDICT_STYLES[report.verdict.level];
  const reasonStr = report.verdict.reasons.join("  ·  ");

  console.log(`  ${dim}${"─".repeat(50)}${reset}`);
  console.log(
    `  ${v.color}${v.icon}  ${bold}${v.label}${reset}  ${dim}${reasonStr}${reset}`,
  );
  console.log(`  ${dim}${"─".repeat(50)}${reset}`);
  console.log();
}
