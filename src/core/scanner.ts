import fg from "fast-glob";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ScanResult {
  rootDir: string;
  files: string[];
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/vendor/**",
  "**/*.min.js",
  "**/*.map",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/*.egg-info/**",
  "**/.mypy_cache/**",
  "**/.pytest_cache/**",
  "**/Migrations/**",
  "**/obj/**",
  "**/bin/**",
];

const SUPPORTED_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mts",
  "mjs",
  "cts",
  "cjs",
  "py",
  "go",
  "rs",
  "cs",
];

export async function scanProject(rootDir: string): Promise<ScanResult> {
  const patterns = SUPPORTED_EXTENSIONS.map((ext) => `**/*.${ext}`);

  const gitignorePatterns = await loadGitignore(rootDir);
  const ignore = [...DEFAULT_IGNORE, ...gitignorePatterns];

  const files = await fg(patterns, {
    cwd: rootDir,
    ignore,
    absolute: false,
    dot: false,
  });

  files.sort();

  return { rootDir, files };
}

async function loadGitignore(rootDir: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootDir, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((pattern) => {
        if (pattern.endsWith("/")) return `${pattern}**`;
        return pattern;
      });
  } catch {
    return [];
  }
}
