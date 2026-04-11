import { execSync } from "node:child_process";
import { analyzeProject, getFileImpact } from "./analyzer.js";
import { analyzeHealth } from "./health.js";
import { computeFileComplexity } from "./complexity.js";
import { analyzeCoupling } from "./coupling.js";
import { checkBoundaries } from "./boundaries.js";
import { findTestTargets } from "./test-targets.js";
import { runPlugins } from "./plugins.js";
import { loadConfig } from "./config.js";
import { parseFile } from "./parser.js";
import { analyzeSecrets, type SecretIssue } from "./secrets.js";
import type { DependencyGraph } from "./graph.js";
import type { RiskLevel } from "./risk.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReviewOptions {
  staged?: boolean;
  base?: string;
  maxCommits?: number;
}

export type VerdictLevel = "ship" | "review" | "hold";

export interface FileReview {
  file: string;
  riskScore: number;
  riskLevel: RiskLevel;
  blastRadius: number;
  complexity: number;
  churn: number;
  couplings: number;
}

export interface ReviewVerdict {
  level: VerdictLevel;
  reasons: string[];
}

export interface ReviewReport {
  changedFiles: string[];
  affected: Array<{ file: string; depth: number; via: string }>;
  totalAffected: number;
  files: FileReview[];
  cycles: Array<{ cycle: string[]; severity: string }>;
  boundaryViolations: Array<{
    from: string;
    to: string;
    fromBoundary: string;
    toBoundary: string;
  }>;
  testTargets: Array<{ testFile: string; depth: number; triggeredBy: string }>;
  runCommand: string | null;
  pluginViolations: Array<{
    file: string;
    message: string;
    severity: "error" | "warning" | "info";
    rule: string;
  }>;
  pluginsRun: number;
  secretIssues: SecretIssue[];
  verdict: ReviewVerdict;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Risk scoring — same weights as risk.ts for consistency
// ---------------------------------------------------------------------------

const W_COMPLEXITY = 0.35;
const W_CHURN = 0.25;
const W_IMPACT = 0.25;
const W_COUPLING = 0.15;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runReview(
  rootDir: string,
  opts: ReviewOptions = {},
): Promise<ReviewReport> {
  const start = performance.now();

  const changedFiles = getReviewChangedFiles(rootDir, opts);
  if (changedFiles.length === 0) {
    return emptyReport(start);
  }

  const cxMap = new Map<string, { max: number; avg: number; fns: number }>();

  const [{ graph }, config] = await Promise.all([
    analyzeProject(rootDir, {
      onParsed(parsed) {
        const fns = computeFileComplexity(parsed);
        if (fns.length > 0) {
          let maxCog = 0;
          let totalCog = 0;
          for (const fn of fns) {
            totalCog += fn.cognitive;
            if (fn.cognitive > maxCog) maxCog = fn.cognitive;
          }
          cxMap.set(parsed.filePath, {
            max: maxCog,
            avg: fns.length ? Math.round((totalCog / fns.length) * 10) / 10 : 0,
            fns: fns.length,
          });
        }
      },
    }),
    loadConfig(rootDir),
  ]);

  const changedSet = new Set(changedFiles);
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const filePathSet = new Set(fileNodes.map((n) => n.filePath));
  const knownChanged = changedFiles.filter((f) => filePathSet.has(f));

  // Blast radius for every file (needed for normalization)
  const blastByFile = new Map<string, number>();
  for (const node of fileNodes) {
    const impact = graph.analyzeFileImpact(node.filePath);
    blastByFile.set(
      node.filePath,
      impact.affected.filter((a) => a.node.kind === "file").length,
    );
  }

  // Collect affected files across all changes
  const affectedMap = new Map<string, { depth: number; via: string }>();
  for (const file of knownChanged) {
    const impact = getFileImpact(graph, file);
    for (const item of impact.affected) {
      if (item.node.kind !== "file" || changedSet.has(item.node.filePath)) continue;
      const existing = affectedMap.get(item.node.filePath);
      if (!existing || item.depth < existing.depth) {
        affectedMap.set(item.node.filePath, { depth: item.depth, via: file });
      }
    }
  }

  // Git churn + coupling (parallel — both hit git log)
  const maxCommits = opts.maxCommits ?? 300;
  const [changeCounts, coupling] = await Promise.all([
    Promise.resolve(getChangeFrequencies(rootDir, maxCommits)),
    Promise.resolve(analyzeCoupling(graph, rootDir, maxCommits, 3, 0.3)),
  ]);

  const couplingByFile = new Map<string, number>();
  for (const pair of coupling.hidden) {
    couplingByFile.set(pair.fileA, (couplingByFile.get(pair.fileA) ?? 0) + 1);
    couplingByFile.set(pair.fileB, (couplingByFile.get(pair.fileB) ?? 0) + 1);
  }

  // Normalization maxima
  const maxChanges = Math.max(1, ...Array.from(changeCounts.values()));
  const maxBlast = Math.max(1, ...Array.from(blastByFile.values()));

  // Risk scoring — only for changed files, but normalized against the whole project
  const fileReviews: FileReview[] = [];

  for (const fp of knownChanged) {
    const cx = cxMap.get(fp);
    const changes = changeCounts.get(fp) ?? 0;
    const blast = blastByFile.get(fp) ?? 0;
    const hiddenCoup = couplingByFile.get(fp) ?? 0;

    const maxCog = cx?.max ?? 0;
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

    fileReviews.push({
      file: fp,
      riskScore: score,
      riskLevel: classifyRisk(score),
      blastRadius: blast,
      complexity: maxCog,
      churn: changes,
      couplings: hiddenCoup,
    });
  }

  fileReviews.sort((a, b) => b.riskScore - a.riskScore);

  // Cycles involving changed files
  const health = analyzeHealth(graph, config.boundaries);
  const cycles = health.cycles
    .filter((c) => c.cycle.some((f) => changedSet.has(f)))
    .map((c) => ({ cycle: c.cycle, severity: c.severity }));

  // Boundary violations involving changed files
  let boundaryViolations: ReviewReport["boundaryViolations"] = [];
  if (config.boundaries && Object.keys(config.boundaries).length > 0) {
    const bReport = checkBoundaries(graph, config.boundaries);
    boundaryViolations = bReport.violations.filter(
      (v) => changedSet.has(v.from) || changedSet.has(v.to),
    );
  }

  // Test targets
  const testReport = findTestTargets(graph, changedFiles);

  // Plugins — filter to changed files only
  const pluginReport = await runPlugins(graph, rootDir);
  const pluginViolations: ReviewReport["pluginViolations"] = pluginReport.results
    .flatMap((r) => r.violations)
    .filter((v) => changedSet.has(v.file))
    .map((v) => ({ file: v.file, message: v.message, severity: v.severity, rule: v.rule }));

  // Secrets — check for .env leaks and exposed credentials
  const secretsReport = await analyzeSecrets(graph, rootDir);
  const secretIssues = secretsReport.issues;

  // Verdict
  const verdict = computeVerdict(
    fileReviews,
    cycles,
    boundaryViolations,
    pluginViolations,
    affectedMap.size,
    secretIssues,
  );

  const affected = [...affectedMap.entries()]
    .map(([file, info]) => ({ file, depth: info.depth, via: info.via }))
    .sort((a, b) => a.depth - b.depth);

  return {
    changedFiles,
    affected,
    totalAffected: affectedMap.size,
    files: fileReviews,
    cycles,
    boundaryViolations,
    testTargets: testReport.targets.map((t) => ({
      testFile: t.testFile,
      depth: t.depth,
      triggeredBy: t.triggeredBy,
    })),
    runCommand: testReport.runCommand,
    pluginViolations,
    pluginsRun: pluginReport.pluginsRun,
    secretIssues,
    verdict,
    durationMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Verdict logic
// ---------------------------------------------------------------------------

export function computeVerdict(
  files: FileReview[],
  cycles: ReviewReport["cycles"],
  boundaryViolations: ReviewReport["boundaryViolations"],
  pluginViolations: ReviewReport["pluginViolations"],
  totalAffected: number,
  secretIssues: SecretIssue[] = [],
): ReviewVerdict {
  const reasons: string[] = [];
  let level: VerdictLevel = "ship";

  const criticalSecrets = secretIssues.filter((s) => s.severity === "critical");
  if (criticalSecrets.length > 0) {
    reasons.push(`${criticalSecrets.length} secret leak(s)`);
    level = "hold";
  }

  const criticalFiles = files.filter((f) => f.riskLevel === "critical");
  if (criticalFiles.length > 0) {
    reasons.push(`${criticalFiles.length} critical-risk file(s)`);
    level = "hold";
  }

  if (cycles.length > 0) {
    reasons.push(`${cycles.length} dependency cycle(s)`);
    level = "hold";
  }

  const criticalPlugins = pluginViolations.filter((v) => v.severity === "error");
  if (criticalPlugins.length > 0) {
    reasons.push(`${criticalPlugins.length} plugin error(s)`);
    level = "hold";
  }

  const warningSecrets = secretIssues.filter((s) => s.severity === "warning");
  if (warningSecrets.length > 0) {
    reasons.push(`${warningSecrets.length} secret warning(s)`);
    if (level === "ship") level = "review";
  }

  const highFiles = files.filter((f) => f.riskLevel === "high");
  if (highFiles.length > 0) {
    reasons.push(`${highFiles.length} high-risk file(s)`);
    if (level === "ship") level = "review";
  }

  if (boundaryViolations.length > 0) {
    reasons.push(`${boundaryViolations.length} boundary violation(s)`);
    if (level === "ship") level = "review";
  }

  const warningPlugins = pluginViolations.filter((v) => v.severity === "warning");
  if (warningPlugins.length > 0) {
    reasons.push(`${warningPlugins.length} plugin warning(s)`);
    if (level === "ship") level = "review";
  }

  if (totalAffected > 20) {
    reasons.push(`large blast radius (${totalAffected} files)`);
    if (level === "ship") level = "review";
  }

  if (reasons.length === 0) {
    reasons.push("all clear");
  }

  return { level, reasons };
}

// ---------------------------------------------------------------------------
// Quick review — uses a warm graph, caches git data for live watch mode
// ---------------------------------------------------------------------------

export interface QuickReviewCache {
  changeCounts: Map<string, number>;
  couplingByFile: Map<string, number>;
  complexityMap: Map<string, { max: number; avg: number; fns: number }>;
  lastRefreshMs: number;
}

const CACHE_TTL_MS = 60_000;

export async function runQuickReview(
  graph: DependencyGraph,
  rootDir: string,
  opts: ReviewOptions = {},
  cache?: QuickReviewCache,
): Promise<{ report: ReviewReport; cache: QuickReviewCache }> {
  const start = performance.now();

  const changedFiles = getReviewChangedFiles(rootDir, opts);
  if (changedFiles.length === 0) {
    const freshCache = cache ?? { changeCounts: new Map(), couplingByFile: new Map(), complexityMap: new Map(), lastRefreshMs: Date.now() };
    return { report: emptyReport(start), cache: freshCache };
  }

  const now = Date.now();
  const stale = !cache || (now - cache.lastRefreshMs > CACHE_TTL_MS);
  const maxCommits = opts.maxCommits ?? 300;

  let changeCounts: Map<string, number>;
  let couplingByFile: Map<string, number>;
  let cxMap: Map<string, { max: number; avg: number; fns: number }>;

  if (stale) {
    const [cc, coupling] = await Promise.all([
      Promise.resolve(getChangeFrequencies(rootDir, maxCommits)),
      Promise.resolve(analyzeCoupling(graph, rootDir, maxCommits, 3, 0.3)),
    ]);
    changeCounts = cc;
    couplingByFile = new Map();
    for (const pair of coupling.hidden) {
      couplingByFile.set(pair.fileA, (couplingByFile.get(pair.fileA) ?? 0) + 1);
      couplingByFile.set(pair.fileB, (couplingByFile.get(pair.fileB) ?? 0) + 1);
    }
    cxMap = cache?.complexityMap ?? new Map();
  } else {
    changeCounts = cache.changeCounts;
    couplingByFile = cache.couplingByFile;
    cxMap = cache.complexityMap;
  }

  // Parse complexity only for changed files that aren't cached
  for (const fp of changedFiles) {
    if (!cxMap.has(fp)) {
      const parsed = await parseFile(rootDir, fp);
      if (parsed) {
        const fns = computeFileComplexity(parsed);
        if (fns.length > 0) {
          let maxCog = 0;
          let totalCog = 0;
          for (const fn of fns) {
            totalCog += fn.cognitive;
            if (fn.cognitive > maxCog) maxCog = fn.cognitive;
          }
          cxMap.set(fp, { max: maxCog, avg: fns.length ? Math.round((totalCog / fns.length) * 10) / 10 : 0, fns: fns.length });
        }
      }
    }
  }

  const changedSet = new Set(changedFiles);
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const filePathSet = new Set(fileNodes.map((n) => n.filePath));
  const knownChanged = changedFiles.filter((f) => filePathSet.has(f));

  const blastByFile = new Map<string, number>();
  for (const node of fileNodes) {
    const impact = graph.analyzeFileImpact(node.filePath);
    blastByFile.set(node.filePath, impact.affected.filter((a) => a.node.kind === "file").length);
  }

  const affectedMap = new Map<string, { depth: number; via: string }>();
  for (const file of knownChanged) {
    const impact = getFileImpact(graph, file);
    for (const item of impact.affected) {
      if (item.node.kind !== "file" || changedSet.has(item.node.filePath)) continue;
      const existing = affectedMap.get(item.node.filePath);
      if (!existing || item.depth < existing.depth) {
        affectedMap.set(item.node.filePath, { depth: item.depth, via: file });
      }
    }
  }

  const maxChanges = Math.max(1, ...Array.from(changeCounts.values()));
  const maxBlast = Math.max(1, ...Array.from(blastByFile.values()));

  const fileReviews: FileReview[] = [];
  for (const fp of knownChanged) {
    const cx = cxMap.get(fp);
    const changes = changeCounts.get(fp) ?? 0;
    const blast = blastByFile.get(fp) ?? 0;
    const hiddenCoup = couplingByFile.get(fp) ?? 0;

    const maxCog = cx?.max ?? 0;
    const complexityNorm = Math.min(100, maxCog * 4);
    const churnNorm = Math.min(100, Math.round((changes / maxChanges) * 100));
    const impactNorm = Math.min(100, Math.round((blast / maxBlast) * 100));
    const couplingNorm = Math.min(100, hiddenCoup * 33);

    const composite = W_COMPLEXITY * complexityNorm + W_CHURN * churnNorm + W_IMPACT * impactNorm + W_COUPLING * couplingNorm;
    const peakDim = Math.max(complexityNorm, churnNorm, impactNorm, couplingNorm, 1);
    const score = Math.round(Math.sqrt((composite / 100) * (peakDim / 100)) * 100);

    fileReviews.push({
      file: fp, riskScore: score, riskLevel: classifyRisk(score),
      blastRadius: blast, complexity: maxCog, churn: changes, couplings: hiddenCoup,
    });
  }
  fileReviews.sort((a, b) => b.riskScore - a.riskScore);

  const config = await loadConfig(rootDir);
  const health = analyzeHealth(graph, config.boundaries);
  const cycles = health.cycles
    .filter((c) => c.cycle.some((f) => changedSet.has(f)))
    .map((c) => ({ cycle: c.cycle, severity: c.severity }));

  let boundaryViolations: ReviewReport["boundaryViolations"] = [];
  if (config.boundaries && Object.keys(config.boundaries).length > 0) {
    const bReport = checkBoundaries(graph, config.boundaries);
    boundaryViolations = bReport.violations.filter((v) => changedSet.has(v.from) || changedSet.has(v.to));
  }

  const testReport = findTestTargets(graph, changedFiles);
  const verdict = computeVerdict(fileReviews, cycles, boundaryViolations, [], affectedMap.size);

  const affected = [...affectedMap.entries()]
    .map(([file, info]) => ({ file, depth: info.depth, via: info.via }))
    .sort((a, b) => a.depth - b.depth);

  const updatedCache: QuickReviewCache = {
    changeCounts, couplingByFile, complexityMap: cxMap,
    lastRefreshMs: stale ? now : cache!.lastRefreshMs,
  };

  return {
    report: {
      changedFiles, affected, totalAffected: affectedMap.size,
      files: fileReviews, cycles, boundaryViolations,
      testTargets: testReport.targets.map((t) => ({ testFile: t.testFile, depth: t.depth, triggeredBy: t.triggeredBy })),
      runCommand: testReport.runCommand,
      pluginViolations: [], pluginsRun: 0, secretIssues: [],
      verdict, durationMs: Math.round(performance.now() - start),
    },
    cache: updatedCache,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getReviewChangedFiles(rootDir: string, opts: ReviewOptions): string[] {
  try {
    let cmd: string;
    if (opts.staged) {
      cmd = "git diff --cached --name-only";
    } else if (opts.base) {
      cmd = `git diff --name-only ${opts.base}...HEAD`;
    } else {
      cmd = "git diff --name-only HEAD";
    }
    const raw = execSync(cmd, {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return raw ? raw.split("\n").filter((f) => f.length > 0) : [];
  } catch {
    return [];
  }
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

function classifyRisk(score: number): RiskLevel {
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function emptyReport(start: number): ReviewReport {
  return {
    changedFiles: [],
    affected: [],
    totalAffected: 0,
    files: [],
    cycles: [],
    boundaryViolations: [],
    testTargets: [],
    runCommand: null,
    pluginViolations: [],
    pluginsRun: 0,
    secretIssues: [],
    verdict: { level: "ship", reasons: ["no changes to review"] },
    durationMs: Math.round(performance.now() - start),
  };
}
