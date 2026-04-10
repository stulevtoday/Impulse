import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DependencyGraph } from "./graph.js";

export interface RefactorAction {
  type: "remove-export" | "delete-line";
  file: string;
  line: number;
  description: string;
  before: string;
  after: string;
}

export interface RefactorPlan {
  actions: RefactorAction[];
  filesAffected: number;
  exportsRemoved: number;
}

export interface RefactorResult {
  applied: RefactorAction[];
  skipped: RefactorAction[];
  filesWritten: string[];
}

/**
 * Plan dead export removals: for each unused export, generate an action
 * that strips the `export` keyword (or removes the entire export clause line).
 */
export function planDeadExportRemovals(
  graph: DependencyGraph,
  rootDir: string,
): RefactorPlan {
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const allEdges = graph.allEdges();
  const actions: RefactorAction[] = [];

  for (const file of fileNodes) {
    if (isBarrelFile(graph, file.filePath)) continue;

    const declared = graph.getDeclaredExports(file.filePath);
    for (const exp of declared) {
      const users = allEdges.filter((e) => e.to === exp.id && e.kind === "uses_export");
      if (users.length > 0) continue;

      const action = buildRemoveExportAction(rootDir, file.filePath, exp.name, exp.line);
      if (action) actions.push(action);
    }
  }

  const filesAffected = new Set(actions.map((a) => a.file)).size;
  return { actions, filesAffected, exportsRemoved: actions.length };
}

/**
 * Apply a refactor plan: write the modified files to disk.
 * Groups actions by file and applies them bottom-up (highest line first)
 * to preserve line numbers during multi-edit.
 */
export function applyRefactorPlan(
  plan: RefactorPlan,
  rootDir: string,
): RefactorResult {
  const applied: RefactorAction[] = [];
  const skipped: RefactorAction[] = [];
  const filesWritten: string[] = [];

  const byFile = new Map<string, RefactorAction[]>();
  for (const action of plan.actions) {
    const list = byFile.get(action.file) ?? [];
    list.push(action);
    byFile.set(action.file, list);
  }

  for (const [file, fileActions] of byFile) {
    const fullPath = join(rootDir, file);
    let lines: string[];
    try {
      lines = readFileSync(fullPath, "utf-8").split("\n");
    } catch {
      for (const a of fileActions) skipped.push(a);
      continue;
    }

    fileActions.sort((a, b) => b.line - a.line);

    for (const action of fileActions) {
      const idx = action.line - 1;
      if (idx < 0 || idx >= lines.length) {
        skipped.push(action);
        continue;
      }

      if (action.type === "remove-export") {
        const current = lines[idx];
        const modified = removeExportKeyword(current, action.description.includes("re-export clause"));
        if (modified !== null && modified !== current) {
          lines[idx] = modified;
          applied.push(action);
        } else {
          skipped.push(action);
        }
      } else if (action.type === "delete-line") {
        lines.splice(idx, 1);
        applied.push(action);
      }
    }

    if (fileActions.some((a) => applied.includes(a))) {
      writeFileSync(fullPath, lines.join("\n"), "utf-8");
      filesWritten.push(file);
    }
  }

  return { applied, skipped, filesWritten };
}

function buildRemoveExportAction(
  rootDir: string,
  filePath: string,
  exportName: string,
  exportLine?: number,
): RefactorAction | null {
  const fullPath = join(rootDir, filePath);
  let source: string;
  try {
    source = readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }

  const lines = source.split("\n");

  const namedExportRe = new RegExp(
    `^(\\s*)export\\s+((?:async\\s+)?(?:function|class|interface|type|enum|const|let|var)\\s+${escRe(exportName)}\\b)`,
  );
  const clauseRe = new RegExp(`^\\s*export\\s*\\{[^}]*\\b${escRe(exportName)}\\b[^}]*\\}`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const namedMatch = namedExportRe.exec(line);
    if (namedMatch) {
      const before = line;
      const after = `${namedMatch[1]}${namedMatch[2]}`;
      return {
        type: "remove-export",
        file: filePath,
        line: i + 1,
        description: `Remove export from ${exportName}`,
        before,
        after,
      };
    }

    if (clauseRe.test(line)) {
      const names = extractClauseNames(line);
      if (names.length === 1 && names[0] === exportName) {
        return {
          type: "delete-line",
          file: filePath,
          line: i + 1,
          description: `Remove re-export clause for ${exportName}`,
          before: line,
          after: "",
        };
      }
    }
  }

  return null;
}

function removeExportKeyword(line: string, _isClause: boolean): string | null {
  const match = line.match(/^(\s*)export\s+((?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+)/);
  if (match) {
    return `${match[1]}${match[2]}`;
  }
  const defaultMatch = line.match(/^(\s*)export\s+default\s+/);
  if (defaultMatch) {
    return `${defaultMatch[1]}`;
  }
  return null;
}

function extractClauseNames(line: string): string[] {
  const match = line.match(/export\s*\{([^}]+)\}/);
  if (!match) return [];
  return match[1].split(",").map((s) => {
    const parts = s.trim().split(/\s+as\s+/);
    return parts[parts.length - 1].trim();
  }).filter(Boolean);
}

function isBarrelFile(graph: DependencyGraph, filePath: string): boolean {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  if (!fileName.startsWith("index.")) return false;
  const deps = graph.getDependencies(`file:${filePath}`);
  return deps.filter((e) => e.kind === "imports" && e.metadata?.reexport).length >= 2;
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
