import type { DependencyGraph } from "./graph.js";
import { focusFile } from "./focus.js";
import { analyzeHealth } from "./health.js";
import { analyzeHotspots } from "./hotspots.js";
import { analyzeCoupling } from "./coupling.js";
import { generateSuggestions, type Suggestion } from "./suggest.js";
import { loadConfig } from "./config.js";
import { computeFileComplexity } from "./complexity.js";
import { parseFile } from "./parser.js";
import { getFileOwnership } from "./owners.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExplainSection {
  heading: string;
  lines: string[];
}

export interface FileExplanation {
  file: string;
  summary: string;
  sections: ExplainSection[];
}

export interface ProjectExplanation {
  summary: string;
  sections: ExplainSection[];
}

// ---------------------------------------------------------------------------
// File-level explanation
// ---------------------------------------------------------------------------

export async function explainFile(
  graph: DependencyGraph,
  filePath: string,
  rootDir: string,
  maxCommits = 300,
): Promise<FileExplanation> {
  const focus = focusFile(graph, filePath, rootDir);
  if (!focus.exists) {
    return { file: filePath, summary: `${filePath} is not in the dependency graph.`, sections: [] };
  }

  const parsed = await parseFile(rootDir, filePath);
  const fns = parsed ? computeFileComplexity(parsed) : [];
  const worstFn = fns.length > 0 ? fns.reduce((a, b) => (b.cognitive > a.cognitive ? b : a)) : null;

  const coupling = analyzeCoupling(graph, rootDir, maxCommits, 3, 0.3);
  const hiddenPartners = coupling.hidden.filter(
    (p) => p.fileA === filePath || p.fileB === filePath,
  );

  const totalFiles = graph.allNodes().filter((n) => n.kind === "file").length;
  const summary = buildFileSummary(filePath, focus, totalFiles);

  const sections: ExplainSection[] = [];
  const pct = totalFiles > 0 ? Math.round((focus.blastRadius / totalFiles) * 100) : 0;

  pushIfNonEmpty(sections, buildBlastSection(focus, pct));
  pushIfNonEmpty(sections, buildComplexitySection(fns, worstFn));
  pushIfNonEmpty(sections, buildChurnSection(focus, maxCommits));
  pushIfNonEmpty(sections, buildHiddenCouplingSection(filePath, hiddenPartners));
  pushIfNonEmpty(sections, buildDeadExportsSection(focus));
  pushIfNonEmpty(sections, buildTestsSection(focus));
  pushIfNonEmpty(sections, buildOwnershipSection(rootDir, filePath, focus, maxCommits));

  return { file: filePath, summary, sections };
}

// ---------------------------------------------------------------------------
// Project-level explanation
// ---------------------------------------------------------------------------

export async function explainProject(
  graph: DependencyGraph,
  rootDir: string,
  maxCommits = 300,
): Promise<ProjectExplanation> {
  const config = await loadConfig(rootDir);
  const health = analyzeHealth(graph, config.boundaries);
  const hotspotReport = analyzeHotspots(graph, rootDir, maxCommits);
  const coupling = analyzeCoupling(graph, rootDir, maxCommits, 3, 0.3);
  const suggestions = generateSuggestions(graph, health);

  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const totalFiles = fileNodes.length;
  const langs = detectLanguages(fileNodes);

  const gradeWord = health.score >= 90 ? "excellent" : health.score >= 80 ? "good" : health.score >= 60 ? "moderate" : "concerning";
  const summary = `${totalFiles} files, ${langs}. Architecture health: ${health.score}/100 (${health.grade}) — ${gradeWord}.`;

  const sections: ExplainSection[] = [];
  pushIfNonEmpty(sections, buildProjectCoreSection(graph, fileNodes, totalFiles));
  pushIfNonEmpty(sections, buildProjectHotspotsSection(hotspotReport));
  pushIfNonEmpty(sections, buildProjectCyclesSection(health));
  pushIfNonEmpty(sections, buildProjectCouplingSection(coupling));
  pushIfNonEmpty(sections, buildProjectDeadExportsSection(graph, fileNodes));
  sections.push(buildProjectSuggestionsSection(suggestions));

  return { summary, sections };
}

// ---------------------------------------------------------------------------
// Project explanation section builders
// ---------------------------------------------------------------------------

