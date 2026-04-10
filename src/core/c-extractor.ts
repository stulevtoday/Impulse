import { rootNode, type ParseResult, type SyntaxNode } from "./parser-types.js";
import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ExtractionResult, ExtractorContext } from "./types.js";
import { dirname, resolve, relative, join } from "node:path";
import { existsSync } from "node:fs";

/**
 * C and C++ extractor.
 *
 * Dependency model: #include directives.
 *   - `#include "foo.h"` → local dependency (resolve relative to file, then root)
 *   - `#include <stdio.h>` → external (system) dependency
 *
 * Exports: function definitions, struct/class/enum/typedef declarations
 * at file scope are treated as exports (they're visible via header inclusion).
 */
export function extractCDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({ id: fileId, kind: "file", filePath: parsed.filePath, name: parsed.filePath });

  if (!parsed.tree) return { nodes, edges };
  const root = rootNode(parsed.tree);

  visitTopLevel(root, parsed, ctx, fileId, nodes, edges);

  return { nodes, edges };
}

const PREPROC_CONTAINERS = new Set([
  "preproc_ifdef", "preproc_ifndef", "preproc_if", "preproc_elif", "preproc_else",
]);

function visitTopLevel(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  for (const child of node.children) {
    if (child.type === "preproc_include") {
      handleInclude(child, parsed, ctx, fileId, nodes, edges);
    } else if (PREPROC_CONTAINERS.has(child.type)) {
      visitTopLevel(child, parsed, ctx, fileId, nodes, edges);
    } else {
      handleExportDeclaration(child, parsed, fileId, nodes, edges);
    }
  }
}

function handleInclude(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const systemLib = node.children.find((c) => c.type === "system_lib_string");
  if (systemLib) {
    const name = systemLib.text.replace(/^<|>$/g, "");
    edges.push({
      from: fileId,
      to: `external:${name}`,
      kind: "imports",
      metadata: { specifier: `<${name}>`, line: node.startPosition.row + 1 },
    });
    return;
  }

  const stringLit = node.children.find((c) => c.type === "string_literal");
  if (!stringLit) return;

  const contentNode = stringLit.children.find((c) => c.type === "string_content");
  const raw = contentNode?.text ?? stripQuotes(stringLit.text);
  if (!raw) return;

  const resolved = resolveIncludePath(raw, parsed.filePath, ctx);
  const targetId = resolved ? `file:${resolved}` : `external:${raw}`;

  if (resolved) {
    nodes.push({ id: targetId, kind: "file", filePath: resolved, name: resolved });
  }

  edges.push({
    from: fileId,
    to: targetId,
    kind: "imports",
    metadata: { specifier: raw, line: node.startPosition.row + 1 },
  });
}

function handleExportDeclaration(
  node: SyntaxNode,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const line = node.startPosition.row + 1;

  switch (node.type) {
    case "function_definition": {
      const name = findFunctionName(node);
      if (name) createExport(parsed.filePath, name, line, fileId, nodes, edges);
      break;
    }

    case "declaration": {
      const declarator = node.children.find((c) =>
        c.type === "function_declarator" || c.type === "init_declarator",
      );
      const name = declarator?.children.find((c) => c.type === "identifier")?.text;
      if (name && node.children.some((c) => c.type === "storage_class_specifier" && c.text === "extern")) {
        createExport(parsed.filePath, name, line, fileId, nodes, edges);
      }
      break;
    }

    case "type_definition": {
      const name = node.children.find((c) => c.type === "type_identifier")?.text;
      if (name) createExport(parsed.filePath, name, line, fileId, nodes, edges);
      break;
    }

    case "struct_specifier":
    case "enum_specifier":
    case "union_specifier": {
      const name = node.children.find((c) => c.type === "type_identifier")?.text;
      if (name) createExport(parsed.filePath, name, line, fileId, nodes, edges);
      break;
    }

    // C++ specific
    case "class_specifier": {
      const name = node.children.find((c) => c.type === "type_identifier")?.text;
      if (name) createExport(parsed.filePath, name, line, fileId, nodes, edges);
      break;
    }

    case "namespace_definition": {
      const name = node.children.find((c) => c.type === "identifier")?.text;
      if (name) {
        const body = node.children.find((c) => c.type === "declaration_list");
        if (body) {
          for (const child of body.children) {
            handleExportDeclaration(child, parsed, fileId, nodes, edges);
          }
        }
      }
      break;
    }

    case "template_declaration": {
      for (const child of node.children) {
        handleExportDeclaration(child, parsed, fileId, nodes, edges);
      }
      break;
    }
  }
}

function findFunctionName(node: SyntaxNode): string | null {
  for (const child of node.children) {
    if (child.type === "function_declarator") {
      return child.children.find((c) => c.type === "identifier")?.text ?? null;
    }
    if (child.type === "pointer_declarator" || child.type === "reference_declarator") {
      const name = findFunctionName(child);
      if (name) return name;
    }
  }
  return null;
}

function createExport(
  filePath: string,
  name: string,
  line: number,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const exportId = `export:${filePath}:${name}`;
  nodes.push({ id: exportId, kind: "export", filePath, name, line });
  edges.push({ from: fileId, to: exportId, kind: "exports", metadata: {} });
}

function resolveIncludePath(
  specifier: string,
  fromFile: string,
  ctx: ExtractorContext,
): string | null {
  const fromDir = dirname(fromFile);

  const candidates = [
    join(fromDir, specifier),
    specifier,
    join("include", specifier),
    join("src", specifier),
  ];

  for (const candidate of candidates) {
    const normalized = candidate.startsWith("/")
      ? relative(ctx.rootDir, candidate)
      : candidate;

    if (existsSync(join(ctx.rootDir, normalized))) {
      return normalized;
    }
  }

  return null;
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}
