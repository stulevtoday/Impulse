import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ParseResult } from "./parser-types.js";
import type { ExtractorContext, ExtractionResult } from "./types.js";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

/**
 * C# works on namespaces, not files. Strategy:
 * 1. Build a namespace→files map for the entire project (cached)
 * 2. For each file, extract its namespace and using directives
 * 3. Resolve using directives to files via the namespace map
 * 4. External: System.*, Microsoft.*, NuGet packages from .csproj
 */

let _nsCache = new Map<string, Map<string, string[]>>();
let _typeCache = new Map<string, Map<string, string>>();
let _typesByFileCache = new Map<string, Map<string, string[]>>();
let _externPrefixCache = new Map<string, Set<string>>();

export function extractCSharpDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({ id: fileId, kind: "file", filePath: parsed.filePath, name: parsed.filePath });

  const nsMap = getNamespaceMap(ctx.rootDir);
  const typeMap = getTypeMap(ctx.rootDir, nsMap);
  const typesByFile = getTypesByFile(ctx.rootDir, typeMap);
  const externPrefixes = getExternalPrefixes(ctx.rootDir);
  const fileNamespace = extractNamespaceFromSource(parsed.source);
  const usings = extractUsings(parsed.source);

  for (const using of usings) {
    const line = using.line;

    if (isExternal(using.namespace, externPrefixes)) {
      edges.push({
        from: fileId,
        to: `external:${using.namespace}`,
        kind: "imports",
        metadata: { specifier: using.namespace, line },
      });
      continue;
    }

    const targetFiles = resolveWithTypes(using.namespace, nsMap, typesByFile, parsed.source, parsed.filePath);
    if (targetFiles.length > 0) {
      for (const target of targetFiles) {
        const targetId = `file:${target}`;
        nodes.push({ id: targetId, kind: "file", filePath: target, name: target });
        edges.push({
          from: fileId,
          to: targetId,
          kind: "imports",
          metadata: { specifier: using.namespace, line },
        });
      }
    } else {
      edges.push({
        from: fileId,
        to: `external:${using.namespace}`,
        kind: "imports",
        metadata: { specifier: using.namespace, line },
      });
    }
  }

  return { nodes, edges };
}

interface UsingDirective {
  namespace: string;
  line: number;
}

