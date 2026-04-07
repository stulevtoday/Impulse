import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface PathAlias {
  prefix: string;
  paths: string[];
}

export interface TsConfigInfo {
  aliases: PathAlias[];
  baseUrl: string | null;
}

/**
 * Load path aliases from tsconfig.json and any referenced configs.
 * Walks "extends" and "references" to find all "paths" definitions.
 */
export async function loadTsConfigAliases(
  rootDir: string,
): Promise<TsConfigInfo> {
  const aliases: PathAlias[] = [];
  let baseUrl: string | null = null;

  const configNames = [
    "tsconfig.json",
    "tsconfig.web.json",
    "tsconfig.app.json",
    "tsconfig.lib.json",
  ];

  for (const name of configNames) {
    try {
      const result = await parseTsConfig(join(rootDir, name));
      if (result.aliases.length > 0) {
        aliases.push(...result.aliases);
      }
      if (result.baseUrl && !baseUrl) {
        baseUrl = result.baseUrl;
      }
    } catch {
      continue;
    }
  }

  return { aliases, baseUrl };
}

async function parseTsConfig(
  configPath: string,
): Promise<TsConfigInfo> {
  const raw = await readFile(configPath, "utf-8");
  const stripped = stripJsonComments(raw);
  const config = JSON.parse(stripped);
  const configDir = dirname(configPath);

  const aliases: PathAlias[] = [];
  let baseUrl: string | null = null;

  const opts = config.compilerOptions;
  if (opts) {
    if (opts.baseUrl) {
      baseUrl = join(configDir, opts.baseUrl);
    }

    if (opts.paths) {
      for (const [pattern, targets] of Object.entries(opts.paths)) {
        const prefix = pattern.replace(/\*$/, "");
        const paths = (targets as string[]).map((t) => {
          const resolved = t.replace(/\*$/, "");
          if (baseUrl) {
            return join(baseUrl, resolved);
          }
          return join(configDir, resolved);
        });
        aliases.push({ prefix, paths });
      }
    }
  }

  if (config.extends) {
    try {
      const parentPath = join(configDir, config.extends);
      const parent = await parseTsConfig(
        parentPath.endsWith(".json") ? parentPath : `${parentPath}.json`,
      );
      if (parent.baseUrl && !baseUrl) baseUrl = parent.baseUrl;
      aliases.push(...parent.aliases);
    } catch {
      // parent config not found, skip
    }
  }

  return { aliases, baseUrl };
}

function stripJsonComments(json: string): string {
  let result = "";
  let i = 0;
  while (i < json.length) {
    if (json[i] === '"') {
      const start = i;
      i++;
      while (i < json.length && json[i] !== '"') {
        if (json[i] === "\\") i++;
        i++;
      }
      i++;
      result += json.slice(start, i);
    } else if (json[i] === "/" && json[i + 1] === "/") {
      while (i < json.length && json[i] !== "\n") i++;
    } else if (json[i] === "/" && json[i + 1] === "*") {
      i += 2;
      while (i < json.length && !(json[i] === "*" && json[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += json[i];
      i++;
    }
  }
  return result;
}
