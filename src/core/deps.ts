import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DependencyGraph } from "./graph.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DepCategory = "builtin" | "package" | "system";
export type DepRisk = "critical" | "high" | "medium" | "low";

export interface ExternalDep {
  name: string;
  category: DepCategory;
  usedBy: string[];
  usageCount: number;
  risk: DepRisk;
  /** Percentage of project files using this dependency */
  penetration: number;
}

export interface PhantomDep {
  name: string;
  source: string;
}

export interface DepCluster {
  category: DepCategory;
  count: number;
  totalUsage: number;
}

export interface DepsReport {
  dependencies: ExternalDep[];
  phantoms: PhantomDep[];
  clusters: DepCluster[];
  riskDistribution: Record<DepRisk, number>;
  totalPackages: number;
  totalFiles: number;
  topHeavy: ExternalDep[];
  surfaceDeps: ExternalDep[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Builtin package detection
// ---------------------------------------------------------------------------

const NODE_BUILTINS = new Set([
  "node:assert", "node:assert/strict", "node:buffer", "node:child_process",
  "node:cluster", "node:console", "node:constants", "node:crypto",
  "node:dgram", "node:dns", "node:domain", "node:events", "node:fs",
  "node:fs/promises", "node:http", "node:http2", "node:https", "node:inspector",
  "node:module", "node:net", "node:os", "node:path", "node:path/posix",
  "node:path/win32", "node:perf_hooks", "node:process", "node:querystring",
  "node:readline", "node:repl", "node:stream", "node:stream/promises",
  "node:stream/web", "node:string_decoder", "node:test", "node:timers",
  "node:timers/promises", "node:tls", "node:trace_events", "node:tty",
  "node:url", "node:util", "node:util/types", "node:v8", "node:vm",
  "node:wasi", "node:worker_threads", "node:zlib",
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "http2",
  "https", "module", "net", "os", "path", "perf_hooks", "process",
  "querystring", "readline", "repl", "stream", "string_decoder", "timers",
  "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

function isBuiltin(name: string): boolean {
  if (NODE_BUILTINS.has(name)) return true;
  if (name.startsWith("node:")) return true;
  if (name.startsWith("std::") || name === "std") return true;
  if (name.startsWith("java.") || name.startsWith("javax.") || name.startsWith("kotlin.")) return true;
  if (name.endsWith(".h") && !name.includes("/")) return true;
  return false;
}

function categorize(name: string): DepCategory {
  if (isBuiltin(name)) return "builtin";
  if (name.includes("/") && !name.startsWith("@")) return "system";
  return "package";
}

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

function classifyRisk(penetration: number): DepRisk {
  if (penetration >= 40) return "critical";
  if (penetration >= 20) return "high";
  if (penetration >= 5) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Package manifest detection — find declared deps to compare with actual usage
// ---------------------------------------------------------------------------

interface ManifestDeps {
  deps: string[];
  source: string;
}

async function loadDeclaredDeps(rootDir: string): Promise<ManifestDeps[]> {
  const loaders = [
    loadPackageJson, loadGoMod, loadCargoToml,
    loadRequirementsTxt, loadPyprojectToml, loadComposerJson,
  ];
  const results: ManifestDeps[] = [];
  for (const loader of loaders) {
    results.push(...await loader(rootDir));
  }
  return results;
}

async function tryReadFile(path: string): Promise<string | null> {
  try { return await readFile(path, "utf-8"); } catch { return null; }
}

async function loadPackageJson(rootDir: string): Promise<ManifestDeps[]> {
  const raw = await tryReadFile(join(rootDir, "package.json"));
  if (!raw) return [];
  const pkg = JSON.parse(raw);
  const results: ManifestDeps[] = [];
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  if (deps.length > 0) results.push({ deps, source: "package.json dependencies" });
  if (devDeps.length > 0) results.push({ deps: devDeps, source: "package.json devDependencies" });
  return results;
}

async function loadGoMod(rootDir: string): Promise<ManifestDeps[]> {
  const raw = await tryReadFile(join(rootDir, "go.mod"));
  if (!raw) return [];
  const deps: string[] = [];
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s+(\S+)\s+v/);
    if (match) deps.push(match[1]);
  }
  return deps.length > 0 ? [{ deps, source: "go.mod" }] : [];
}

async function loadCargoToml(rootDir: string): Promise<ManifestDeps[]> {
  const raw = await tryReadFile(join(rootDir, "Cargo.toml"));
  if (!raw) return [];
  const deps: string[] = [];
  let inDeps = false;
  for (const line of raw.split("\n")) {
    if (/^\[dependencies\]/.test(line) || /^\[dev-dependencies\]/.test(line)) { inDeps = true; continue; }
    if (/^\[/.test(line)) { inDeps = false; continue; }
    if (inDeps) {
      const match = line.match(/^(\w[\w-]*)\s*=/);
      if (match) deps.push(match[1]);
    }
  }
  return deps.length > 0 ? [{ deps, source: "Cargo.toml" }] : [];
}

async function loadRequirementsTxt(rootDir: string): Promise<ManifestDeps[]> {
  const raw = await tryReadFile(join(rootDir, "requirements.txt"));
  if (!raw) return [];
  const deps: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^([\w][\w.-]*)/);
    if (match) deps.push(match[1]);
  }
  return deps.length > 0 ? [{ deps, source: "requirements.txt" }] : [];
}

async function loadPyprojectToml(rootDir: string): Promise<ManifestDeps[]> {
  const raw = await tryReadFile(join(rootDir, "pyproject.toml"));
  if (!raw) return [];
  const deps: string[] = [];
  let inDeps = false;
  for (const line of raw.split("\n")) {
    if (/^dependencies\s*=\s*\[/.test(line) || (/^\s+"/.test(line) && inDeps)) {
      inDeps = true;
      const match = line.match(/"([\w][\w.-]*)[\s><=!~]/);
      if (match) deps.push(match[1]);
      if (line.includes("]")) inDeps = false;
      continue;
    }
    if (inDeps && line.includes("]")) { inDeps = false; continue; }
  }
  return deps.length > 0 ? [{ deps, source: "pyproject.toml" }] : [];
}

async function loadComposerJson(rootDir: string): Promise<ManifestDeps[]> {
  const raw = await tryReadFile(join(rootDir, "composer.json"));
  if (!raw) return [];
  const pkg = JSON.parse(raw);
  const results: ManifestDeps[] = [];
  const deps = Object.keys(pkg.require ?? {}).filter((d: string) => d !== "php" && !d.startsWith("ext-"));
  const devDeps = Object.keys(pkg["require-dev"] ?? {});
  if (deps.length > 0) results.push({ deps, source: "composer.json require" });
  if (devDeps.length > 0) results.push({ deps: devDeps, source: "composer.json require-dev" });
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeDeps(
  graph: DependencyGraph,
  rootDir: string,
): Promise<DepsReport> {
  const start = performance.now();

  const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
  const totalFiles = fileNodes.length;
  const extEdges = graph.allEdges().filter((e) => e.to.startsWith("external:"));

  const depMap = new Map<string, Set<string>>();
  for (const edge of extEdges) {
    const pkg = edge.to.replace("external:", "");
    const file = edge.from.replace("file:", "");
    if (!depMap.has(pkg)) depMap.set(pkg, new Set());
    depMap.get(pkg)!.add(file);
  }

  const dependencies: ExternalDep[] = [];
  for (const [name, files] of depMap) {
    const usedBy = [...files].sort();
    const penetration = totalFiles > 0 ? Math.round((usedBy.length / totalFiles) * 100) : 0;
    dependencies.push({
      name,
      category: categorize(name),
      usedBy,
      usageCount: usedBy.length,
      risk: classifyRisk(penetration),
      penetration,
    });
  }

  dependencies.sort((a, b) => b.usageCount - a.usageCount);

  const manifests = await loadDeclaredDeps(rootDir);
  const usedPackages = new Set(dependencies.filter((d) => d.category === "package").map((d) => normalizePkgName(d.name)));

  const phantoms: PhantomDep[] = [];
  for (const manifest of manifests) {
    for (const declared of manifest.deps) {
      if (!usedPackages.has(normalizePkgName(declared))) {
        phantoms.push({ name: declared, source: manifest.source });
      }
    }
  }

  const clusterMap = new Map<DepCategory, { count: number; totalUsage: number }>();
  for (const dep of dependencies) {
    const c = clusterMap.get(dep.category) ?? { count: 0, totalUsage: 0 };
    c.count++;
    c.totalUsage += dep.usageCount;
    clusterMap.set(dep.category, c);
  }
  const clusters: DepCluster[] = [];
  for (const [category, data] of clusterMap) {
    clusters.push({ category, ...data });
  }
  clusters.sort((a, b) => b.totalUsage - a.totalUsage);

  const dist: Record<DepRisk, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const dep of dependencies) dist[dep.risk]++;

  const topHeavy = dependencies.filter((d) => d.penetration >= 20);
  const surfaceDeps = dependencies.filter((d) => d.usageCount === 1 && d.category === "package");

  const durationMs = Math.round(performance.now() - start);

  return {
    dependencies,
    phantoms,
    clusters,
    riskDistribution: dist,
    totalPackages: dependencies.filter((d) => d.category === "package").length,
    totalFiles,
    topHeavy,
    surfaceDeps,
    durationMs,
  };
}

function normalizePkgName(name: string): string {
  return name.toLowerCase().replace(/[_.-]+/g, "-");
}
