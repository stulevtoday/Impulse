import { execSync } from "node:child_process";
import type { DependencyGraph } from "./graph.js";
import { getFileImpact } from "./analyzer.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileOwnership {
  file: string;
  topAuthors: Author[];
  totalAuthors: number;
  busFactor: number;
  lastAuthor: string | null;
  lastDate: string | null;
}

export interface Author {
  name: string;
  commits: number;
  share: number;
  lastCommit: string | null;
}

export interface OwnershipReport {
  files: FileOwnership[];
  teamSize: number;
  busiestAuthors: Array<{ name: string; files: number }>;
  hotBusFactor: Array<{ file: string; busFactor: number; blastRadius: number }>;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyzeOwnership(
  graph: DependencyGraph,
  rootDir: string,
  maxCommits = 500,
): OwnershipReport {
  const start = performance.now();

  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const filePaths = fileNodes.map((n) => n.filePath);

  const commitData = getCommitAuthors(rootDir, maxCommits);
  const allAuthors = new Set<string>();

  const files: FileOwnership[] = [];

  for (const fp of filePaths) {
    const authors = commitData.get(fp);
    if (!authors || authors.length === 0) {
      files.push({
        file: fp, topAuthors: [], totalAuthors: 0,
        busFactor: 0, lastAuthor: null, lastDate: null,
      });
      continue;
    }

    const countMap = new Map<string, { commits: number; lastDate: string | null }>();
    for (const entry of authors) {
      allAuthors.add(entry.name);
      const existing = countMap.get(entry.name);
      if (!existing) {
        countMap.set(entry.name, { commits: 1, lastDate: entry.date });
      } else {
        existing.commits++;
        if (entry.date && (!existing.lastDate || entry.date > existing.lastDate)) {
          existing.lastDate = entry.date;
        }
      }
    }

    const totalCommits = authors.length;
    const sorted = [...countMap.entries()]
      .sort(([, a], [, b]) => b.commits - a.commits);

    const topAuthors: Author[] = sorted.slice(0, 5).map(([name, data]) => ({
      name,
      commits: data.commits,
      share: Math.round((data.commits / totalCommits) * 100) / 100,
      lastCommit: data.lastDate,
    }));

    const busFactor = computeBusFactor(sorted.map(([, d]) => d.commits), totalCommits);

    const lastEntry = authors[0];

    files.push({
      file: fp,
      topAuthors,
      totalAuthors: countMap.size,
      busFactor,
      lastAuthor: lastEntry?.name ?? null,
      lastDate: lastEntry?.date ?? null,
    });
  }

  const authorFileCount = new Map<string, number>();
  for (const f of files) {
    for (const a of f.topAuthors) {
      authorFileCount.set(a.name, (authorFileCount.get(a.name) ?? 0) + 1);
    }
  }
  const busiestAuthors = [...authorFileCount.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, fileCount]) => ({ name, files: fileCount }));

  const hotBusFactor = files
    .filter((f) => f.busFactor > 0 && f.busFactor <= 1)
    .map((f) => {
      const impact = getFileImpact(graph, f.file);
      const blastRadius = impact.affected.filter((a) => a.node.kind === "file").length;
      return { file: f.file, busFactor: f.busFactor, blastRadius };
    })
    .filter((f) => f.blastRadius >= 3)
    .sort((a, b) => b.blastRadius - a.blastRadius)
    .slice(0, 10);

  return {
    files,
    teamSize: allAuthors.size,
    busiestAuthors,
    hotBusFactor,
    durationMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Single-file ownership
// ---------------------------------------------------------------------------

export function getFileOwnership(
  rootDir: string,
  filePath: string,
  maxCommits = 500,
): FileOwnership {
  const authors = getFileAuthors(rootDir, filePath, maxCommits);
  if (authors.length === 0) {
    return { file: filePath, topAuthors: [], totalAuthors: 0, busFactor: 0, lastAuthor: null, lastDate: null };
  }

  const countMap = new Map<string, { commits: number; lastDate: string | null }>();
  for (const entry of authors) {
    const existing = countMap.get(entry.name);
    if (!existing) {
      countMap.set(entry.name, { commits: 1, lastDate: entry.date });
    } else {
      existing.commits++;
      if (entry.date && (!existing.lastDate || entry.date > existing.lastDate)) {
        existing.lastDate = entry.date;
      }
    }
  }

  const totalCommits = authors.length;
  const sorted = [...countMap.entries()].sort(([, a], [, b]) => b.commits - a.commits);

  const topAuthors: Author[] = sorted.slice(0, 5).map(([name, data]) => ({
    name,
    commits: data.commits,
    share: Math.round((data.commits / totalCommits) * 100) / 100,
    lastCommit: data.lastDate,
  }));

  return {
    file: filePath,
    topAuthors,
    totalAuthors: countMap.size,
    busFactor: computeBusFactor(sorted.map(([, d]) => d.commits), totalCommits),
    lastAuthor: authors[0]?.name ?? null,
    lastDate: authors[0]?.date ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CommitEntry { name: string; date: string }

function getCommitAuthors(rootDir: string, maxCommits: number): Map<string, CommitEntry[]> {
  try {
    const raw = execSync(
      `git log --pretty=format:'%an|||%aI' --name-only -n ${maxCommits}`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 },
    ).trim();

    const result = new Map<string, CommitEntry[]>();
    let currentAuthor = "";
    let currentDate = "";

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      if (trimmed.includes("|||")) {
        const parts = trimmed.split("|||");
        currentAuthor = parts[0].replace(/^'/, "");
        currentDate = parts[1]?.replace(/'$/, "") ?? "";
      } else if (currentAuthor && trimmed.length > 0) {
        const existing = result.get(trimmed) ?? [];
        existing.push({ name: currentAuthor, date: currentDate });
        result.set(trimmed, existing);
      }
    }

    return result;
  } catch {
    return new Map();
  }
}

function getFileAuthors(rootDir: string, filePath: string, maxCommits: number): CommitEntry[] {
  try {
    const raw = execSync(
      `git log --pretty=format:'%an|||%aI' -n ${maxCommits} -- '${filePath}'`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    if (!raw) return [];
    return raw.split("\n")
      .filter((l) => l.includes("|||"))
      .map((l) => {
        const parts = l.trim().split("|||");
        return { name: parts[0].replace(/^'/, ""), date: parts[1]?.replace(/'$/, "") ?? "" };
      });
  } catch {
    return [];
  }
}

/**
 * Bus factor: minimum number of authors whose combined commits
 * account for >= 50% of total commits.
 */
function computeBusFactor(commitCounts: number[], totalCommits: number): number {
  if (commitCounts.length === 0 || totalCommits === 0) return 0;
  const sorted = [...commitCounts].sort((a, b) => b - a);
  let cumulative = 0;
  const threshold = totalCommits * 0.5;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i];
    if (cumulative >= threshold) return i + 1;
  }
  return sorted.length;
}
