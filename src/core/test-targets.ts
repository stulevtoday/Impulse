import { execSync } from "node:child_process";
import type { DependencyGraph } from "./graph.js";

export interface TestTarget {
  testFile: string;
  triggeredBy: string;
  depth: number;
  /** Shortest dependency chain from the changed file to this test */
  chain: string[];
}

export interface TestTargetReport {
  changedFiles: string[];
  targets: TestTarget[];
  /** Suggested shell command to run only these tests */
  runCommand: string | null;
  analysisMs?: number;
}

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.go$/,
  /_test\.py$/,
  /^test_.*\.py$/,
  /tests?\/.*\.[jt]sx?$/,
  /__tests__\/.*\.[jt]sx?$/,
];

export function isTestFile(filePath: string): boolean {
  const name = filePath.includes("/") ? filePath.slice(filePath.lastIndexOf("/") + 1) : filePath;
  return TEST_PATTERNS.some((p) => p.test(filePath) || p.test(name));
}

export function findTestTargets(
  graph: DependencyGraph,
  changedFiles: string[],
): TestTargetReport {
  const fileSet = new Set(
    graph.allNodes().filter((n) => n.kind === "file").map((n) => n.filePath),
  );
  const knownChanged = changedFiles.filter((f) => fileSet.has(f));
  const changedSet = new Set(knownChanged);

  const targetMap = new Map<string, TestTarget>();

  for (const changed of knownChanged) {
    if (isTestFile(changed) && !targetMap.has(changed)) {
      targetMap.set(changed, {
        testFile: changed,
        triggeredBy: changed,
        depth: 0,
        chain: [changed],
      });
    }

    const impact = graph.analyzeFileImpact(changed);

    for (const item of impact.affected) {
      if (item.node.kind !== "file") continue;
      if (changedSet.has(item.node.filePath)) continue;
      if (!isTestFile(item.node.filePath)) continue;

      const existing = targetMap.get(item.node.filePath);
      if (!existing || item.depth < existing.depth) {
        const chain = item.path
          .map((id) => id.replace(/^file:/, ""))
          .filter((p) => fileSet.has(p));

        targetMap.set(item.node.filePath, {
          testFile: item.node.filePath,
          triggeredBy: changed,
          depth: item.depth,
          chain: chain.length > 0 ? chain : [changed, item.node.filePath],
        });
      }
    }
  }

  const targets = [...targetMap.values()].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.testFile.localeCompare(b.testFile);
  });

  const runCommand = buildRunCommand(targets);

  return { changedFiles, targets, runCommand };
}

function buildRunCommand(targets: TestTarget[]): string | null {
  if (targets.length === 0) return null;

  const extensions = new Set(
    targets.map((t) => {
      const dot = t.testFile.lastIndexOf(".");
      return dot >= 0 ? t.testFile.slice(dot) : "";
    }),
  );

  if (extensions.has(".go")) {
    const packages = new Set(
      targets.map((t) => {
        const slash = t.testFile.lastIndexOf("/");
        return slash >= 0 ? "./" + t.testFile.slice(0, slash) : ".";
      }),
    );
    return `go test ${[...packages].join(" ")}`;
  }

  if (extensions.has(".py")) {
    return `pytest ${targets.map((t) => t.testFile).join(" ")}`;
  }

  const files = targets.map((t) => `'${t.testFile}'`).join(" ");
  return `node --test ${files}`;
}

export function getChangedFiles(rootDir: string, staged: boolean): string[] {
  try {
    const cmd = staged ? "git diff --cached --name-only" : "git diff --name-only HEAD";
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
