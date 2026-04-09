import { execSync } from "node:child_process";
import type { DependencyGraph } from "./graph.js";
import { isTestFile } from "./test-targets.js";

export interface FocusExport {
  name: string;
  consumers: string[];
  dead: boolean;
}

export interface FocusReport {
  file: string;
  exists: boolean;
  imports: string[];
  importedBy: string[];
  exports: FocusExport[];
  blastRadius: number;
  /** Files at each depth level in the impact tree */
  impactByDepth: Record<number, number>;
  testsCovering: string[];
  gitChanges: number;
  lastChanged: string | null;
  topCochangers: Array<{ file: string; cochanges: number }>;
}

export function focusFile(
  graph: DependencyGraph,
  filePath: string,
  rootDir: string,
): FocusReport {
  const fileId = `file:${filePath}`;
  const node = graph.getNode(fileId);

  if (!node) {
    return {
      file: filePath, exists: false,
      imports: [], importedBy: [], exports: [],
      blastRadius: 0, impactByDepth: {}, testsCovering: [],
      gitChanges: 0, lastChanged: null, topCochangers: [],
    };
  }

  const deps = graph.getDependencies(fileId).filter((e) => e.kind === "imports");
  const imports = deps
    .map((e) => e.to.replace(/^(file:|external:)/, ""))
    .sort((a, b) => {
      const aExt = a.startsWith("external:") || !a.includes("/");
      const bExt = b.startsWith("external:") || !b.includes("/");
      if (aExt !== bExt) return aExt ? 1 : -1;
      return a.localeCompare(b);
    });

  const revDeps = graph.getDependents(fileId).filter((e) => e.kind === "imports");
  const importedBy = revDeps.map((e) => e.from.replace(/^file:/, "")).sort();

  const declaredExports = graph.getDeclaredExports(filePath);
  const allEdges = graph.allEdges();
  const exports: FocusExport[] = declaredExports.map((exp) => {
    const consumers = allEdges
      .filter((e) => e.to === exp.id && e.kind === "uses_export")
      .map((e) => e.from.replace(/^file:/, ""));
    return { name: exp.name, consumers, dead: consumers.length === 0 };
  });

  const impact = graph.analyzeFileImpact(filePath);
  const fileImpact = impact.affected.filter((a) => a.node.kind === "file");
  const blastRadius = fileImpact.length;

  const impactByDepth: Record<number, number> = {};
  for (const a of fileImpact) {
    impactByDepth[a.depth] = (impactByDepth[a.depth] ?? 0) + 1;
  }

  const testsCovering = fileImpact
    .filter((a) => isTestFile(a.node.filePath))
    .map((a) => a.node.filePath)
    .sort();

  const { changes, lastChanged } = getFileGitInfo(rootDir, filePath);
  const topCochangers = getTopCochangers(rootDir, filePath, 5);

  return {
    file: filePath, exists: true,
    imports, importedBy, exports,
    blastRadius, impactByDepth, testsCovering,
    gitChanges: changes, lastChanged, topCochangers,
  };
}

function getFileGitInfo(rootDir: string, filePath: string): { changes: number; lastChanged: string | null } {
  try {
    const countRaw = execSync(
      `git log --oneline -- "${filePath}" | wc -l`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const changes = parseInt(countRaw, 10) || 0;

    let lastChanged: string | null = null;
    if (changes > 0) {
      lastChanged = execSync(
        `git log -1 --format="%ar" -- "${filePath}"`,
        { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    }

    return { changes, lastChanged };
  } catch {
    return { changes: 0, lastChanged: null };
  }
}

function getTopCochangers(rootDir: string, filePath: string, limit: number): Array<{ file: string; cochanges: number }> {
  try {
    const raw = execSync(
      `git log --pretty=format:"---" --name-only -- "${filePath}" | head -500`,
      { cwd: rootDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    const counts = new Map<string, number>();
    let inCommit = false;

    for (const line of raw.split("\n")) {
      if (line.trim() === "---") {
        inCommit = true;
        continue;
      }
      const file = line.trim();
      if (file.length > 0 && file !== filePath && inCommit) {
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([file, cochanges]) => ({ file, cochanges }));
  } catch {
    return [];
  }
}
