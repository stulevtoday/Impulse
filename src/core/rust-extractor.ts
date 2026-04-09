import { rootNode, type ParseResult, type SyntaxNode } from "./parser-types.js";
import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ExtractorContext, ExtractionResult } from "./types.js";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

let _cargoCache = new Map<string, Set<string>>();

const RUST_STDLIB = new Set(["std", "core", "alloc"]);

export function extractRustDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({ id: fileId, kind: "file", filePath: parsed.filePath, name: parsed.filePath });

  const externCrates = getCargoDependencies(ctx.rootDir);
  if (!parsed.tree) return { nodes, edges };
  visitRustNode(rootNode(parsed.tree), parsed, ctx, externCrates, fileId, nodes, edges);

  return { nodes, edges };
}

function visitRustNode(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  externCrates: Set<string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  switch (node.type) {
    case "use_declaration":
      handleUseDecl(node, parsed, ctx, externCrates, fileId, nodes, edges);
      return;
    case "mod_item":
      handleModDecl(node, parsed, ctx, fileId, nodes, edges);
      return;
    case "extern_crate_declaration": {
      const name = node.children.find((c) => c.type === "identifier");
      if (name) {
        edges.push({
          from: fileId,
          to: `external:${name.text}`,
          kind: "imports",
          metadata: { specifier: `extern crate ${name.text}`, line: node.startPosition.row + 1 },
        });
      }
      return;
    }
  }

  for (const child of node.children) {
    visitRustNode(child, parsed, ctx, externCrates, fileId, nodes, edges);
  }
}

function handleModDecl(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  if (node.children.some((c) => c.type === "declaration_list")) return;

  const nameNode = node.children.find((c) => c.type === "identifier");
  if (!nameNode) return;

  const modName = nameNode.text;
  const modDir = getModuleDir(parsed.filePath);

  const candidates = [
    join(modDir, `${modName}.rs`),
    join(modDir, modName, "mod.rs"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(ctx.rootDir, candidate))) {
      const targetId = `file:${candidate}`;
      nodes.push({ id: targetId, kind: "file", filePath: candidate, name: candidate });
      edges.push({
        from: fileId,
        to: targetId,
        kind: "imports",
        metadata: { specifier: `mod ${modName}`, line: node.startPosition.row + 1 },
      });
      return;
    }
  }
}

function handleUseDecl(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  externCrates: Set<string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const paths = extractUsePaths(node);
  const line = node.startPosition.row + 1;

  for (const segments of paths) {
    if (segments.length === 0) continue;
    const root = segments[0];
    const specifier = segments.join("::");

    if (root === "crate") {
      const resolved = resolveModulePath(segments.slice(1), "src", ctx.rootDir);
      if (resolved) {
        const targetId = `file:${resolved}`;
        nodes.push({ id: targetId, kind: "file", filePath: resolved, name: resolved });
        edges.push({ from: fileId, to: targetId, kind: "imports", metadata: { specifier, line } });
      }
    } else if (root === "super") {
      const parentDir = getSuperDir(parsed.filePath);
      const resolved = resolveModulePath(segments.slice(1), parentDir, ctx.rootDir);
      if (resolved) {
        const targetId = `file:${resolved}`;
        nodes.push({ id: targetId, kind: "file", filePath: resolved, name: resolved });
        edges.push({ from: fileId, to: targetId, kind: "imports", metadata: { specifier, line } });
      }
    } else if (root === "self") {
      const selfDir = getModuleDir(parsed.filePath);
      const resolved = resolveModulePath(segments.slice(1), selfDir, ctx.rootDir);
      if (resolved) {
        const targetId = `file:${resolved}`;
        nodes.push({ id: targetId, kind: "file", filePath: resolved, name: resolved });
        edges.push({ from: fileId, to: targetId, kind: "imports", metadata: { specifier, line } });
      }
    } else {
      edges.push({
        from: fileId,
        to: `external:${specifier}`,
        kind: "imports",
        metadata: { specifier, line },
      });
    }
  }
}

/**
 * Extract all use paths from a use_declaration AST node.
 * Handles simple uses, grouped uses, wildcards, and aliases.
 */
