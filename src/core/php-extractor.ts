import { rootNode, type ParseResult, type SyntaxNode } from "./parser-types.js";
import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ExtractorContext, ExtractionResult } from "./types.js";
import { join } from "node:path";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

/**
 * PHP uses namespaces and PSR-4 autoloading. Strategy:
 * 1. Read composer.json for PSR-4 namespace→directory mappings
 * 2. Build namespace→files and FQN→file maps as fallback
 * 3. Resolve `use` statements (simple, grouped, aliased)
 * 4. Export all class/interface/trait/enum declarations
 */

let _nsMapCache = new Map<string, Map<string, string[]>>();
let _typeMapCache = new Map<string, Map<string, string>>();
let _psr4Cache = new Map<string, Array<{ prefix: string; dir: string }>>();

const PHP_SKIP_DIRS = new Set([
  "node_modules", "vendor", ".git", "storage", "cache",
  "public", "bootstrap", ".idea", "var",
]);

export function extractPhpDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({ id: fileId, kind: "file", filePath: parsed.filePath, name: parsed.filePath });

  if (!parsed.tree) return { nodes, edges };

  const root = rootNode(parsed.tree);
  const psr4 = getPsr4Mappings(ctx.rootDir);
  const nsMap = getNamespaceMap(ctx.rootDir);
  const typeMap = getTypeMap(ctx.rootDir, nsMap);

  visitPhpNode(root, parsed, ctx, psr4, typeMap, fileId, nodes, edges);

  return { nodes, edges };
}

function visitPhpNode(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  psr4: Array<{ prefix: string; dir: string }>,
  typeMap: Map<string, string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  switch (node.type) {
    case "namespace_use_declaration":
      handleUseDeclaration(node, parsed, ctx, psr4, typeMap, fileId, nodes, edges);
      return;
    case "class_declaration":
    case "interface_declaration":
    case "trait_declaration":
    case "enum_declaration":
      handleTypeExport(node, parsed, fileId, nodes, edges);
      break;
  }

  for (const child of node.children) {
    visitPhpNode(child, parsed, ctx, psr4, typeMap, fileId, nodes, edges);
  }
}

// ── Use Statement Handling ──

function handleUseDeclaration(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  psr4: Array<{ prefix: string; dir: string }>,
  typeMap: Map<string, string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const line = node.startPosition.row + 1;
  const groupNode = node.children.find((c) => c.type === "namespace_use_group");

  if (groupNode) {
    const prefixNode = node.children.find((c) => c.type === "namespace_name");
    const prefix = prefixNode?.text ?? "";

    for (const clause of groupNode.children) {
      if (clause.type !== "namespace_use_group_clause") continue;
      const nameNode = clause.children.find((c) => c.type === "namespace_name");
      if (!nameNode) continue;
      const fqn = prefix ? `${prefix}\\${nameNode.text}` : nameNode.text;
      resolveAndAddImport(fqn, line, parsed, ctx, psr4, typeMap, fileId, nodes, edges);
    }
  } else {
    for (const clause of node.children) {
      if (clause.type !== "namespace_use_clause") continue;
      const qn = clause.children.find((c) => c.type === "qualified_name");
      if (!qn) continue;
      resolveAndAddImport(qn.text, line, parsed, ctx, psr4, typeMap, fileId, nodes, edges);
    }
  }
}

function resolveAndAddImport(
  fqn: string,
  line: number,
  parsed: ParseResult,
  ctx: ExtractorContext,
  psr4: Array<{ prefix: string; dir: string }>,
  typeMap: Map<string, string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const typeFile = typeMap.get(fqn);
  if (typeFile && typeFile !== parsed.filePath) {
    addLocalImport(fqn, typeFile, line, fileId, nodes, edges);
    return;
  }

  const resolved = resolvePsr4(fqn, psr4, ctx.rootDir);
  if (resolved && resolved !== parsed.filePath) {
    addLocalImport(fqn, resolved, line, fileId, nodes, edges);
    return;
  }

  edges.push({
    from: fileId,
    to: `external:${fqn}`,
    kind: "imports",
    metadata: { specifier: fqn, line },
  });
}

