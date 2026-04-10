import { execSync } from "node:child_process";
import { analyzeProject } from "./analyzer.js";
import { analyzeComplexity, type ComplexityReport } from "./complexity.js";
import { analyzeCoupling, type CouplingReport } from "./coupling.js";
import type { DependencyGraph } from "./graph.js";

export type RiskLevel = "critical" | "high" | "medium" | "low";

export interface FileDimensions {
  complexity: number;
  churn: number;
  impact: number;
  coupling: number;
}

export interface FileRiskRaw {
  maxCognitive: number;
  avgCognitive: number;
  functions: number;
  changes: number;
  blastRadius: number;
  hiddenCouplings: number;
}

export interface FileRisk {
  file: string;
  score: number;
  risk: RiskLevel;
  dimensions: FileDimensions;
  raw: FileRiskRaw;
}

export interface RiskReport {
  files: FileRisk[];
  totalFiles: number;
  distribution: { critical: number; high: number; medium: number; low: number };
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Weights — how much each dimension contributes to the composite score
// ---------------------------------------------------------------------------

const W_COMPLEXITY = 0.35;
const W_CHURN = 0.25;
const W_IMPACT = 0.25;
const W_COUPLING = 0.15;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeRisk(
  rootDir: string,
  maxCommits = 300,
): Promise<RiskReport> {
  const start = performance.now();

  const [{ graph }, complexity, changeCounts] = await Promise.all([
    analyzeProject(rootDir),
    analyzeComplexity(rootDir),
    Promise.resolve(getChangeFrequencies(rootDir, maxCommits)),
  ]);

  const coupling = analyzeCoupling(graph, rootDir, maxCommits, 3, 0.3);

  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");

  const complexityByFile = buildComplexityMap(complexity);
  const hiddenCouplingByFile = buildCouplingMap(coupling);

  const blastByFile = new Map<string, number>();
  for (const node of fileNodes) {
    const impact = graph.analyzeFileImpact(node.filePath);
    blastByFile.set(
      node.filePath,
      impact.affected.filter((a) => a.node.kind === "file").length,
    );
  }

  const maxChanges = Math.max(1, ...Array.from(changeCounts.values()));
  const maxBlast = Math.max(1, ...Array.from(blastByFile.values()));

  const results: FileRisk[] = [];

  for (const node of fileNodes) {
    const fp = node.filePath;
    const cx = complexityByFile.get(fp);
    const changes = changeCounts.get(fp) ?? 0;
    const blast = blastByFile.get(fp) ?? 0;
    const hiddenCoup = hiddenCouplingByFile.get(fp) ?? 0;

    const maxCog = cx?.maxCognitive ?? 0;
    const avgCog = cx?.avgCognitive ?? 0;
    const fnCount = cx?.functions ?? 0;

    const complexityNorm = Math.min(100, maxCog * 4);
    const churnNorm = Math.min(100, Math.round((changes / maxChanges) * 100));
    const impactNorm = Math.min(100, Math.round((blast / maxBlast) * 100));
    const couplingNorm = Math.min(100, hiddenCoup * 33);

    const composite =
      W_COMPLEXITY * complexityNorm +
      W_CHURN * churnNorm +
      W_IMPACT * impactNorm +
      W_COUPLING * couplingNorm;

    const peakDim = Math.max(complexityNorm, churnNorm, impactNorm, couplingNorm, 1);
    const score = Math.round(Math.sqrt((composite / 100) * (peakDim / 100)) * 100);

    results.push({
      file: fp,
      score,
      risk: classifyRisk(score),
      dimensions: {
        complexity: complexityNorm,
        churn: churnNorm,
        impact: impactNorm,
        coupling: couplingNorm,
      },
      raw: {
        maxCognitive: maxCog,
        avgCognitive: avgCog,
        functions: fnCount,
        changes,
        blastRadius: blast,
        hiddenCouplings: hiddenCoup,
      },
    });
  }

  results.sort((a, b) => b.score - a.score);

  const dist = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of results) dist[r.risk]++;

  const durationMs = Math.round(performance.now() - start);

  return { files: results, totalFiles: results.length, distribution: dist, durationMs };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function classifyRisk(score: number): RiskLevel {
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

interface FileCxSummary {
  maxCognitive: number;
  avgCognitive: number;
  functions: number;
}

function buildComplexityMap(report: ComplexityReport): Map<string, FileCxSummary> {
  const m = new Map<string, FileCxSummary>();
  for (const file of report.files) {
    m.set(file.filePath, {
      maxCognitive: file.maxCognitive,
      avgCognitive: file.avgCognitive,
      functions: file.functions.length,
    });
  }
  return m;
}

function buildCouplingMap(report: CouplingReport): Map<string, number> {
  const m = new Map<string, number>();
  for (const pair of report.hidden) {
    m.set(pair.fileA, (m.get(pair.fileA) ?? 0) + 1);
    m.set(pair.fileB, (m.get(pair.fileB) ?? 0) + 1);
  }
  return m;
}

function getChangeFrequencies(rootDir: string, maxCommits: number): Map<string, number> {
  try {
    const raw = execSync(
      `git log --pretty=format: --name-only -n ${maxCommits}`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 },
    ).trim();
    const counts = new Map<string, number>();
    for (const line of raw.split("\n")) {
      const file = line.trim();
      if (file.length > 0) counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    return counts;
  } catch {
    return new Map();
  }
}
