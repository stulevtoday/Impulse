import type Parser from "tree-sitter";
import type { ParseResult } from "./parser.js";
import type { GraphNode, GraphEdge } from "./graph.js";
import type { ExtractionResult, ExtractorContext } from "./types.js";
import { dirname, resolve, relative, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { extractPythonDependencies } from "./python-extractor.js";
import { extractGoDependencies } from "./go-extractor.js";
import { extractRustDependencies } from "./rust-extractor.js";

export type { ExtractionResult, ExtractorContext } from "./types.js";

export function extractDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  if (parsed.language === "python") {
    return extractPythonDependencies(parsed, ctx);
  }
  if (parsed.language === "go") {
    return extractGoDependencies(parsed, ctx);
  }
  if (parsed.language === "rust") {
    return extractRustDependencies(parsed, ctx);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({
    id: fileId,
    kind: "file",
    filePath: parsed.filePath,
    name: parsed.filePath,
  });

  visitNode(parsed.tree.rootNode, parsed, ctx, fileId, nodes, edges);

  return { nodes, edges };
}

function visitNode(
  node: Parser.SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  switch (node.type) {
    case "import_statement":
      handleImport(node, parsed, ctx, fileId, nodes, edges);
      break;
    case "export_statement":
      handleExportOrReexport(node, parsed, ctx, fileId, nodes, edges);
      break;
    case "call_expression":
      handleDynamicImportOrRequire(node, parsed, ctx, fileId, nodes, edges);
      break;
    case "member_expression":
      handleEnvAccess(node, parsed, fileId, nodes, edges);
      break;
  }

  for (const child of node.children) {
    visitNode(child, parsed, ctx, fileId, nodes, edges);
  }
}

function handleImport(
  node: Parser.SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const sourceNode = node.children.find((c) => c.type === "string");
  if (!sourceNode) return;

  const raw = stripQuotes(sourceNode.text);
  const resolvedPath = resolveImportPath(raw, parsed.filePath, ctx);
  const targetId = resolvedPath ? `file:${resolvedPath}` : `external:${raw}`;

  if (resolvedPath) {
    nodes.push({
      id: targetId,
      kind: "file",
      filePath: resolvedPath,
      name: resolvedPath,
    });
  }

  edges.push({
    from: fileId,
    to: targetId,
    kind: "imports",
    metadata: { specifier: raw, line: sourceNode.startPosition.row + 1 },
  });

  const importedNames = extractImportedNames(node);
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

function handleExportOrReexport(
  node: Parser.SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const sourceNode = node.children.find((c) => c.type === "string");
  if (sourceNode) {
    const raw = stripQuotes(sourceNode.text);
    const resolvedPath = resolveImportPath(raw, parsed.filePath, ctx);
    const targetId = resolvedPath ? `file:${resolvedPath}` : `external:${raw}`;

    if (resolvedPath) {
      nodes.push({
        id: targetId,
        kind: "file",
        filePath: resolvedPath,
        name: resolvedPath,
      });
    }

    edges.push({
      from: fileId,
      to: targetId,
      kind: "imports",
      metadata: { specifier: raw, reexport: true, line: sourceNode.startPosition.row + 1 },
    });
    return;
  }

  const declaration = node.children.find(
    (c) =>
      c.type === "function_declaration" ||
      c.type === "class_declaration" ||
      c.type === "lexical_declaration" ||
      c.type === "variable_declaration" ||
      c.type === "interface_declaration" ||
      c.type === "type_alias_declaration",
  );

  if (!declaration) return;

  const nameNode = declaration.children.find((c) => c.type === "identifier" || c.type === "type_identifier");
  if (!nameNode) return;

  const symbolId = `symbol:${parsed.filePath}:${nameNode.text}`;
  nodes.push({
    id: symbolId,
    kind: "symbol",
    filePath: parsed.filePath,
    name: nameNode.text,
    line: nameNode.startPosition.row + 1,
  });
}

function handleDynamicImportOrRequire(
  node: Parser.SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const callee = node.children[0];
  if (!callee) return;

  const isDynamic = callee.type === "import";
  const isRequire = callee.type === "identifier" && callee.text === "require";
  if (!isDynamic && !isRequire) return;

  const args = node.children.find((c) => c.type === "arguments");
  const target = args
    ? args.children.find((c) => c.type === "string")
    : node.children.find((c) => c.type === "string");

  if (!target) return;

  const raw = stripQuotes(target.text);
  const resolvedPath = resolveImportPath(raw, parsed.filePath, ctx);
  const targetId = resolvedPath ? `file:${resolvedPath}` : `external:${raw}`;

  if (resolvedPath) {
    nodes.push({
      id: targetId,
      kind: "file",
      filePath: resolvedPath,
      name: resolvedPath,
    });
  }

  edges.push({
    from: fileId,
    to: targetId,
    kind: "imports",
    metadata: {
      specifier: raw,
      dynamic: true,
      line: target.startPosition.row + 1,
    },
  });
}

function extractImportedNames(node: Parser.SyntaxNode): string[] {
  const names: string[] = [];
  const clause = node.children.find((c) => c.type === "import_clause");
  if (!clause) return names;

  for (const child of clause.children) {
    if (child.type === "identifier") {
      names.push(child.text);
    }
    if (child.type === "named_imports") {
      for (const spec of child.children) {
        if (spec.type === "import_specifier") {
          const nameNode = spec.children.find((c) => c.type === "identifier");
          if (nameNode) names.push(nameNode.text);
        }
      }
    }
    if (child.type === "namespace_import") {
      const nameNode = child.children.find((c) => c.type === "identifier");
      if (nameNode) names.push(nameNode.text);
    }
  }

  return names;
}

const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".js", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
  ".jsx": [".tsx", ".jsx"],
};

const IMPLICIT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

function resolveImportPath(
  specifier: string,
  fromFile: string,
  ctx: ExtractorContext,
): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return resolveRelativePath(specifier, fromFile, ctx.rootDir);
  }

  return resolveAliasPath(specifier, ctx);
}