const USING_RE = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([A-Za-z][\w.]*)\s*;/gm;
const NAMESPACE_RE = /^\s*namespace\s+([\w.]+)\s*[;{]/m;

function extractUsings(source: string): UsingDirective[] {
  const usings: UsingDirective[] = [];
  let match: RegExpExecArray | null;
  USING_RE.lastIndex = 0;
  while ((match = USING_RE.exec(source)) !== null) {
    const ns = match[1];
    const line = source.slice(0, match.index).split("\n").length;
    usings.push({ namespace: ns, line });
  }
  return usings;
}

function extractNamespaceFromSource(source: string): string | null {
  const match = source.match(NAMESPACE_RE);
  return match ? match[1] : null;
}

/**
 * Smart resolution: instead of linking to ALL files in a namespace,
 * check which type names from that namespace actually appear in the
 * source code. Only create edges to files that define referenced types.
 */
function resolveWithTypes(
  usingNs: string,
  nsMap: Map<string, string[]>,
  typesByFile: Map<string, string[]>,
  source: string,
  currentFile: string,
): string[] {
  const filesInNs = nsMap.get(usingNs) ?? [];
  if (filesInNs.length === 0) return [];
  if (filesInNs.length === 1 && filesInNs[0] !== currentFile) return filesInNs;

  const matched = new Set<string>();
  for (const file of filesInNs) {
    if (file === currentFile) continue;
    const types = typesByFile.get(file) ?? [];
    for (const typeName of types) {
      if (source.includes(typeName)) {
        matched.add(file);
        break;
      }
    }
  }

  if (matched.size > 0) return [...matched];
  return filesInNs.filter((f) => f !== currentFile);
}

function getTypesByFile(rootDir: string, typeMap: Map<string, string>): Map<string, string[]> {
  const cached = _typesByFileCache.get(rootDir);
  if (cached) return cached;

  const result = new Map<string, string[]>();
  for (const [typeName, file] of typeMap) {
    const list = result.get(file) ?? [];
    list.push(typeName);
    result.set(file, list);
  }

  _typesByFileCache.set(rootDir, result);
  return result;
}

const EXTERNAL_PREFIXES = ["System", "Microsoft", "Newtonsoft", "NLog", "Serilog", "AutoMapper", "FluentValidation", "MediatR", "Polly", "Grpc", "Google", "Npgsql", "Dapper"];

function isExternal(ns: string, projectPrefixes: Set<string>): boolean {
  const root = ns.split(".")[0];
  if (EXTERNAL_PREFIXES.includes(root)) return true;
  if (projectPrefixes.size > 0 && !projectPrefixes.has(root)) return true;
  return false;
}

const TYPE_DECL_RE = /(?:public|internal|private|protected)?\s*(?:static\s+)?(?:partial\s+)?(?:abstract\s+)?(?:sealed\s+)?(?:class|interface|enum|struct|record)\s+(\w+)/g;

function getTypeMap(rootDir: string, nsMap: Map<string, string[]>): Map<string, string> {
  const cached = _typeCache.get(rootDir);
  if (cached) return cached;

  const typeMap = new Map<string, string>();

  for (const files of nsMap.values()) {
    for (const file of files) {
      try {
        const content = readFileSync(join(rootDir, file), "utf-8");
        let match: RegExpExecArray | null;
        TYPE_DECL_RE.lastIndex = 0;
        while ((match = TYPE_DECL_RE.exec(content)) !== null) {
          typeMap.set(match[1], file);
        }
      } catch { /* skip */ }
    }
  }

  _typeCache.set(rootDir, typeMap);
  return typeMap;
}

function getNamespaceMap(rootDir: string): Map<string, string[]> {
  const cached = _nsCache.get(rootDir);
  if (cached) return cached;

  const nsMap = new Map<string, string[]>();
  const csFiles = findAllCsFiles(rootDir, "");

  for (const file of csFiles) {
    try {
      const content = readFileSync(join(rootDir, file), "utf-8");
      const nsMatch = content.match(/^\s*namespace\s+([\w.]+)\s*[;{]/m);
      if (nsMatch) {
        const ns = nsMatch[1];
        const list = nsMap.get(ns) ?? [];
        list.push(file);
        nsMap.set(ns, list);
      }
    } catch { /* skip unreadable */ }
  }

  _nsCache.set(rootDir, nsMap);
  return nsMap;
}

function getExternalPrefixes(rootDir: string): Set<string> {
  const cached = _externPrefixCache.get(rootDir);
  if (cached) return cached;

  const prefixes = new Set<string>();

  const csprojFiles = findFiles(rootDir, "", ".csproj");
  for (const csproj of csprojFiles) {
    try {
      const content = readFileSync(join(rootDir, csproj), "utf-8");
      const rootNs = content.match(/<RootNamespace>([\w.]+)<\/RootNamespace>/);
      if (rootNs) prefixes.add(rootNs[1].split(".")[0]);

      const projName = csproj.split("/").pop()?.replace(".csproj", "");
      if (projName) prefixes.add(projName.split(".")[0]);
    } catch { /* skip */ }
  }

  if (prefixes.size === 0) {
    const sln = findFiles(rootDir, "", ".sln");
    if (sln.length > 0) {
      const name = sln[0].split("/").pop()?.replace(".sln", "");
      if (name) prefixes.add(name.split(".")[0]);
    }
  }

  _externPrefixCache.set(rootDir, prefixes);
  return prefixes;
}

function findAllCsFiles(rootDir: string, rel: string): string[] {
  const results: string[] = [];
  const abs = rel ? join(rootDir, rel) : rootDir;

  try {
    for (const entry of readdirSync(abs)) {
      if (entry === "obj" || entry === "bin" || entry === "node_modules" || entry.startsWith(".")) continue;
      const entryRel = rel ? `${rel}/${entry}` : entry;
      const entryAbs = join(abs, entry);

      try {
        const stat = statSync(entryAbs);
        if (stat.isDirectory()) {
          results.push(...findAllCsFiles(rootDir, entryRel));
        } else if (entry.endsWith(".cs")) {
          results.push(entryRel);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results;
}

function findFiles(rootDir: string, rel: string, ext: string): string[] {
  const results: string[] = [];
  const abs = rel ? join(rootDir, rel) : rootDir;

  try {
    for (const entry of readdirSync(abs)) {
      if (entry === "obj" || entry === "bin" || entry === "node_modules" || entry.startsWith(".")) continue;
      const entryRel = rel ? `${rel}/${entry}` : entry;
      const entryAbs = join(abs, entry);

      try {
        const stat = statSync(entryAbs);
        if (stat.isDirectory()) {
          results.push(...findFiles(rootDir, entryRel, ext));
        } else if (entry.endsWith(ext)) {
          results.push(entryRel);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results;
}
