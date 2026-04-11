import { execSync } from "node:child_process";
import type { DependencyGraph } from "./graph.js";
import { getFileImpact } from "./analyzer.js";
import { getFileOwnership } from "./owners.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChangelogCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  files: string[];
}

export interface ChangelogModule {
  name: string;
  filesChanged: number;
  blastRadius: number;
  files: string[];
  riskLevel: "critical" | "high" | "medium" | "low";
}

export interface BreakingChange {
  file: string;
  export: string;
  consumers: number;
}

export interface ChangelogReport {
  base: string;
  head: string;
  commits: ChangelogCommit[];
  totalCommits: number;
  filesChanged: string[];
  totalAffected: number;
  modules: ChangelogModule[];
  breakingChanges: BreakingChange[];
  topContributors: Array<{ name: string; commits: number }>;
  summary: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generateChangelog(
  graph: DependencyGraph,
  rootDir: string,
  base: string,
  head = "HEAD",
): ChangelogReport {
  const start = performance.now();

  const commits = getCommitsBetween(rootDir, base, head);
  const allChangedFiles = new Set<string>();
  for (const c of commits) {
    for (const f of c.files) allChangedFiles.add(f);
  }
  const filesChanged = [...allChangedFiles];

  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const filePathSet = new Set(fileNodes.map((n) => n.filePath));
  const knownChanged = filesChanged.filter((f) => filePathSet.has(f));

  // Blast radius across all changes
  const affectedSet = new Set<string>();
  const changedSet = new Set(knownChanged);
  for (const file of knownChanged) {
    const impact = getFileImpact(graph, file);
    for (const item of impact.affected) {
      if (item.node.kind === "file" && !changedSet.has(item.node.filePath)) {
        affectedSet.add(item.node.filePath);
      }
    }
  }

  // Group by module (top-level directory)
  const moduleMap = new Map<string, string[]>();
  for (const f of knownChanged) {
    const parts = f.split("/");
    const moduleName = parts.length >= 2 ? parts.slice(0, 2).join("/") : parts[0];
    const existing = moduleMap.get(moduleName) ?? [];
    existing.push(f);
    moduleMap.set(moduleName, existing);
  }

  const modules: ChangelogModule[] = [];
  for (const [name, files] of moduleMap) {
    let moduleBlast = 0;
    for (const f of files) {
      const impact = getFileImpact(graph, f);
      moduleBlast += impact.affected.filter((a) => a.node.kind === "file").length;
    }

    const riskLevel: ChangelogModule["riskLevel"] =
      moduleBlast > 30 ? "critical" :
      moduleBlast > 15 ? "high" :
      moduleBlast > 5 ? "medium" : "low";

    modules.push({ name, filesChanged: files.length, blastRadius: moduleBlast, files, riskLevel });
  }
  modules.sort((a, b) => b.blastRadius - a.blastRadius);

  // Breaking changes — exports that existed before but are removed
  const breakingChanges = detectBreakingChanges(graph, rootDir, base, knownChanged);

  // Contributors
  const authorMap = new Map<string, number>();
  for (const c of commits) {
    authorMap.set(c.author, (authorMap.get(c.author) ?? 0) + 1);
  }
  const topContributors = [...authorMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, commits: count }));

  const summary = buildSummary(commits, filesChanged, affectedSet.size, modules, breakingChanges);

  return {
    base, head,
    commits,
    totalCommits: commits.length,
    filesChanged,
    totalAffected: affectedSet.size,
    modules,
    breakingChanges,
    topContributors,
    summary,
    durationMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCommitsBetween(rootDir: string, base: string, head: string): ChangelogCommit[] {
  try {
    const raw = execSync(
      `git log --pretty=format:'%H|||%h|||%an|||%aI|||%s' --name-only ${base}..${head}`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 },
    ).trim();

    if (!raw) return [];

    const commits: ChangelogCommit[] = [];
    let current: ChangelogCommit | null = null;

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.includes("|||")) {
        if (current) commits.push(current);
        const parts = trimmed.split("|||");
        current = {
          hash: parts[0].replace(/^'/, ""),
          shortHash: parts[1],
          author: parts[2],
          date: parts[3],
          message: parts[4]?.replace(/'$/, "") ?? "",
          files: [],
        };
      } else if (current && trimmed.length > 0) {
        current.files.push(trimmed);
      }
    }
    if (current) commits.push(current);

    return commits;
  } catch {
    return [];
  }
}

function detectBreakingChanges(
  graph: DependencyGraph,
  rootDir: string,
  base: string,
  changedFiles: string[],
): BreakingChange[] {
  const breaking: BreakingChange[] = [];

  try {
    for (const file of changedFiles) {
      const diff = execSync(
        `git diff ${base}...HEAD -- '${file}'`,
        { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 5 * 1024 * 1024 },
      );

      const removedExports: string[] = [];
      for (const line of diff.split("\n")) {
        if (!line.startsWith("-")) continue;
        const match = line.match(/^-\s*export\s+(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/);
        if (match) removedExports.push(match[1]);
      }

      for (const exportName of removedExports) {
        const addedBack = diff.split("\n").some((l) =>
          l.startsWith("+") && new RegExp(`export\\s+(?:async\\s+)?(?:function|class|interface|type|enum|const|let|var)\\s+${exportName}\\b`).test(l),
        );
        if (addedBack) continue;

        const impact = graph.analyzeExportImpact(file, exportName);
        const consumers = impact.affected.filter((a) => a.node.kind === "file").length;
        if (consumers > 0) {
          breaking.push({ file, export: exportName, consumers });
        }
      }
    }
  } catch {
    // diff failed — no breaking changes detectable
  }

  return breaking.sort((a, b) => b.consumers - a.consumers);
}

function buildSummary(
  commits: ChangelogCommit[],
  filesChanged: string[],
  totalAffected: number,
  modules: ChangelogModule[],
  breakingChanges: BreakingChange[],
): string {
  const parts: string[] = [];

  parts.push(`${commits.length} commit(s), ${filesChanged.length} file(s) changed, ${totalAffected} affected.`);

  if (modules.length > 0) {
    const topModule = modules[0];
    parts.push(`Primary impact: ${topModule.name} (${topModule.filesChanged} files, blast radius ${topModule.blastRadius}).`);
  }

  const critical = modules.filter((m) => m.riskLevel === "critical" || m.riskLevel === "high");
  if (critical.length > 0) {
    parts.push(`${critical.length} high-risk module(s): ${critical.map((m) => m.name).join(", ")}.`);
  }

  if (breakingChanges.length > 0) {
    parts.push(`${breakingChanges.length} breaking change(s): ${breakingChanges.map((b) => `${b.export} (${b.consumers} consumers)`).join(", ")}.`);
  }

  return parts.join(" ");
}
