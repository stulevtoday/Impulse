import { execSync } from "node:child_process";
import type { DependencyGraph } from "./graph.js";

export type HotspotRisk = "critical" | "high" | "medium" | "low";

export interface Hotspot {
  file: string;
  changes: number;
  affected: number;
  score: number;
  risk: HotspotRisk;
}

export interface HotspotReport {
  hotspots: Hotspot[];
  totalFiles: number;
  commitsAnalyzed: number;
}

export function analyzeHotspots(
  graph: DependencyGraph,
  rootDir: string,
  maxCommits = 200,
): HotspotReport {
  const changeCounts = getChangeFrequencies(rootDir, maxCommits);
  const commitsAnalyzed = getCommitCount(rootDir, maxCommits);

  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const hotspots: Hotspot[] = [];

  for (const node of fileNodes) {
    const changes = changeCounts.get(node.filePath) ?? 0;
    if (changes === 0) continue;

    const impact = graph.analyzeFileImpact(node.filePath);
    const affected = impact.affected.filter((a) => a.node.kind === "file").length;

    const score = computeHotspotScore(changes, affected, commitsAnalyzed);
    const risk = classifyRisk(score);

    hotspots.push({ file: node.filePath, changes, affected, score, risk });
  }

  hotspots.sort((a, b) => b.score - a.score);

  return { hotspots, totalFiles: fileNodes.length, commitsAnalyzed };
}

/**
 * Hotspot score: geometric mean of normalized change frequency and impact,
 * scaled 0-100. High score = changes often AND affects many files.
 */
function computeHotspotScore(
  changes: number,
  affected: number,
  totalCommits: number,
): number {
  const changeFreq = Math.min(changes / Math.max(totalCommits, 1), 1);
  const impactNorm = Math.min(affected / 20, 1);
  return Math.round(Math.sqrt(changeFreq * impactNorm) * 100);
}

function classifyRisk(score: number): HotspotRisk {
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function getChangeFrequencies(rootDir: string, maxCommits: number): Map<string, number> {
  const counts = new Map<string, number>();

  try {
    const raw = execSync(
      `git log --pretty=format: --name-only -n ${maxCommits}`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 },
    ).trim();

    for (const line of raw.split("\n")) {
      const file = line.trim();
      if (file.length > 0) {
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }
  } catch {
    // not a git repo or git not available
  }

  return counts;
}

function getCommitCount(rootDir: string, maxCommits: number): number {
  try {
    const raw = execSync(
      `git rev-list --count -n ${maxCommits} HEAD`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return Math.min(parseInt(raw, 10) || 0, maxCommits);
  } catch {
    return 0;
  }
}
