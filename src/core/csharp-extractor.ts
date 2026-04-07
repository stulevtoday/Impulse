import type Parser from "tree-sitter";
import type { ParseResult } from "./parser.js";
import type { GraphNode, GraphEdge } from "./graph.js";
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

export function extractCSharpDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({ id: fileId, kind: "file", filePath: parsed.filePath, name: parsed.filePath });

  const nsMap = getNamespaceMap(ctx.rootDir);
  const externPrefixes = getExternalPrefixes(ctx.rootDir);
  const fileNamespace = extractNamespace(parsed.tree.rootNode);
  const usings = extractUsings(parsed.tree.rootNode);

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

    const targetFiles = resolveNamespace(using.namespace, nsMap, parsed.filePath, fileNamespace);
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

function extractUsings(root: Parser.SyntaxNode): UsingDirective[] {
  const usings: UsingDirective[] = [];

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === "using_directive") {
      const nameNode = findNameNode(node);
      if (nameNode) {
        const ns = nameNode.text;
        if (!ns.startsWith("global::")) {
          usings.push({ namespace: ns, line: node.startPosition.row + 1 });
        }
      }
      return;
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
  return usings;
}

function extractNamespace(root: Parser.SyntaxNode): string | null {
  function walk(node: Parser.SyntaxNode): string | null {
    if (node.type === "file_scoped_namespace_declaration" || node.type === "namespace_declaration") {
      const nameNode = findNameNode(node);
      return nameNode?.text ?? null;
    }
    for (const child of node.children) {
      const result = walk(child);
      if (result) return result;
    }
    return null;
  }
  return walk(root);
}

function findNameNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  for (const child of node.children) {
    if (child.type === "qualified_name" || child.type === "identifier_name" || child.type === "identifier") {
      return child;
    }
    if (child.type === "name_equals") continue;
    if (child.type === "qualified_name") return child;
  }
  return null;
}

function resolveNamespace(
  usingNs: string,
  nsMap: Map<string, string[]>,
  currentFile: string,
  currentNs: string | null,
): string[] {
  const direct = nsMap.get(usingNs) ?? [];
  const filtered = direct.filter((f) => f !== currentFile);
  if (filtered.length > 0) return filtered;

  for (const [ns, files] of nsMap) {
    if (ns.startsWith(usingNs + ".") || usingNs.startsWith(ns + ".")) {
      const matches = files.filter((f) => f !== currentFile);
      if (matches.length > 0) return matches;
    }
  }

  return [];
}

const EXTERNAL_PREFIXES = ["System", "Microsoft", "Newtonsoft", "NLog", "Serilog", "AutoMapper", "FluentValidation", "MediatR", "Polly", "Grpc", "Google", "Npgsql", "Dapper"];

function isExternal(ns: string, projectPrefixes: Set<string>): boolean {
  const root = ns.split(".")[0];
  if (EXTERNAL_PREFIXES.includes(root)) return true;
  if (projectPrefixes.size > 0 && !projectPrefixes.has(root)) return true;
  return false;
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
