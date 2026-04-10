import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { DependencyGraph } from "./graph.js";

// ---------------------------------------------------------------------------
// Plugin API — this is the contract plugins implement
// ---------------------------------------------------------------------------

export interface PluginContext {
  graph: DependencyGraph;
  rootDir: string;
  files: string[];
}

export interface PluginViolation {
  severity: "error" | "warning" | "info";
  file: string;
  line?: number;
  message: string;
  rule: string;
}

export interface PluginResult {
  violations: PluginViolation[];
}

export type ImpulsePlugin = (ctx: PluginContext) => PluginResult | Promise<PluginResult>;

export interface PluginMeta {
  name: string;
  path: string;
}

export interface PluginRunResult {
  pluginName: string;
  violations: PluginViolation[];
  durationMs: number;
  error?: string;
}

export interface AllPluginsResult {
  results: PluginRunResult[];
  totalViolations: number;
  errors: number;
  pluginsRun: number;
}

// ---------------------------------------------------------------------------
// Plugin discovery — finds .js/.mjs files in .impulse/plugins/
// ---------------------------------------------------------------------------

export async function discoverPlugins(rootDir: string): Promise<PluginMeta[]> {
  const pluginDir = join(rootDir, ".impulse", "plugins");
  if (!existsSync(pluginDir)) return [];

  const entries = await readdir(pluginDir).catch(() => [] as string[]);
  return entries
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
    .map((f) => ({
      name: f.replace(/\.(m?js)$/, ""),
      path: resolve(pluginDir, f),
    }));
}

// ---------------------------------------------------------------------------
// Plugin loading + execution
// ---------------------------------------------------------------------------

async function loadPlugin(meta: PluginMeta): Promise<ImpulsePlugin | null> {
  try {
    const url = pathToFileURL(meta.path).href;
    const mod = await import(url);
    const fn = mod.default ?? mod;
    if (typeof fn !== "function") return null;
    return fn as ImpulsePlugin;
  } catch {
    return null;
  }
}

export async function runPlugins(
  graph: DependencyGraph,
  rootDir: string,
): Promise<AllPluginsResult> {
  const plugins = await discoverPlugins(rootDir);
  if (plugins.length === 0) {
    return { results: [], totalViolations: 0, errors: 0, pluginsRun: 0 };
  }

  const files = graph.allNodes()
    .filter((n) => n.kind === "file")
    .map((n) => n.filePath);

  const ctx: PluginContext = { graph, rootDir, files };
  const results: PluginRunResult[] = [];

  for (const meta of plugins) {
    const start = performance.now();
    const fn = await loadPlugin(meta);

    if (!fn) {
      results.push({
        pluginName: meta.name,
        violations: [],
        durationMs: 0,
        error: `Failed to load — plugin must export a default function`,
      });
      continue;
    }

    try {
      const result = await fn(ctx);
      const durationMs = Math.round(performance.now() - start);
      results.push({
        pluginName: meta.name,
        violations: result.violations ?? [],
        durationMs,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      results.push({
        pluginName: meta.name,
        violations: [],
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalViolations = results.reduce((s, r) => s + r.violations.length, 0);
  const errors = results.filter((r) => r.error).length;

  return { results, totalViolations, errors, pluginsRun: plugins.length };
}
