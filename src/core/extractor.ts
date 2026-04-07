import type Parser from "tree-sitter";
import type { ParseResult } from "./parser.js";
import type { GraphNode, GraphEdge } from "./graph.js";
import { dirname, resolve, relative, extname } from "node:path";

export interface ExtractionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Extract dependency relationships from a parsed TypeScript/TSX file.
 * Uses AST traversal rather than Tree-sitter query files for v0.1 simplicity.
 * Can migrate to .scm query files later for better language extensibility.
 */
export function extractDependencies(
  parsed: ParseResult,
  rootDir: string,
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

  visitNode(parsed.tree.rootNode, parsed, rootDir, fileId, nodes, edges);

  return { nodes, edges };
}

function visitNode(
  node: Parser.SyntaxNode,
  parsed: ParseResult,
  rootDir: string,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  switch (node.type) {
    case "import_statement":
      handleImport(node, parsed, rootDir, fileId, nodes, edges);
      break;
    case "export_statement":
      handleExportOrReexport(node, parsed, rootDir, fileId, nodes, edges);
      break;
    case "call_expression":
      handleDynamicImportOrRequire(node, parsed, rootDir, fileId, nodes, edges);
      break;
  }

  for (const child of node.children) {
    visitNode(child, parsed, rootDir, fileId, nodes, edges);
  }
}

function handleImport(
  node: Parser.SyntaxNode,
  parsed: ParseResult,
  rootDir: string,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const sourceNode = node.children.find((c) => c.type === "string");
  if (!sourceNode) return;

  const raw = stripQuotes(sourceNode.text);
  const resolvedPath = resolveImportPath(raw, parsed.filePath, rootDir);
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
  rootDir: string,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const sourceNode = node.children.find((c) => c.type === "string");
  if (sourceNode) {
    const raw = stripQuotes(sourceNode.text);
    const resolvedPath = resolveImportPath(raw, parsed.filePath, rootDir);
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
  rootDir: string,
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
  const resolvedPath = resolveImportPath(raw, parsed.filePath, rootDir);
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
  _rootDir: string,
): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return null;
  }

  const fromDir = dirname(fromFile);
  const raw = resolve("/", fromDir, specifier);
  const rel = raw.startsWith("/") ? raw.slice(1) : raw;

  const ext = extname(rel);
  if (ext && JS_TO_TS[ext]) {
    const base = rel.slice(0, -ext.length);
    return `${base}${JS_TO_TS[ext][0]}`;
  }

  if (!ext) {
    return `${rel}${IMPLICIT_EXTENSIONS[0]}`;
  }

  return rel;
}

function stripQuotes(str: string): string {
  return str.replace(/^['"`]|['"`]$/g, "");
}
