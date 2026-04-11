import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { analyzeProject, getFileImpact } from "../core/analyzer.js";
import { analyzeHealth } from "../core/health.js";
import { loadConfig } from "../core/config.js";
import { analyzeHotspots, type HotspotRisk } from "../core/hotspots.js";

export async function runDashboard(): Promise<void> {
  const rootDir = resolve(".");
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const bold = "\x1b[1m";

  process.stdout.write(`\n  ${dim}Scanning...${reset}`);

  const [{ graph, stats }, config] = await Promise.all([
    analyzeProject(rootDir),
    loadConfig(rootDir),
  ]);
  const health = analyzeHealth(graph, config.boundaries);

  process.stdout.write(`\r\x1b[K`);

  const gradeColor = health.score >= 80 ? green : health.score >= 60 ? yellow : red;
  const langSet = new Set<string>();
  for (const node of graph.allNodes()) {
    if (node.kind !== "file") continue;
    const ext = node.filePath.slice(node.filePath.lastIndexOf("."));
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) langSet.add("TypeScript");
    else if (ext === ".py") langSet.add("Python");
    else if (ext === ".go") langSet.add("Go");
    else if (ext === ".rs") langSet.add("Rust");
    else if (ext === ".cs") langSet.add("C#");
    else if (ext === ".java") langSet.add("Java");
    else if (ext === ".kt" || ext === ".kts") langSet.add("Kotlin");
    else if (ext === ".php") langSet.add("PHP");
    else if (ext === ".c") langSet.add("C");
    else if ([".cpp", ".hpp", ".cc", ".cxx", ".hxx"].includes(ext)) langSet.add("C++");
    else if (ext === ".h") { langSet.add("C"); }
  }
  const langs = [...langSet].join(" + ") || "unknown";

  console.log(`  ${bold}I M P U L S E${reset}\n`);
  console.log(`  ${stats.filesScanned} files  ${dim}·${reset}  ${langs}  ${dim}·${reset}  ${gradeColor}${health.score}/100 (${health.grade})${reset}  ${dim}·${reset}  ${stats.durationMs}ms`);

  const issues: string[] = [];
  if (health.cycles.length > 0) issues.push(`${health.cycles.length} cycle(s)`);
  if (health.godFiles.length > 0) issues.push(`${health.godFiles.length} god file(s)`);
  if (health.orphans.length > 0) issues.push(`${health.orphans.length} orphan(s)`);

  if (issues.length > 0) {
    console.log(`  ${yellow}${issues.join(", ")}${reset}`);
  } else {
    console.log(`  ${green}No structural issues${reset}`);
  }

  const changedFiles = getDashboardChangedFiles(rootDir);
  if (changedFiles.length > 0) {
    const fileSet = new Set(graph.allNodes().filter((n) => n.kind === "file").map((n) => n.filePath));
    const knownChanged = changedFiles.filter((f) => fileSet.has(f));

    const allAffected = new Map<string, { depth: number; via: string }>();
    const changedSet = new Set(knownChanged);

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
      if (srcFiles.length > 5) {
        console.log(`    ${dim}...and ${srcFiles.length - 5} more${reset}`);
      }
      if (testFiles.length > 0) {
        console.log(`    ${cyan}⚡ ${testFiles.length} test file(s) to re-run${reset}`);
      }
    }
  }

  const hotspotReport = analyzeHotspots(graph, rootDir, 100);
  const topHotspots = hotspotReport.hotspots
    .filter((h) => h.risk === "critical" || h.risk === "high" || h.risk === "medium")
    .slice(0, 3);

  if (topHotspots.length > 0) {
    const riskColors: Record<HotspotRisk, string> = {
      critical: red, high: yellow, medium: cyan, low: dim,
    };
    console.log(`\n  ${dim}Hotspots:${reset}`);
    for (const h of topHotspots) {
      const color = riskColors[h.risk];
      console.log(`    ${color}${h.risk.toUpperCase().padEnd(8)}${reset} ${h.file}  ${dim}${h.changes} changes · ${h.affected} affected${reset}`);
    }
  }

  console.log(`\n  ${dim}Try:${reset}`);
  if (changedFiles.length > 0) {
    console.log(`    ${bold}impulse review .${reset}              ${dim}pre-push review with verdict${reset}`);
    console.log(`    ${bold}impulse diff .${reset}                ${dim}full impact of your changes${reset}`);
    console.log(`    ${bold}impulse test .${reset}                ${dim}which tests to run${reset}`);
  }
  console.log(`    ${bold}impulse coupling .${reset}            ${dim}hidden coupling from git${reset}`);
  console.log(`    ${bold}impulse health .${reset}              ${dim}full architecture report${reset}`);
  console.log(`    ${bold}impulse visualize .${reset}           ${dim}interactive graph in browser${reset}`);
  console.log();
}

function getDashboardChangedFiles(rootDir: string): string[] {
  try {
    const raw = execSync("git diff --name-only HEAD", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!raw) return [];
    return raw.split("\n").filter((f) => f.length > 0);
  } catch {
    return [];
  }
}
