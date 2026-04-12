import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { analyzeProject } from "./analyzer.js";
import { analyzeHealth, type HealthReport } from "./health.js";
import { computeFileComplexity, buildComplexityReport, type ComplexityReport, type FileComplexity } from "./complexity.js";
import { analyzeCoupling, type CouplingReport } from "./coupling.js";
import { analyzeHotspots, type HotspotReport } from "./hotspots.js";
import { checkBoundaries, type BoundaryReport } from "./boundaries.js";
import { loadConfig } from "./config.js";
import type { DependencyGraph } from "./graph.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DebtDimension {
  name: string;
  score: number;
  weight: number;
  details: string;
}

export interface DebtContributor {
  file: string;
  debt: number;
  reasons: string[];
}

export interface DebtSnapshot {
  timestamp: number;
  score: number;
  grade: string;
  totalFiles: number;
  dimensions: Record<string, number>;
}

export interface DebtTrend {
  direction: "improving" | "stable" | "worsening";
  delta: number;
  snapshots: DebtSnapshot[];
}

export interface DebtReport {
  score: number;
  grade: string;
  dimensions: DebtDimension[];
  topContributors: DebtContributor[];
  trend: DebtTrend;
  totalFiles: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Dimension weights
// ---------------------------------------------------------------------------

const W_STRUCTURE = 0.30;
const W_COMPLEXITY = 0.25;
const W_COUPLING = 0.20;
const W_CHURN = 0.15;
const W_BOUNDARIES = 0.10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeDebt(
  rootDir: string,
  maxCommits = 300,
): Promise<DebtReport> {
  const start = performance.now();

  const cxFiles: FileComplexity[] = [];
  const [{ graph }, config] = await Promise.all([
    analyzeProject(rootDir, {
      onParsed(parsed) {
        const fns = computeFileComplexity(parsed);
        if (fns.length > 0) {
          cxFiles.push({
            filePath: parsed.filePath,
            functions: fns,
            totalCyclomatic: fns.reduce((s, f) => s + f.cyclomatic, 0),
            totalCognitive: fns.reduce((s, f) => s + f.cognitive, 0),
            avgCognitive: fns.length ? Math.round((fns.reduce((s, f) => s + f.cognitive, 0) / fns.length) * 10) / 10 : 0,
            maxCognitive: Math.max(0, ...fns.map((f) => f.cognitive)),
          });
        }
      },
    }),
    loadConfig(rootDir),
  ]);

  const complexity = buildComplexityReport(cxFiles);
  const health = analyzeHealth(graph, config.boundaries, complexity);
  const coupling = analyzeCoupling(graph, rootDir, maxCommits, 3, 0.3);
  const hotspots = analyzeHotspots(graph, rootDir, Math.min(maxCommits, 200));

  let boundaries: BoundaryReport | null = null;
  if (config.boundaries && Object.keys(config.boundaries).length > 0) {
    boundaries = checkBoundaries(graph, config.boundaries);
  }

  const totalFiles = graph.allNodes().filter((n) => n.kind === "file").length;

  const dims = computeDimensions(health, complexity, coupling, hotspots, boundaries, totalFiles);
  const score = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0));
  const grade = debtGrade(score);
  const topContributors = findTopContributors(graph, health, complexity, coupling, hotspots);

  const snapshot: DebtSnapshot = {
    timestamp: Date.now(),
    score,
    grade,
    totalFiles,
    dimensions: Object.fromEntries(dims.map((d) => [d.name, d.score])),
  };

  const history = await loadHistory(rootDir);
  history.push(snapshot);
  await saveHistory(rootDir, history);

  const trend = computeTrend(history);
  const durationMs = Math.round(performance.now() - start);

  return { score, grade, dimensions: dims, topContributors, trend, totalFiles, durationMs };
}

// ---------------------------------------------------------------------------
// Dimension scoring — each returns 0–100 (0 = no debt, 100 = max debt)
// Exported for testability.
// ---------------------------------------------------------------------------

export function computeDimensions(
  health: HealthReport,
  complexity: ComplexityReport,
  coupling: CouplingReport,
  hotspots: HotspotReport,
  boundaries: BoundaryReport | null,
  totalFiles: number,
): DebtDimension[] {
  return [
    structureDimension(health),
    complexityDimension(complexity),
    couplingDimension(coupling, totalFiles),
    churnDimension(hotspots),
    boundaryDimension(boundaries),
  ];
}

