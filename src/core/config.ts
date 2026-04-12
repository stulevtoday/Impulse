import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BoundaryRule, ImpulseConfig } from "./config-types.js";

export type { BoundaryRule, ImpulseConfig } from "./config-types.js";

const CONFIG_NAMES = [".impulserc.json", ".impulserc", "impulse.config.json"];

export async function loadConfig(rootDir: string): Promise<ImpulseConfig> {
  for (const name of CONFIG_NAMES) {
    let raw: string;
    try {
      raw = await readFile(join(rootDir, name), "utf-8");
    } catch {
      continue;
    }

    const parsed = JSON.parse(raw);
    return validateConfig(parsed, name);
  }
  return {};
}

function validateConfig(raw: unknown, filename: string): ImpulseConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${filename}: config must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  const config: ImpulseConfig = {};

  if (obj.exclude !== undefined) config.exclude = validateExclude(obj.exclude, filename);
  if (obj.boundaries !== undefined) config.boundaries = validateBoundaries(obj.boundaries, filename);
  if (obj.thresholds !== undefined) config.thresholds = validateThresholds(obj.thresholds, filename);

  return config;
}

function validateExclude(value: unknown, filename: string): string[] {
  if (!Array.isArray(value) || !value.every((e) => typeof e === "string")) {
    throw new Error(`${filename}: "exclude" must be an array of strings`);
  }
  return value;
}

function validateBoundaries(value: unknown, filename: string): Record<string, BoundaryRule> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${filename}: "boundaries" must be an object`);
  }

  const boundaries = value as Record<string, unknown>;
  const result: Record<string, BoundaryRule> = {};

  for (const [name, rule] of Object.entries(boundaries)) {
    result[name] = validateBoundaryRule(rule, name, boundaries, filename);
  }

  return result;
}

function validateBoundaryRule(rule: unknown, name: string, allBoundaries: Record<string, unknown>, filename: string): BoundaryRule {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    throw new Error(`${filename}: boundary "${name}" must be an object`);
  }

  const r = rule as Record<string, unknown>;

  if (typeof r.path !== "string") {
    throw new Error(`${filename}: boundary "${name}" must have a "path" string`);
  }

  if (!Array.isArray(r.allow) || !r.allow.every((a) => typeof a === "string")) {
    throw new Error(`${filename}: boundary "${name}" must have an "allow" array of strings`);
  }

  const unknownRefs = r.allow.filter((a) => !(a as string in allBoundaries));
  if (unknownRefs.length > 0) {
    throw new Error(`${filename}: boundary "${name}" references unknown boundaries: ${(unknownRefs as string[]).join(", ")}`);
  }

  return { path: r.path, allow: r.allow as string[] };
}

function validateThresholds(value: unknown, filename: string): ImpulseConfig["thresholds"] {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${filename}: "thresholds" must be an object`);
  }

  const t = value as Record<string, unknown>;
  const thresholds: ImpulseConfig["thresholds"] = {};

  if (t.health !== undefined) {
    if (typeof t.health !== "number" || t.health < 0 || t.health > 100) {
      throw new Error(`${filename}: "thresholds.health" must be a number 0-100`);
    }
    thresholds.health = t.health;
  }

  if (t.maxChainDepth !== undefined) {
    if (typeof t.maxChainDepth !== "number" || t.maxChainDepth < 1) {
      throw new Error(`${filename}: "thresholds.maxChainDepth" must be a positive number`);
    }
    thresholds.maxChainDepth = t.maxChainDepth;
  }

  return thresholds;
}
