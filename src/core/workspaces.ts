import { readFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { existsSync } from "node:fs";
import fg from "fast-glob";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorkspacePackage {
  name: string;
  dir: string;
  main: string | null;
}

export interface WorkspaceInfo {
  tool: "pnpm" | "npm" | "yarn" | "lerna" | "nx" | null;
  packages: WorkspacePackage[];
  rootDir: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function detectWorkspaces(rootDir: string): Promise<WorkspaceInfo> {
  const detectors: Array<() => Promise<WorkspaceInfo | null>> = [
    () => detectPnpm(rootDir),
    () => detectNpmYarn(rootDir),
    () => detectLerna(rootDir),
    () => detectNx(rootDir),
  ];

  for (const detect of detectors) {
    const result = await detect();
    if (result && result.packages.length > 0) return result;
  }

  return { tool: null, packages: [], rootDir };
}

/**
 * Build a map from package name → relative directory for use during import resolution.
 * Also maps `@scope/name` subpath imports like `@scope/name/utils` to the package dir.
 */
export function buildWorkspaceMap(info: WorkspaceInfo): Map<string, WorkspacePackage> {
  const m = new Map<string, WorkspacePackage>();
  for (const pkg of info.packages) {
    m.set(pkg.name, pkg);
  }
  return m;
}

/**
 * Given an import specifier like `@scope/pkg-name` or `@scope/pkg-name/utils`,
 * resolve it to a local file path relative to rootDir — or null if not a workspace import.
 */
export function resolveWorkspaceImport(
  specifier: string,
  workspaceMap: Map<string, WorkspacePackage>,
  rootDir: string,
): string | null {
  const exact = workspaceMap.get(specifier);
  if (exact) return resolvePackageEntry(exact, rootDir);

  const scopeMatch = specifier.match(/^(@[^/]+\/[^/]+)(\/.*)?$/);
  if (scopeMatch) {
    const pkgName = scopeMatch[1];
    const subpath = scopeMatch[2] ?? "";
    const pkg = workspaceMap.get(pkgName);
    if (pkg) {
      if (subpath) return resolveSubpathImport(pkg, subpath, rootDir);
      return resolvePackageEntry(pkg, rootDir);
    }
  }

  const bareName = specifier.split("/")[0];
  const pkg = workspaceMap.get(bareName);
  if (pkg) {
    const subpath = specifier.slice(bareName.length);
    if (subpath) return resolveSubpathImport(pkg, subpath, rootDir);
    return resolvePackageEntry(pkg, rootDir);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

async function detectPnpm(rootDir: string): Promise<WorkspaceInfo | null> {
  const yamlPath = join(rootDir, "pnpm-workspace.yaml");
  try {
    const raw = await readFile(yamlPath, "utf-8");
    const globs = parsePnpmYaml(raw);
    if (globs.length === 0) return null;
    const packages = await resolveWorkspaceGlobs(rootDir, globs);
    return { tool: "pnpm", packages, rootDir };
  } catch {
    return null;
  }
}

async function detectNpmYarn(rootDir: string): Promise<WorkspaceInfo | null> {
  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const globs = pkg.workspaces;
    if (!globs) return null;
    const patterns = Array.isArray(globs) ? globs : globs.packages;
    if (!Array.isArray(patterns) || patterns.length === 0) return null;
    const packages = await resolveWorkspaceGlobs(rootDir, patterns);
    const tool = existsSync(join(rootDir, "yarn.lock")) ? "yarn" : "npm";
    return { tool, packages, rootDir };
  } catch {
    return null;
  }
}

async function detectLerna(rootDir: string): Promise<WorkspaceInfo | null> {
  try {
    const raw = await readFile(join(rootDir, "lerna.json"), "utf-8");
    const config = JSON.parse(raw);
    const globs = config.packages ?? ["packages/*"];
    const packages = await resolveWorkspaceGlobs(rootDir, globs);
    return { tool: "lerna", packages, rootDir };
  } catch {
    return null;
  }
}

async function detectNx(rootDir: string): Promise<WorkspaceInfo | null> {
  if (!existsSync(join(rootDir, "nx.json"))) return null;
  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const globs = pkg.workspaces;
    if (Array.isArray(globs) && globs.length > 0) {
      const packages = await resolveWorkspaceGlobs(rootDir, globs);
      return { tool: "nx", packages, rootDir };
    }
    const defaultGlobs = ["packages/*", "apps/*", "libs/*"];
    const packages = await resolveWorkspaceGlobs(rootDir, defaultGlobs);
    if (packages.length > 0) return { tool: "nx", packages, rootDir };
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

function parsePnpmYaml(raw: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "packages:" || trimmed === "packages :") {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (!trimmed.startsWith("-") && !trimmed.startsWith("'") && !trimmed.startsWith('"')) {
        if (trimmed.length > 0 && !trimmed.startsWith("#")) break;
        continue;
      }
      const value = trimmed.replace(/^-\s*/, "").replace(/^['"]|['"]$/g, "").trim();
      if (value) globs.push(value);
    }
  }
  return globs;
}

async function resolveWorkspaceGlobs(rootDir: string, globs: string[]): Promise<WorkspacePackage[]> {
  const packageJsonGlobs = globs
    .filter((g) => !g.startsWith("!"))
    .map((g) => g.endsWith("/") ? `${g}package.json` : `${g}/package.json`);

  const negations = globs
    .filter((g) => g.startsWith("!"))
    .map((g) => g.slice(1).replace(/\/?$/, "/**"));

  const found = await fg(packageJsonGlobs, {
    cwd: rootDir,
    ignore: ["**/node_modules/**", ...negations],
    absolute: false,
  });

  const packages: WorkspacePackage[] = [];

  for (const pkgJsonPath of found) {
    try {
      const raw = await readFile(join(rootDir, pkgJsonPath), "utf-8");
      const pkg = JSON.parse(raw);
      if (!pkg.name) continue;

      const dir = dirname(pkgJsonPath);
      const main = resolveMainField(pkg);

      packages.push({ name: pkg.name, dir, main });
    } catch {
      continue;
    }
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}

function resolveMainField(pkg: Record<string, unknown>): string | null {
  const exports = pkg.exports;
  if (typeof exports === "string") return exports;
  if (exports && typeof exports === "object" && !Array.isArray(exports)) {
    const dot = (exports as Record<string, unknown>)["."];
    if (typeof dot === "string") return dot;
    if (dot && typeof dot === "object") {
      const d = dot as Record<string, unknown>;
      const entry = d.import ?? d.require ?? d.default;
      if (typeof entry === "string") return entry;
    }
  }

  if (typeof pkg.main === "string") return pkg.main;
  if (typeof pkg.module === "string") return pkg.module;
  return null;
}

function resolvePackageEntry(pkg: WorkspacePackage, rootDir: string): string | null {
  if (pkg.main) {
    const entryPath = join(pkg.dir, pkg.main);
    return resolveEntryFile(entryPath, rootDir);
  }

  const defaults = ["src/index.ts", "src/index.tsx", "index.ts", "index.tsx", "src/index.js", "index.js"];
  for (const d of defaults) {
    const candidate = join(pkg.dir, d);
    if (existsSync(join(rootDir, candidate))) return candidate;
  }
  return null;
}

function resolveSubpathImport(pkg: WorkspacePackage, subpath: string, rootDir: string): string | null {
  const rel = join(pkg.dir, "src", subpath);
  return resolveEntryFile(rel, rootDir);
}

function resolveEntryFile(relPath: string, rootDir: string): string | null {
  if (existsSync(join(rootDir, relPath))) return relPath;

  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];
  for (const ext of extensions) {
    if (existsSync(join(rootDir, relPath + ext))) return relPath + ext;
  }

  for (const idx of ["index.ts", "index.tsx", "index.js"]) {
    const candidate = join(relPath, idx);
    if (existsSync(join(rootDir, candidate))) return candidate;
  }

  return null;
}