function structureDimension(health: HealthReport): DebtDimension {
  const score = 100 - health.score;

  const parts: string[] = [];
  if (health.cycles.length > 0) parts.push(`${health.cycles.length} cycle(s)`);
  if (health.godFiles.length > 0) parts.push(`${health.godFiles.length} god file(s)`);
  if (health.orphans.length > 0) parts.push(`${health.orphans.length} orphan(s)`);
  if (health.deepestChains.length > 0) parts.push(`max depth ${health.deepestChains[0]?.maxDepth ?? 0}`);

  return {
    name: "structure",
    score,
    weight: W_STRUCTURE,
    details: parts.length > 0 ? parts.join(", ") : "clean architecture",
  };
}

function complexityDimension(cx: ComplexityReport): DebtDimension {
  if (cx.totalFunctions === 0) {
    return { name: "complexity", score: 0, weight: W_COMPLEXITY, details: "no functions analyzed" };
  }

  const alarmingRatio = cx.distribution.alarming / cx.totalFunctions;
  const complexRatio = (cx.distribution.alarming + cx.distribution.complex) / cx.totalFunctions;

  let score = 0;
  if (alarmingRatio > 0.15) score = 90;
  else if (alarmingRatio > 0.08) score = 70;
  else if (alarmingRatio > 0.03) score = 50;
  else if (complexRatio > 0.3) score = 45;
  else if (complexRatio > 0.15) score = 30;
  else if (complexRatio > 0.05) score = 15;

  const parts: string[] = [];
  if (cx.distribution.alarming > 0) parts.push(`${cx.distribution.alarming} alarming`);
  if (cx.distribution.complex > 0) parts.push(`${cx.distribution.complex} complex`);
  parts.push(`avg cognitive ${cx.avgCognitive}`);

  return { name: "complexity", score, weight: W_COMPLEXITY, details: parts.join(", ") };
}

function couplingDimension(coupling: CouplingReport, totalFiles: number): DebtDimension {
  if (totalFiles === 0 || coupling.commitsAnalyzed === 0) {
    return { name: "coupling", score: 0, weight: W_COUPLING, details: "no git history" };
  }

  const hiddenRatio = totalFiles > 0 ? coupling.hidden.length / totalFiles : 0;
  let score = 0;
  if (hiddenRatio > 0.3) score = 85;
  else if (hiddenRatio > 0.15) score = 60;
  else if (hiddenRatio > 0.08) score = 40;
  else if (hiddenRatio > 0.03) score = 20;
  else if (coupling.hidden.length > 0) score = 10;

  const details = coupling.hidden.length > 0
    ? `${coupling.hidden.length} hidden pair(s) across ${coupling.commitsAnalyzed} commits`
    : `no hidden coupling in ${coupling.commitsAnalyzed} commits`;

  return { name: "coupling", score, weight: W_COUPLING, details };
}

function churnDimension(hotspots: HotspotReport): DebtDimension {
  if (hotspots.totalFiles === 0 || hotspots.commitsAnalyzed === 0) {
    return { name: "churn", score: 0, weight: W_CHURN, details: "no git history" };
  }

  const critical = hotspots.hotspots.filter((h) => h.risk === "critical").length;
  const high = hotspots.hotspots.filter((h) => h.risk === "high").length;
  const riskRatio = (critical * 3 + high) / hotspots.totalFiles;

  let score = 0;
  if (riskRatio > 0.2) score = 80;
  else if (riskRatio > 0.1) score = 55;
  else if (riskRatio > 0.05) score = 35;
  else if (critical + high > 0) score = 15;

  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (high > 0) parts.push(`${high} high`);
  const details = parts.length > 0 ? `${parts.join(", ")} hotspot(s)` : "no high-churn hotspots";

  return { name: "churn", score, weight: W_CHURN, details };
}

function boundaryDimension(boundaries: BoundaryReport | null): DebtDimension {
  if (!boundaries) {
    return { name: "boundaries", score: 0, weight: W_BOUNDARIES, details: "no boundaries configured" };
  }

  const violations = boundaries.violations.length;
  let score = 0;
  if (violations > 20) score = 90;
  else if (violations > 10) score = 65;
  else if (violations > 5) score = 45;
  else if (violations > 0) score = 25;

  const details = violations > 0
    ? `${violations} violation(s) across ${boundaries.boundaryStats.length} zone(s)`
    : `all ${boundaries.boundaryStats.length} zone(s) clean`;

  return { name: "boundaries", score, weight: W_BOUNDARIES, details };
}

