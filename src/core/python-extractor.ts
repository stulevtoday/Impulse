import { rootNode, type ParseResult, type SyntaxNode } from "./parser.js";
import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ExtractorContext, ExtractionResult } from "./types.js";
import { dirname, join, relative } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

export function extractPythonDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({
    id: fileId,
    kind: "file",
    filePath: parsed.filePath,
    name: parsed.filePath,
  });

  if (!parsed.tree) return { nodes, edges };
  visitPythonNode(rootNode(parsed.tree), parsed, ctx, fileId, nodes, edges);

  return { nodes, edges };
}

function visitPythonNode(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  switch (node.type) {
    case "import_statement":
      handlePythonImport(node, parsed, ctx, fileId, nodes, edges);
      break;
    case "import_from_statement":
      handlePythonFromImport(node, parsed, ctx, fileId, nodes, edges);
      break;
  }

  for (const child of node.children) {
    visitPythonNode(child, parsed, ctx, fileId, nodes, edges);
  }
}

/**
 * Handle: import foo, import foo.bar
 */
function handlePythonImport(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const names = node.children.filter((c) => c.type === "dotted_name");
  for (const name of names) {
    const module = name.text;
    const resolved = resolvePythonModule(module, parsed.filePath, ctx, 0);
    const targetId = resolved ? `file:${resolved}` : `external:${module}`;

    if (resolved) {
      nodes.push({ id: targetId, kind: "file", filePath: resolved, name: resolved });
    }

    edges.push({
      from: fileId,
      to: targetId,
      kind: "imports",
      metadata: { specifier: module, line: node.startPosition.row + 1 },
    });
  }
}

/**
 * Handle: from foo import bar, from . import utils, from ..models import User
 */
function handlePythonFromImport(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const relImport = node.children.find((c) => c.type === "relative_import");
  const dottedName = node.children.find(
    (c) => c.type === "dotted_name" && c.previousSibling?.type === "from",
  );

  let module: string;
  let dotLevel = 0;

  if (relImport) {
    const prefix = relImport.children.find((c) => c.type === "import_prefix");
    dotLevel = prefix ? prefix.text.length : 0;
    const modName = relImport.children.find((c) => c.type === "dotted_name");
    module = modName ? modName.text : "";
  } else if (dottedName) {
    module = dottedName.text;
  } else {
    return;
  }

  const resolved = resolvePythonModule(module, parsed.filePath, ctx, dotLevel);
  const specifier = dotLevel > 0 ? `${".".repeat(dotLevel)}${module}` : module;
  const targetId = resolved ? `file:${resolved}` : `external:${specifier}`;

  if (resolved) {
    nodes.push({ id: targetId, kind: "file", filePath: resolved, name: resolved });
  }

  edges.push({
    from: fileId,
    to: targetId,
    kind: "imports",
    metadata: { specifier, line: node.startPosition.row + 1, relative: dotLevel > 0 },
  });

  const importedNames = node.children
    .filter((c) => c.type === "dotted_name" && c.previousSibling?.type !== "from")
    .flatMap((c) => c.children.filter((x) => x.type === "identifier").map((x) => x.text));

  for (const name of importedNames) {
    const symbolId = `symbol:${parsed.filePath}:${name}`;
    nodes.push({
      id: symbolId,
      kind: "symbol",
      filePath: parsed.filePath,
      name,
      line: node.startPosition.row + 1,
    });
  }
}

function resolvePythonModule(
  module: string,
  fromFile: string,
  ctx: ExtractorContext,
  dotLevel: number,
): string | null {
  if (dotLevel > 0) {
    return resolveRelativePython(module, fromFile, ctx.rootDir, dotLevel);
  }

  return resolveAbsolutePython(module, ctx.rootDir);
}

function resolveRelativePython(
  module: string,
  fromFile: string,
  rootDir: string,
  dotLevel: number,
): string | null {
  let base = dirname(fromFile);
  for (let i = 1; i < dotLevel; i++) {
    base = dirname(base);
  }

  const parts = module ? module.split(".") : [];
  const modulePath = join(base, ...parts);

  return findPythonFile(modulePath, rootDir);
}

function resolveAbsolutePython(
  module: string,
  rootDir: string,
): string | null {
  const parts = module.split(".");
  const modulePath = join(...parts);

  const direct = findPythonFile(modulePath, rootDir);
  if (direct) return direct;

  for (const srcRoot of findPythonSourceRoots(rootDir)) {
    const nested = findPythonFile(join(srcRoot, modulePath), rootDir);
    if (nested) return nested;
  }

  return null;
}

function findPythonFile(modulePath: string, rootDir: string): string | null {
  const candidates = [
    `${modulePath}.py`,
    join(modulePath, "__init__.py"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(rootDir, candidate))) {
      return candidate;
    }
  }

  return null;
}

let _srcRootsCache: Map<string, string[]> = new Map();

/**
 * Find directories that look like Python source roots:
 * directories containing .py files directly, or having subdirs with __init__.py.
 */
function findPythonSourceRoots(rootDir: string): string[] {
  const cached = _srcRootsCache.get(rootDir);
  if (cached) return cached;

  const roots: string[] = [];

  for (const entry of safeReaddir(rootDir)) {
    const entryPath = join(rootDir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch { continue; }

    const hasPy = safeReaddir(entryPath).some((f) => f.endsWith(".py"));
    if (hasPy) {
      roots.push(entry);
    }
  }

  _srcRootsCache.set(rootDir, roots);
  return roots;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