function resolveRelativePath(
  specifier: string,
  fromFile: string,
  rootDir: string,
): string | null {
  const fromDir = dirname(fromFile);
  const raw = resolve("/", fromDir, specifier);
  const rel = raw.startsWith("/") ? raw.slice(1) : raw;
  return resolveWithExtensions(rel, rootDir);
}

function resolveAliasPath(
  specifier: string,
  ctx: ExtractorContext,
): string | null {
  for (const alias of ctx.aliases) {
    if (!specifier.startsWith(alias.prefix)) continue;

    const remainder = specifier.slice(alias.prefix.length);
    for (const target of alias.paths) {
      const abs = resolve(target, remainder);
      const rel = relative(ctx.rootDir, abs);
      if (rel.startsWith("..")) continue;
      const resolved = resolveWithExtensions(rel, ctx.rootDir);
      if (resolved) return resolved;
    }
  }

  return null;
}

function resolveWithExtensions(rel: string, rootDir: string): string {
  const ext = extname(rel);

  if (ext && JS_TO_TS[ext]) {
    const base = rel.slice(0, -ext.length);
    const candidates = JS_TO_TS[ext];
    for (const candidate of candidates) {
      const path = `${base}${candidate}`;
      if (existsSync(join(rootDir, path))) return path;
    }
    return `${base}${candidates[0]}`;
  }

  if (!ext) {
    for (const candidate of IMPLICIT_EXTENSIONS) {
      const path = `${rel}${candidate}`;
      if (existsSync(join(rootDir, path))) return path;
    }
    for (const candidate of INDEX_FILES) {
      const path = join(rel, candidate);
      if (existsSync(join(rootDir, path))) return path;
    }
    return `${rel}${IMPLICIT_EXTENSIONS[0]}`;
  }

  return rel;
}

const INDEX_FILES = [
  "index.ts", "index.tsx", "index.js", "index.jsx",
];

/**
 * Detect process.env.VAR_NAME patterns and create env_var nodes.
 * Handles: process.env.FOO, process.env['FOO'], process.env["FOO"]
 */
function handleEnvAccess(
  node: Parser.SyntaxNode,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const text = node.text;

  if (!text.startsWith("process.env")) return;

  let varName: string | null = null;

  // process.env.VAR_NAME (member_expression → member_expression → identifier)
  const prop = node.children.find(
    (c) => c.type === "property_identifier" || c.type === "identifier",
  );
  if (prop && prop.text !== "env" && prop.text !== "process") {
    varName = prop.text;
  }

  // process.env['VAR'] or process.env["VAR"] — handled as subscript_expression parent
  if (!varName && node.parent?.type === "subscript_expression") {
    const sub = node.parent.children.find((c) => c.type === "string");
    if (sub) varName = stripQuotes(sub.text);
  }

  if (!varName) return;

  const envId = `env:${varName}`;
  nodes.push({
    id: envId,
    kind: "env_var",
    filePath: parsed.filePath,
    name: varName,
    line: node.startPosition.row + 1,
  });

  edges.push({
    from: fileId,
    to: envId,
    kind: "reads_env",
    metadata: { line: node.startPosition.row + 1 },
  });
}

function stripQuotes(str: string): string {
  return str.replace(/^['"`]|['"`]$/g, "");
}
