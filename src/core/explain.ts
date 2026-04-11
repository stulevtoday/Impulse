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
  const maxCog = fns.length > 0 ? Math.max(...fns.map((f) => f.cognitive)) : 0;
  const worstFn = fns.length > 0 ? fns.reduce((a, b) => (b.cognitive > a.cognitive ? b : a)) : null;

  const coupling = analyzeCoupling(graph, rootDir, maxCommits, 3, 0.3);
  const hiddenPartners = coupling.hidden.filter(
    (p) => p.fileA === filePath || p.fileB === filePath,
  );

  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const totalFiles = fileNodes.length;

  const sections: ExplainSection[] = [];

  // Role
  const roles: string[] = [];
  const liveExports = focus.exports.filter((e) => !e.dead);
  const totalConsumers = new Set(liveExports.flatMap((e) => e.consumers)).size;

  if (focus.importedBy.length >= 10) roles.push("hub");
  if (focus.imports.length === 0 && focus.importedBy.length > 0) roles.push("foundation");
  if (focus.importedBy.length === 0 && focus.imports.length > 0) roles.push("leaf");
  if (filePath.includes("test") || filePath.includes("spec")) roles.push("test");
  if (focus.exports.length > 0 && liveExports.length === 0) roles.push("dead-weight");

  const pct = totalFiles > 0 ? Math.round((focus.blastRadius / totalFiles) * 100) : 0;

  let summary: string;
  if (roles.includes("hub")) {
    summary = `${filePath} is a hub — ${focus.importedBy.length} files import it, making it one of the most connected files in the project.`;
  } else if (roles.includes("foundation")) {
    summary = `${filePath} is a foundation module — it exports to ${totalConsumers} consumer(s) but imports nothing locally.`;
  } else if (roles.includes("leaf")) {
    summary = `${filePath} is a leaf — it imports ${focus.imports.length} file(s) but nobody imports it.`;
  } else if (roles.includes("dead-weight")) {
    summary = `${filePath} has ${focus.exports.length} export(s), all unused. Consider removing or consolidating.`;
  } else {
    summary = `${filePath} imports ${focus.imports.length} file(s) and is imported by ${focus.importedBy.length}.`;
  }

  // Blast radius
  if (focus.blastRadius > 0) {
    const blastLines: string[] = [];
    blastLines.push(`Changes here can affect ${focus.blastRadius} file(s) — ${pct}% of the codebase.`);

    const depths = Object.entries(focus.impactByDepth)
      .sort(([a], [b]) => Number(a) - Number(b));
    if (depths.length > 0) {
      const depthParts = depths.map(([d, count]) =>
        Number(d) === 1 ? `${count} direct` : `${count} at depth ${d}`,
      );
      blastLines.push(`Impact chain: ${depthParts.join(", ")}.`);
    }

    if (focus.blastRadius >= 20) {
      blastLines.push("This is a large blast radius. Test changes thoroughly before pushing.");
    }

    sections.push({ heading: "Blast radius", lines: blastLines });
  }

  // Complexity
  if (worstFn && maxCog > 4) {
    const cxLines: string[] = [];
    cxLines.push(
      `Most complex function: ${worstFn.name} (cognitive complexity ${worstFn.cognitive}, ${worstFn.lineCount} lines).`,
    );
    if (maxCog >= 25) {
      cxLines.push("This is alarming complexity. Consider breaking it into smaller functions with clear responsibilities.");
    } else if (maxCog >= 15) {
      cxLines.push("This is high complexity. The function may be hard to modify safely.");
    } else if (maxCog >= 8) {
      cxLines.push("Moderate complexity. Still readable, but watch for growth.");
    }
    if (fns.length > 1) {
      const simple = fns.filter((f) => f.cognitive <= 4).length;
      cxLines.push(`${fns.length} functions total, ${simple} are simple (cognitive <= 4).`);
    }
    sections.push({ heading: "Complexity", lines: cxLines });
  }

  // Churn
  if (focus.gitChanges > 0) {
    const churnLines: string[] = [];
    churnLines.push(
      `Changed ${focus.gitChanges} time(s) in the last ${maxCommits} commits${focus.lastChanged ? `, last ${focus.lastChanged}` : ""}.`,
    );
    if (focus.gitChanges >= 15 && focus.blastRadius >= 5) {
      churnLines.push("High churn + large blast radius = elevated breakage risk. This file deserves extra test coverage.");
    } else if (focus.gitChanges >= 15) {
      churnLines.push("This file changes often. If it also has high complexity, consider stabilizing its interface.");
    }
    sections.push({ heading: "Churn", lines: churnLines });
  }

  // Hidden coupling
  if (hiddenPartners.length > 0) {
    const coupLines: string[] = [];
    for (const p of hiddenPartners) {
      const other = p.fileA === filePath ? p.fileB : p.fileA;
      const pctCo = Math.round(p.couplingRatio * 100);
      coupLines.push(`${other} (${pctCo}% co-change rate, ${p.cochanges} co-commits, no import relationship).`);
    }
    coupLines.push(
      "These files change together but aren't connected via imports. Consider making the relationship explicit or extracting shared logic.",
    );
    sections.push({ heading: "Hidden coupling", lines: coupLines });
  }

  // Exports
  const deadExports = focus.exports.filter((e) => e.dead);
  if (deadExports.length > 0) {
    const expLines: string[] = [];
    expLines.push(
      `${deadExports.length} of ${focus.exports.length} export(s) are unused: ${deadExports.map((e) => e.name).join(", ")}.`,
    );
    expLines.push("Remove dead exports to reduce surface area. Run: impulse refactor . --dry-run");
    sections.push({ heading: "Dead exports", lines: expLines });
  }

  // Tests
  if (focus.testsCovering.length > 0) {
    const testLines: string[] = [];
    testLines.push(`${focus.testsCovering.length} test file(s) cover this file:`);
    for (const t of focus.testsCovering.slice(0, 5)) {
      testLines.push(`  ${t}`);
    }
    if (focus.testsCovering.length > 5) {
      testLines.push(`  ...and ${focus.testsCovering.length - 5} more`);
    }
    sections.push({ heading: "Tests", lines: testLines });
  } else if (focus.blastRadius > 0) {
    sections.push({
      heading: "Tests",
      lines: ["No test files cover this file. Given its blast radius, adding tests would reduce risk."],
    });
  }

  // Ownership (third dimension)
  const ownership = getFileOwnership(rootDir, filePath, maxCommits);
  if (ownership.topAuthors.length > 0) {
    const ownLines: string[] = [];
    const topAuthor = ownership.topAuthors[0];
    const pct = Math.round(topAuthor.share * 100);

    if (ownership.busFactor <= 1) {
      ownLines.push(
        `Single owner: ${topAuthor.name} (${pct}% of commits). Bus factor: 1.`,
      );
      if (focus.blastRadius >= 5) {
        ownLines.push("This file has high blast radius AND a single expert. If they leave, no one can safely modify it.");
      } else {
        ownLines.push("Knowledge is concentrated in one person. Consider pair reviews to spread expertise.");
      }
    } else {
      const names = ownership.topAuthors.slice(0, 3).map((a) => `${a.name} (${Math.round(a.share * 100)}%)`);
      ownLines.push(`${ownership.totalAuthors} author(s): ${names.join(", ")}${ownership.totalAuthors > 3 ? "..." : ""}.`);
      ownLines.push(`Bus factor: ${ownership.busFactor}. Knowledge is distributed.`);
    }

    sections.push({ heading: "Ownership", lines: ownLines });
  }

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

  const langSet = new Set<string>();
  for (const n of fileNodes) {
    const ext = n.filePath.slice(n.filePath.lastIndexOf("."));
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) langSet.add("TypeScript");
    else if (ext === ".py") langSet.add("Python");
    else if (ext === ".go") langSet.add("Go");
    else if (ext === ".rs") langSet.add("Rust");
    else if (ext === ".cs") langSet.add("C#");
    else if (ext === ".java") langSet.add("Java");
    else if (ext === ".kt" || ext === ".kts") langSet.add("Kotlin");
    else if (ext === ".php") langSet.add("PHP");
    else if (ext === ".c" || ext === ".h") langSet.add("C");
    else if ([".cpp", ".hpp", ".cc", ".cxx", ".hxx"].includes(ext)) langSet.add("C++");
  }
  const langs = [...langSet].join(", ") || "unknown";

  const gradeWord = health.score >= 90 ? "excellent" : health.score >= 80 ? "good" : health.score >= 60 ? "moderate" : "concerning";

  const summary = `${totalFiles} files, ${langs}. Architecture health: ${health.score}/100 (${health.grade}) — ${gradeWord}.`;
  const sections: ExplainSection[] = [];

  // Core files — most imported
  const byDependents = fileNodes
    .map((n) => ({ file: n.filePath, deps: graph.getDependents(n.id).filter((e) => e.kind === "imports").length }))
    .filter((f) => f.deps > 0)
    .sort((a, b) => b.deps - a.deps);

  if (byDependents.length > 0) {
    const top = byDependents[0];
    const topPct = Math.round((graph.analyzeFileImpact(top.file).affected.filter((a) => a.node.kind === "file").length / totalFiles) * 100);
    const coreLines: string[] = [];
    coreLines.push(`${top.file} is the heart of this project — ${top.deps} files import it.`);
    coreLines.push(`Changes there can ripple through ${topPct}% of the codebase.`);
    if (byDependents.length >= 2) {
      coreLines.push(`Other central files: ${byDependents.slice(1, 4).map((f) => `${f.file} (${f.deps})`).join(", ")}.`);
    }
    sections.push({ heading: "Core", lines: coreLines });
  }

  // Hotspots
  const criticalHotspots = hotspotReport.hotspots.filter((h) => h.risk === "critical" || h.risk === "high");
  if (criticalHotspots.length > 0) {
    const hotLines: string[] = [];
    for (const h of criticalHotspots.slice(0, 3)) {
      hotLines.push(
        `${h.file} — changes ${h.changes} times, affects ${h.affected} files. ${h.risk.toUpperCase()} risk.`,
      );
    }
    hotLines.push("Hotspots change frequently AND have large blast radius. They're the most likely source of unexpected breakage.");
    sections.push({ heading: "Hotspots", lines: hotLines });
  }

  // Cycles
  if (health.cycles.length > 0) {
    const cycleLines: string[] = [];
    const tight = health.cycles.filter((c) => c.severity === "tight-couple").length;
    const short = health.cycles.filter((c) => c.severity === "short-ring").length;
    const long = health.cycles.filter((c) => c.severity === "long-ring").length;
    const parts: string[] = [];
    if (tight > 0) parts.push(`${tight} tight-couple`);
    if (short > 0) parts.push(`${short} short-ring`);
    if (long > 0) parts.push(`${long} long-ring`);
    cycleLines.push(`${health.cycles.length} dependency cycle(s): ${parts.join(", ")}.`);
    if (long > 0) {
      cycleLines.push("Long rings (5+ files) are architectural problems. Consider extracting shared interfaces.");
    }
    sections.push({ heading: "Cycles", lines: cycleLines });
  }

  // Hidden coupling
  if (coupling.hidden.length > 0) {
    const coupLines: string[] = [];
    coupLines.push(`${coupling.hidden.length} file pair(s) change together in git but have no import relationship.`);
    for (const p of coupling.hidden.slice(0, 3)) {
      coupLines.push(`  ${p.fileA} ↔ ${p.fileB} (${Math.round(p.couplingRatio * 100)}% co-change)`);
    }
    coupLines.push("Hidden coupling means your architecture doesn't reflect real dependencies. Run: impulse coupling .");
    sections.push({ heading: "Hidden coupling", lines: coupLines });
  }

  // Dead exports
  const exportNodes = graph.allNodes().filter((n) => n.kind === "export");
  const deadExports = exportNodes.filter((n) => {
    const consumers = graph.getDependents(n.id).filter((e) => e.kind === "uses_export");
    return consumers.length === 0;
  });
  const barrelPaths = new Set<string>();
  for (const n of fileNodes) {
    const fileExports = graph.getNodesByFile(n.filePath).filter((nn) => nn.kind === "export");
    if (fileExports.length === 0) continue;
    const deps = graph.getDependencies(n.id).filter((e) => e.kind === "imports");
    const hasReExports = fileExports.some((exp) =>
      graph.getDependencies(exp.id).some((e) => e.kind === "uses_export"),
    );
    if (hasReExports && deps.length > 0) barrelPaths.add(n.filePath);
  }
  const nonBarrelDead = deadExports.filter((n) => !barrelPaths.has(n.filePath));

  if (nonBarrelDead.length > 0) {
    sections.push({
      heading: "Dead exports",
      lines: [
        `${nonBarrelDead.length} export(s) have no consumers. Removing them simplifies the codebase.`,
        "Run: impulse refactor . --dry-run",
      ],
    });
  }

  // Suggestions
  if (suggestions.suggestions.length > 0) {
    const sugLines: string[] = [];
    for (const s of suggestions.suggestions.slice(0, 3)) {
      sugLines.push(formatSuggestion(s));
    }
    if (suggestions.estimatedScoreImprovement > 0) {
      sugLines.push(`Implementing these could improve health by ~${suggestions.estimatedScoreImprovement} points.`);
    }
    sections.push({ heading: "What to do next", lines: sugLines });
  } else {
    sections.push({ heading: "What to do next", lines: ["Architecture looks clean. Keep it that way."] });
  }

  return { summary, sections };
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