function addLocalImport(
  fqn: string,
  targetFile: string,
  line: number,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const targetId = `file:${targetFile}`;
  nodes.push({ id: targetId, kind: "file", filePath: targetFile, name: targetFile });
  edges.push({ from: fileId, to: targetId, kind: "imports", metadata: { specifier: fqn, line } });

  const className = fqn.split("\\").pop()!;
  const exportId = `export:${targetFile}:${className}`;
  nodes.push({ id: exportId, kind: "export", filePath: targetFile, name: className });
  edges.push({ from: fileId, to: exportId, kind: "uses_export", metadata: { line } });
}

// ── Export Detection ──

function handleTypeExport(
  node: SyntaxNode,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const nameNode = node.children.find((c) => c.type === "name");
  if (!nameNode) return;

  const exportId = `export:${parsed.filePath}:${nameNode.text}`;
  nodes.push({
    id: exportId, kind: "export", filePath: parsed.filePath,
    name: nameNode.text, line: nameNode.startPosition.row + 1,
  });
  edges.push({ from: fileId, to: exportId, kind: "exports", metadata: {} });
}

// ── PSR-4 Resolution ──

function resolvePsr4(
  fqn: string,
  psr4: Array<{ prefix: string; dir: string }>,
  rootDir: string,
): string | null {
  for (const mapping of psr4) {
    if (!fqn.startsWith(mapping.prefix)) continue;
    const relative = fqn.slice(mapping.prefix.length).replace(/\\/g, "/");
    const candidate = join(mapping.dir, `${relative}.php`);
    if (existsSync(join(rootDir, candidate))) return candidate;
  }
  return null;
}

function getPsr4Mappings(rootDir: string): Array<{ prefix: string; dir: string }> {
  const cached = _psr4Cache.get(rootDir);
  if (cached) return cached;

  const mappings: Array<{ prefix: string; dir: string }> = [];

  try {
    const content = readFileSync(join(rootDir, "composer.json"), "utf-8");
    const json = JSON.parse(content);

    for (const section of ["autoload", "autoload-dev"] as const) {
      const psr4 = json?.[section]?.["psr-4"];
      if (!psr4 || typeof psr4 !== "object") continue;
      for (const [prefix, dir] of Object.entries(psr4)) {
        const dirs = Array.isArray(dir) ? dir : [dir];
        for (const d of dirs as string[]) {
          mappings.push({ prefix, dir: d });
        }
      }
    }
  } catch { /* no composer.json */ }

  _psr4Cache.set(rootDir, mappings);
  return mappings;
}

// ── Namespace and Type Maps ──

const NS_RE = /^\s*namespace\s+([\w\\]+)\s*;/m;
const TYPE_RE = /(?:class|interface|trait|enum)\s+(\w+)/g;

function getNamespaceMap(rootDir: string): Map<string, string[]> {
  const cached = _nsMapCache.get(rootDir);
  if (cached) return cached;

  const nsMap = new Map<string, string[]>();
  const phpFiles = findPhpFiles(rootDir, "");

  for (const file of phpFiles) {
    try {
      const content = readFileSync(join(rootDir, file), "utf-8");
      const match = content.match(NS_RE);
      if (match) {
        const ns = match[1];
        const list = nsMap.get(ns) ?? [];
        list.push(file);
        nsMap.set(ns, list);
      }
    } catch { /* skip */ }
  }

  _nsMapCache.set(rootDir, nsMap);
  return nsMap;
}

function getTypeMap(
  rootDir: string,
  nsMap: Map<string, string[]>,
): Map<string, string> {
  const cached = _typeMapCache.get(rootDir);
  if (cached) return cached;

  const typeMap = new Map<string, string>();

  for (const [ns, files] of nsMap) {
    for (const file of files) {
      try {
        const content = readFileSync(join(rootDir, file), "utf-8");
        TYPE_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = TYPE_RE.exec(content)) !== null) {
          typeMap.set(`${ns}\\${match[1]}`, file);
        }
      } catch { /* skip */ }
    }
  }

  _typeMapCache.set(rootDir, typeMap);
  return typeMap;
}

function findPhpFiles(rootDir: string, rel: string): string[] {
  const results: string[] = [];
  const abs = rel ? join(rootDir, rel) : rootDir;

  try {
    for (const entry of readdirSync(abs)) {
      if (PHP_SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const entryRel = rel ? `${rel}/${entry}` : entry;
      const entryAbs = join(abs, entry);

      try {
        const stat = statSync(entryAbs);
        if (stat.isDirectory()) {
          results.push(...findPhpFiles(rootDir, entryRel));
        } else if (entry.endsWith(".php")) {
          results.push(entryRel);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results;
}