const LANG_MAP: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "TypeScript", ".jsx": "TypeScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".cs": "C#",
  ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".php": "PHP",
  ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++", ".cc": "C++", ".cxx": "C++", ".hxx": "C++",
};

function detectLanguages(fileNodes: Array<{ filePath: string }>): string {
  const langSet = new Set<string>();
  for (const n of fileNodes) {
    const ext = n.filePath.slice(n.filePath.lastIndexOf("."));
    const lang = LANG_MAP[ext];
    if (lang) langSet.add(lang);
  }
  return [...langSet].join(", ") || "unknown";
}

function buildProjectCoreSection(graph: DependencyGraph, fileNodes: Array<{ id: string; filePath: string }>, totalFiles: number): ExplainSection | null {
  const byDependents = fileNodes
    .map((n) => ({ file: n.filePath, deps: graph.getDependents(n.id).filter((e) => e.kind === "imports").length }))
    .filter((f) => f.deps > 0)
    .sort((a, b) => b.deps - a.deps);

  if (byDependents.length === 0) return null;

  const top = byDependents[0];
  const topPct = Math.round((graph.analyzeFileImpact(top.file).affected.filter((a) => a.node.kind === "file").length / totalFiles) * 100);
  const lines: string[] = [
    `${top.file} is the heart of this project — ${top.deps} files import it.`,
    `Changes there can ripple through ${topPct}% of the codebase.`,
  ];
  if (byDependents.length >= 2) {
    lines.push(`Other central files: ${byDependents.slice(1, 4).map((f) => `${f.file} (${f.deps})`).join(", ")}.`);
  }
  return { heading: "Core", lines };
}

function buildProjectHotspotsSection(hotspotReport: ReturnType<typeof analyzeHotspots>): ExplainSection | null {
  const critical = hotspotReport.hotspots.filter((h) => h.risk === "critical" || h.risk === "high");
  if (critical.length === 0) return null;

  const lines = critical.slice(0, 3).map((h) =>
    `${h.file} — changes ${h.changes} times, affects ${h.affected} files. ${h.risk.toUpperCase()} risk.`,
  );
  lines.push("Hotspots change frequently AND have large blast radius. They're the most likely source of unexpected breakage.");
  return { heading: "Hotspots", lines };
}

function buildProjectCyclesSection(health: ReturnType<typeof analyzeHealth>): ExplainSection | null {
  if (health.cycles.length === 0) return null;

  const tight = health.cycles.filter((c) => c.severity === "tight-couple").length;
  const short = health.cycles.filter((c) => c.severity === "short-ring").length;
  const long = health.cycles.filter((c) => c.severity === "long-ring").length;
  const parts: string[] = [];
  if (tight > 0) parts.push(`${tight} tight-couple`);
  if (short > 0) parts.push(`${short} short-ring`);
  if (long > 0) parts.push(`${long} long-ring`);

  const lines = [`${health.cycles.length} dependency cycle(s): ${parts.join(", ")}.`];
  if (long > 0) lines.push("Long rings (5+ files) are architectural problems. Consider extracting shared interfaces.");
  return { heading: "Cycles", lines };
}

function buildProjectCouplingSection(coupling: ReturnType<typeof analyzeCoupling>): ExplainSection | null {
  if (coupling.hidden.length === 0) return null;

  const lines = [`${coupling.hidden.length} file pair(s) change together in git but have no import relationship.`];
  for (const p of coupling.hidden.slice(0, 3)) {
    lines.push(`  ${p.fileA} ↔ ${p.fileB} (${Math.round(p.couplingRatio * 100)}% co-change)`);
  }
  lines.push("Hidden coupling means your architecture doesn't reflect real dependencies. Run: impulse coupling .");
  return { heading: "Hidden coupling", lines };
}

function buildProjectDeadExportsSection(graph: DependencyGraph, fileNodes: Array<{ id: string; filePath: string }>): ExplainSection | null {
  const exportNodes = graph.allNodes().filter((n) => n.kind === "export");
  const deadExports = exportNodes.filter((n) =>
    graph.getDependents(n.id).every((e) => e.kind !== "uses_export"),
  );

  const barrelPaths = new Set<string>();
  for (const n of fileNodes) {
    const fileExports = graph.getNodesByFile(n.filePath).filter((nn) => nn.kind === "export");
    if (fileExports.length === 0) continue;
    const deps = graph.getDependencies(n.id).filter((e) => e.kind === "imports");
    const hasReExports = fileExports.some((exp) => graph.getDependencies(exp.id).some((e) => e.kind === "uses_export"));
    if (hasReExports && deps.length > 0) barrelPaths.add(n.filePath);
  }

  const nonBarrelDead = deadExports.filter((n) => !barrelPaths.has(n.filePath));
  if (nonBarrelDead.length === 0) return null;

  return {
    heading: "Dead exports",
    lines: [
      `${nonBarrelDead.length} export(s) have no consumers. Removing them simplifies the codebase.`,
      "Run: impulse refactor . --dry-run",
    ],
  };
}