function extractUsePaths(node: SyntaxNode): string[][] {
  const results: string[][] = [];

  function walk(n: SyntaxNode, prefix: string[]): void {
    if (n.type === "scoped_identifier") {
      results.push([...prefix, ...collectPath(n)]);
      return;
    }
    if (n.type === "identifier" && (n.parent?.type === "use_declaration" || n.parent?.type === "use_list")) {
      results.push([...prefix, n.text]);
      return;
    }
    if (n.type === "scoped_use_list") {
      const pathChild = n.children.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
      const list = n.children.find((c) => c.type === "use_list");
      const base = pathChild
        ? (pathChild.type === "scoped_identifier" ? collectPath(pathChild) : [pathChild.text])
        : [];

      if (list) {
        for (const child of list.children) {
          walk(child, [...prefix, ...base]);
        }
      } else {
        results.push([...prefix, ...base]);
      }
      return;
    }
    if (n.type === "use_wildcard") {
      const pathChild = n.children.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
      if (pathChild) {
        const p = pathChild.type === "scoped_identifier" ? collectPath(pathChild) : [pathChild.text];
        results.push([...prefix, ...p]);
      }
      return;
    }
    if (n.type === "use_as_clause") {
      const pathChild = n.children.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
      if (pathChild) {
        const p = pathChild.type === "scoped_identifier" ? collectPath(pathChild) : [pathChild.text];
        results.push([...prefix, ...p]);
      }
      return;
    }

    for (const child of n.children) {
      if (child.type === "use" || child.type === ";") continue;
      walk(child, prefix);
    }
  }

  walk(node, []);
  return results;
}

function collectPath(node: SyntaxNode): string[] {
  if (node.type === "identifier" || node.type === "crate" || node.type === "super" || node.type === "self") {
    return [node.text];
  }
  if (node.type === "scoped_identifier") {
    const parts: string[] = [];
    for (const child of node.children) {
      if (child.type === "::") continue;
      parts.push(...collectPath(child));
    }
    return parts;
  }
  return [node.text];
}

/**
 * Resolve a module path to a .rs file.
 * Tries progressively shorter prefixes: for [x, y, z] tries
 * x/y/z.rs, x/y/z/mod.rs, x/y.rs, x/y/mod.rs, x.rs, x/mod.rs
 */
function resolveModulePath(parts: string[], baseDir: string, rootDir: string): string | null {
  if (parts.length === 0) return null;

  for (let depth = parts.length; depth >= 1; depth--) {
    const modPath = join(baseDir, ...parts.slice(0, depth));

    const asFile = `${modPath}.rs`;
    if (existsSync(join(rootDir, asFile))) return asFile;

    const asMod = join(modPath, "mod.rs");
    if (existsSync(join(rootDir, asMod))) return asMod;
  }

  return null;
}

function getModuleDir(filePath: string): string {
  const base = filePath.split("/").pop() || "";
  const dir = dirname(filePath);

  if (base === "main.rs" || base === "lib.rs" || base === "mod.rs") {
    return dir;
  }
  return join(dir, base.replace(/\.rs$/, ""));
}

function getSuperDir(filePath: string): string {
  const base = filePath.split("/").pop() || "";
  const dir = dirname(filePath);

  if (base === "main.rs" || base === "lib.rs" || base === "mod.rs") {
    return dirname(dir);
  }
  return dir;
}

function getCargoDependencies(rootDir: string): Set<string> {
  const cached = _cargoCache.get(rootDir);
  if (cached) return cached;

  const deps = new Set<string>();
  try {
    const content = readFileSync(join(rootDir, "Cargo.toml"), "utf-8");
    let inDeps = false;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (/^\[.*dependencies.*\]/.test(trimmed)) { inDeps = true; continue; }
      if (trimmed.startsWith("[")) { inDeps = false; continue; }
      if (inDeps && trimmed && !trimmed.startsWith("#")) {
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)/);
        if (match) deps.add(match[1].replace(/-/g, "_"));
      }
    }
  } catch { /* no Cargo.toml */ }

  _cargoCache.set(rootDir, deps);
  return deps;
}
