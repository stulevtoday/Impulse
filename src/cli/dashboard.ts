import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { analyzeProject, getFileImpact } from "../core/analyzer.js";
import { analyzeHealth, type HealthReport } from "../core/health.js";
import { loadConfig } from "../core/config.js";
import { analyzeHotspots, type HotspotRisk } from "../core/hotspots.js";
import type { DependencyGraph } from "../core/graph.js";

const dim = "\x1b[2m";
const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const bold = "\x1b[1m";

const LANG_MAP: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "TypeScript", ".jsx": "TypeScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".cs": "C#",
  ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".php": "PHP",
  ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++", ".cc": "C++", ".cxx": "C++", ".hxx": "C++",
};

export async function runDashboard(): Promise<void> {
  const rootDir = resolve(".");

  process.stdout.write(`\n  ${dim}Scanning...${reset}`);

  const [{ graph, stats }, config] = await Promise.all([
    analyzeProject(rootDir),
    loadConfig(rootDir),
  ]);
  const health = analyzeHealth(graph, config.boundaries);

  process.stdout.write(`\r\x1b[K`);

  printHeader(graph, health, stats);

  const changedFiles = getDashboardChangedFiles(rootDir);
  if (changedFiles.length > 0) {
    printChanges(graph, changedFiles);
  }

  printHotspots(graph, rootDir);
  printSuggestions(changedFiles.length > 0);
}

function printHeader(graph: DependencyGraph, health: HealthReport, stats: { filesScanned: number; durationMs: number }): void {
  const langSet = new Set<string>();
  for (const node of graph.allNodes()) {
    if (node.kind !== "file") continue;
    const ext = node.filePath.slice(node.filePath.lastIndexOf("."));
    const lang = LANG_MAP[ext];
    if (lang) langSet.add(lang);
  }
  const langs = [...langSet].join(" + ") || "unknown";
  const gradeColor = health.score >= 80 ? green : health.score >= 60 ? yellow : red;

  console.log(`  ${bold}I M P U L S E${reset}\n`);
  console.log(`  ${stats.filesScanned} files  ${dim}·${reset}  ${langs}  ${dim}·${reset}  ${gradeColor}${health.score}/100 (${health.grade})${reset}  ${dim}·${reset}  ${stats.durationMs}ms`);

  const issues: string[] = [];
  if (health.cycles.length > 0) issues.push(`${health.cycles.length} cycle(s)`);
  if (health.godFiles.length > 0) issues.push(`${health.godFiles.length} god file(s)`);
  if (health.orphans.length > 0) issues.push(`${health.orphans.length} orphan(s)`);

  console.log(issues.length > 0 ? `  ${yellow}${issues.join(", ")}${reset}` : `  ${green}No structural issues${reset}`);
}

function printChanges(graph: DependencyGraph, changedFiles: string[]): void {
  const fileSet = new Set(graph.allNodes().filter((n) => n.kind === "file").map((n) => n.filePath));
  const knownChanged = changedFiles.filter((f) => fileSet.has(f));
  const changedSet = new Set(knownChanged);

  const allAffected = new Map<string, { depth: number; via: string }>();
  for (const file of knownChanged) {
    const impact = getFileImpact(graph, file);
    for (const item of impact.affected) {
      if (item.node.kind !== "file" || changedSet.has(item.node.filePath)) continue;
      const existing = allAffected.get(item.node.filePath);
      if (!existing || item.depth < existing.depth) {
        allAffected.set(item.node.filePath, { depth: item.depth, via: file });
      }
    }
  }

  console.log(`\n  ${bold}Uncommitted changes:${reset}  ${changedFiles.length} file(s) changed → ${allAffected.size} affected`);

  if (allAffected.size > 0) {
    const sorted = [...allAffected.entries()].sort((a, b) => a[1].depth - b[1].depth);
    const testFiles = sorted.filter(([f]) => f.includes("test") || f.includes("spec"));
    const srcFiles = sorted.filter(([f]) => !f.includes("test") && !f.includes("spec"));

    for (const [file, info] of srcFiles.slice(0, 5)) {
      const depth = info.depth === 1 ? "direct" : `depth ${info.depth}`;
      console.log(`    ${yellow}→${reset} ${file}  ${dim}(${depth} via ${info.via})${reset}`);
    }
    if (srcFiles.length > 5) console.log(`    ${dim}...and ${srcFiles.length - 5} more${reset}`);
    if (testFiles.length > 0) console.log(`    ${cyan}⚡ ${testFiles.length} test file(s) to re-run${reset}`);
  }
}

function printHotspots(graph: DependencyGraph, rootDir: string): void {
  const hotspotReport = analyzeHotspots(graph, rootDir, 100);
  const top = hotspotReport.hotspots
    .filter((h) => h.risk === "critical" || h.risk === "high" || h.risk === "medium")
    .slice(0, 3);

  if (top.length === 0) return;

  const riskColors: Record<HotspotRisk, string> = { critical: red, high: yellow, medium: cyan, low: dim };
  console.log(`\n  ${dim}Hotspots:${reset}`);
  for (const h of top) {
    console.log(`    ${riskColors[h.risk]}${h.risk.toUpperCase().padEnd(8)}${reset} ${h.file}  ${dim}${h.changes} changes · ${h.affected} affected${reset}`);
  }
}

function printSuggestions(hasChanges: boolean): void {
  console.log(`\n  ${dim}Try:${reset}`);
  if (hasChanges) {
    console.log(`    ${bold}impulse review .${reset}              ${dim}pre-push review with verdict${reset}`);
    console.log(`    ${bold}impulse diff .${reset}                ${dim}full impact of your changes${reset}`);
    console.log(`    ${bold}impulse test .${reset}                ${dim}which tests to run${reset}`);
  }
  console.log(`    ${bold}impulse debt .${reset}                ${dim}technical debt score + trends${reset}`);
  console.log(`    ${bold}impulse coupling .${reset}            ${dim}hidden coupling from git${reset}`);
  console.log(`    ${bold}impulse health .${reset}              ${dim}full architecture report${reset}`);
  console.log(`    ${bold}impulse visualize .${reset}           ${dim}interactive graph in browser${reset}`);
  console.log();
}

function getDashboardChangedFiles(rootDir: string): string[] {
  try {
    const raw = execSync("git diff --name-only HEAD", {
      cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return raw ? raw.split("\n").filter((f) => f.length > 0) : [];
  } catch {
    return [];
  }
}