function buildProjectSuggestionsSection(suggestions: ReturnType<typeof generateSuggestions>): ExplainSection {
  if (suggestions.suggestions.length === 0) {
    return { heading: "What to do next", lines: ["Architecture looks clean. Keep it that way."] };
  }

  const lines = suggestions.suggestions.slice(0, 3).map(formatSuggestion);
  if (suggestions.estimatedScoreImprovement > 0) {
    lines.push(`Implementing these could improve health by ~${suggestions.estimatedScoreImprovement} points.`);
  }
  return { heading: "What to do next", lines };
}

// ---------------------------------------------------------------------------
// File explanation section builders
// ---------------------------------------------------------------------------

function pushIfNonEmpty(sections: ExplainSection[], section: ExplainSection | null): void {
  if (section) sections.push(section);
}

function buildFileSummary(filePath: string, focus: ReturnType<typeof focusFile>, totalFiles: number): string {
  const liveExports = focus.exports.filter((e) => !e.dead);
  const totalConsumers = new Set(liveExports.flatMap((e) => e.consumers)).size;

  if (focus.importedBy.length >= 10) {
    return `${filePath} is a hub — ${focus.importedBy.length} files import it, making it one of the most connected files in the project.`;
  }
  if (focus.imports.length === 0 && focus.importedBy.length > 0) {
    return `${filePath} is a foundation module — it exports to ${totalConsumers} consumer(s) but imports nothing locally.`;
  }
  if (focus.importedBy.length === 0 && focus.imports.length > 0) {
    return `${filePath} is a leaf — it imports ${focus.imports.length} file(s) but nobody imports it.`;
  }
  if (focus.exports.length > 0 && liveExports.length === 0) {
    return `${filePath} has ${focus.exports.length} export(s), all unused. Consider removing or consolidating.`;
  }
  return `${filePath} imports ${focus.imports.length} file(s) and is imported by ${focus.importedBy.length}.`;
}

function buildBlastSection(focus: ReturnType<typeof focusFile>, pct: number): ExplainSection | null {
  if (focus.blastRadius === 0) return null;

  const lines: string[] = [`Changes here can affect ${focus.blastRadius} file(s) — ${pct}% of the codebase.`];

  const depths = Object.entries(focus.impactByDepth).sort(([a], [b]) => Number(a) - Number(b));
  if (depths.length > 0) {
    const parts = depths.map(([d, count]) => Number(d) === 1 ? `${count} direct` : `${count} at depth ${d}`);
    lines.push(`Impact chain: ${parts.join(", ")}.`);
  }
  if (focus.blastRadius >= 20) {
    lines.push("This is a large blast radius. Test changes thoroughly before pushing.");
  }

  return { heading: "Blast radius", lines };
}

function buildComplexitySection(fns: ReturnType<typeof computeFileComplexity>, worstFn: ReturnType<typeof computeFileComplexity>[number] | null): ExplainSection | null {
  if (!worstFn || worstFn.cognitive <= 4) return null;

  const lines: string[] = [
    `Most complex function: ${worstFn.name} (cognitive complexity ${worstFn.cognitive}, ${worstFn.lineCount} lines).`,
  ];

  if (worstFn.cognitive >= 25) lines.push("This is alarming complexity. Consider breaking it into smaller functions with clear responsibilities.");
  else if (worstFn.cognitive >= 15) lines.push("This is high complexity. The function may be hard to modify safely.");
  else if (worstFn.cognitive >= 8) lines.push("Moderate complexity. Still readable, but watch for growth.");

  if (fns.length > 1) {
    const simple = fns.filter((f) => f.cognitive <= 4).length;
    lines.push(`${fns.length} functions total, ${simple} are simple (cognitive <= 4).`);
  }

  return { heading: "Complexity", lines };
}

