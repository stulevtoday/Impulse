import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DependencyGraph } from "./graph.js";

export interface EnvVariable {
  name: string;
  definedIn: string[];
  usedBy: string[];
  hasDefault: boolean;
}

const ENV_FILES = [".env", ".env.local", ".env.development", ".env.production", ".env.example"];

export async function loadEnvFiles(rootDir: string): Promise<Map<string, string[]>> {
  const vars = new Map<string, string[]>();

  for (const filename of ENV_FILES) {
    try {
      const content = await readFile(join(rootDir, filename), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 1) continue;
        const name = trimmed.slice(0, eqIdx).trim();
        const existing = vars.get(name) ?? [];
        existing.push(filename);
        vars.set(name, existing);
      }
    } catch {
      continue;
    }
  }

  return vars;
}

export function analyzeEnv(
  graph: DependencyGraph,
  envDefinitions: Map<string, string[]>,
): EnvVariable[] {
  const envNodes = graph.allNodes().filter((n) => n.kind === "env_var");
  const usageMap = new Map<string, Set<string>>();

  for (const node of envNodes) {
    const existing = usageMap.get(node.name) ?? new Set();
    existing.add(node.filePath);
    usageMap.set(node.name, existing);
  }

  const allNames = new Set([...envDefinitions.keys(), ...usageMap.keys()]);
  const result: EnvVariable[] = [];

  for (const name of allNames) {
    result.push({
      name,
      definedIn: envDefinitions.get(name) ?? [],
      usedBy: [...(usageMap.get(name) ?? [])],
      hasDefault: (envDefinitions.get(name) ?? []).length > 0,
    });
  }

  result.sort((a, b) => {
    if (a.definedIn.length === 0 && b.definedIn.length > 0) return -1;
    if (a.definedIn.length > 0 && b.definedIn.length === 0) return 1;
    return b.usedBy.length - a.usedBy.length;
  });

  return result;
}