// ---------------------------------------------------------------------------
// Top contributors — files that contribute the most to debt
// ---------------------------------------------------------------------------

function findTopContributors(
  graph: DependencyGraph,
  health: HealthReport,
  complexity: ComplexityReport,
  coupling: CouplingReport,
  hotspots: HotspotReport,
): DebtContributor[] {
  const fileDebt = new Map<string, { debt: number; reasons: string[] }>();

  const addDebt = (file: string, amount: number, reason: string) => {
    const entry = fileDebt.get(file) ?? { debt: 0, reasons: [] };
    entry.debt += amount;
    entry.reasons.push(reason);
    fileDebt.set(file, entry);
  };

  for (const gf of health.godFiles) {
    addDebt(gf.file, 15 + gf.totalConnections, `god file (${gf.totalConnections} connections)`);
  }

  for (const cycle of health.cycles) {
    const penalty = cycle.severity === "tight-couple" ? 5 : cycle.severity === "short-ring" ? 10 : 15;
    for (const file of cycle.cycle.slice(0, -1)) {
      addDebt(file, penalty, `circular dep (${cycle.severity})`);
    }
  }

  for (const fn of complexity.functions) {
    if (fn.risk === "alarming") {
      addDebt(fn.filePath, 10 + fn.cognitive, `alarming complexity: ${fn.name} (cog ${fn.cognitive})`);
    } else if (fn.risk === "complex") {
      addDebt(fn.filePath, fn.cognitive, `complex: ${fn.name} (cog ${fn.cognitive})`);
    }
  }

  for (const pair of coupling.hidden) {
    const amount = Math.round(pair.couplingRatio * 10);
    addDebt(pair.fileA, amount, `hidden coupling with ${pair.fileB}`);
    addDebt(pair.fileB, amount, `hidden coupling with ${pair.fileA}`);
  }

  for (const h of hotspots.hotspots) {
    if (h.risk === "critical") {
      addDebt(h.file, 20, `critical hotspot (${h.changes} changes, ${h.affected} affected)`);
    } else if (h.risk === "high") {
      addDebt(h.file, 10, `high-churn hotspot (${h.changes} changes)`);
    }
  }

  const contributors: DebtContributor[] = [];
  for (const [file, entry] of fileDebt) {
    contributors.push({ file, debt: entry.debt, reasons: [...new Set(entry.reasons)] });
  }

  contributors.sort((a, b) => b.debt - a.debt);
  return contributors.slice(0, 15);
}

// ---------------------------------------------------------------------------
// Trend and history
// ---------------------------------------------------------------------------

const HISTORY_DIR = ".impulse";
const HISTORY_FILE = "debt-history.json";
const MAX_SNAPSHOTS = 100;

async function loadHistory(rootDir: string): Promise<DebtSnapshot[]> {
  try {
    const raw = await readFile(join(rootDir, HISTORY_DIR, HISTORY_FILE), "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

async function saveHistory(rootDir: string, snapshots: DebtSnapshot[]): Promise<void> {
  const trimmed = snapshots.slice(-MAX_SNAPSHOTS);
  const dir = join(rootDir, HISTORY_DIR);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, HISTORY_FILE), JSON.stringify(trimmed, null, 2), "utf-8");
  } catch {
    // non-critical — history is a nice-to-have
  }
}

export function computeTrend(snapshots: DebtSnapshot[]): DebtTrend {
  if (snapshots.length < 2) {
    return { direction: "stable", delta: 0, snapshots };
  }

  const recent = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];
  const delta = recent.score - previous.score;

  let direction: DebtTrend["direction"];
  if (delta <= -3) direction = "improving";
  else if (delta >= 3) direction = "worsening";
  else direction = "stable";

  return { direction, delta, snapshots };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export function debtGrade(score: number): string {
  if (score <= 10) return "A";
  if (score <= 20) return "B";
  if (score <= 35) return "C";
  if (score <= 50) return "D";
  return "F";
}