function buildChurnSection(focus: ReturnType<typeof focusFile>, maxCommits: number): ExplainSection | null {
  if (focus.gitChanges === 0) return null;

  const lines: string[] = [
    `Changed ${focus.gitChanges} time(s) in the last ${maxCommits} commits${focus.lastChanged ? `, last ${focus.lastChanged}` : ""}.`,
  ];

  if (focus.gitChanges >= 15 && focus.blastRadius >= 5) {
    lines.push("High churn + large blast radius = elevated breakage risk. This file deserves extra test coverage.");
  } else if (focus.gitChanges >= 15) {
    lines.push("This file changes often. If it also has high complexity, consider stabilizing its interface.");
  }

  return { heading: "Churn", lines };
}

function buildHiddenCouplingSection(filePath: string, partners: ReturnType<typeof analyzeCoupling>["hidden"]): ExplainSection | null {
  if (partners.length === 0) return null;

  const lines: string[] = [];
  for (const p of partners) {
    const other = p.fileA === filePath ? p.fileB : p.fileA;
    lines.push(`${other} (${Math.round(p.couplingRatio * 100)}% co-change rate, ${p.cochanges} co-commits, no import relationship).`);
  }
  lines.push("These files change together but aren't connected via imports. Consider making the relationship explicit or extracting shared logic.");

  return { heading: "Hidden coupling", lines };
}

function buildDeadExportsSection(focus: ReturnType<typeof focusFile>): ExplainSection | null {
  const deadExports = focus.exports.filter((e) => e.dead);
  if (deadExports.length === 0) return null;

  return {
    heading: "Dead exports",
    lines: [
      `${deadExports.length} of ${focus.exports.length} export(s) are unused: ${deadExports.map((e) => e.name).join(", ")}.`,
      "Remove dead exports to reduce surface area. Run: impulse refactor . --dry-run",
    ],
  };
}

function buildTestsSection(focus: ReturnType<typeof focusFile>): ExplainSection | null {
  if (focus.testsCovering.length > 0) {
    const lines = [`${focus.testsCovering.length} test file(s) cover this file:`];
    for (const t of focus.testsCovering.slice(0, 5)) lines.push(`  ${t}`);
    if (focus.testsCovering.length > 5) lines.push(`  ...and ${focus.testsCovering.length - 5} more`);
    return { heading: "Tests", lines };
  }
  if (focus.blastRadius > 0) {
    return { heading: "Tests", lines: ["No test files cover this file. Given its blast radius, adding tests would reduce risk."] };
  }
  return null;
}

function buildOwnershipSection(rootDir: string, filePath: string, focus: ReturnType<typeof focusFile>, maxCommits: number): ExplainSection | null {
  const ownership = getFileOwnership(rootDir, filePath, maxCommits);
  if (ownership.topAuthors.length === 0) return null;

  const lines: string[] = [];
  const topAuthor = ownership.topAuthors[0];
  const pct = Math.round(topAuthor.share * 100);

  if (ownership.busFactor <= 1) {
    lines.push(`Single owner: ${topAuthor.name} (${pct}% of commits). Bus factor: 1.`);
    lines.push(
      focus.blastRadius >= 5
        ? "This file has high blast radius AND a single expert. If they leave, no one can safely modify it."
        : "Knowledge is concentrated in one person. Consider pair reviews to spread expertise.",
    );
  } else {
    const names = ownership.topAuthors.slice(0, 3).map((a) => `${a.name} (${Math.round(a.share * 100)}%)`);
    lines.push(`${ownership.totalAuthors} author(s): ${names.join(", ")}${ownership.totalAuthors > 3 ? "..." : ""}.`);
    lines.push(`Bus factor: ${ownership.busFactor}. Knowledge is distributed.`);
  }

  return { heading: "Ownership", lines };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSuggestion(s: Suggestion): string {
  switch (s.kind) {
    case "split-god-file":
      return `Split ${s.file} — ${s.dependents} dependents could be split into ${s.clusters.length} focused modules.`;
    case "remove-dead-exports":
      return `Remove ${s.exports.length} dead export(s) from ${s.file}: ${s.exports.join(", ")}.`;
    case "break-cycle":
      return `Break cycle: ${s.cycle.map((f) => f.split("/").pop()).join(" → ")}. Extract shared logic into a new module.`;
    case "split-complex-function":
      return `Split ${s.functionName} in ${s.file} (cognitive ${s.cognitive}, ${s.lineCount} lines).`;
  }
}
