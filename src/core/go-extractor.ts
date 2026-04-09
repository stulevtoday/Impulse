import { rootNode, type ParseResult, type SyntaxNode } from "./parser.js";
import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ExtractorContext, ExtractionResult } from "./types.js";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

let _goModCache = new Map<string, string | null>();

export function extractGoDependencies(
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

  const modulePath = getGoModulePath(ctx.rootDir);
  if (!parsed.tree) return { nodes, edges };
  visitGoNode(rootNode(parsed.tree), parsed, ctx, modulePath, fileId, nodes, edges);

  return { nodes, edges };
}

function visitGoNode(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  modulePath: string | null,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  if (node.type === "import_declaration") {
    handleGoImports(node, ctx, modulePath, fileId, nodes, edges);
    return;
  }

  for (const child of node.children) {
    visitGoNode(child, parsed, ctx, modulePath, fileId, nodes, edges);
  }
}

interface ImportSpec {
  path: string;
  line: number;
}

function handleGoImports(
  node: SyntaxNode,
  ctx: ExtractorContext,
  modulePath: string | null,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const specs = collectImportSpecs(node);

  for (const spec of specs) {
    const isLocal = modulePath != null && (
      spec.path === modulePath || spec.path.startsWith(modulePath + "/")
    );

    if (isLocal) {
      const relDir = spec.path === modulePath
        ? "."
        : spec.path.slice(modulePath!.length + 1);

      const goFiles = findGoPackageFiles(join(ctx.rootDir, relDir));

      if (goFiles.length > 0) {
        for (const goFile of goFiles) {
          const targetPath = relDir === "." ? goFile : join(relDir, goFile);
          const targetId = `file:${targetPath}`;
          nodes.push({ id: targetId, kind: "file", filePath: targetPath, name: targetPath });
          edges.push({
            from: fileId,
            to: targetId,
            kind: "imports",
            metadata: { specifier: spec.path, line: spec.line },
          });
        }
      } else {
        const targetId = `file:${relDir}`;
        nodes.push({ id: targetId, kind: "file", filePath: relDir, name: relDir });
        edges.push({
          from: fileId,
          to: targetId,
          kind: "imports",
          metadata: { specifier: spec.path, line: spec.line, unresolved: true },
        });
      }
    } else {
      edges.push({
        from: fileId,
        to: `external:${spec.path}`,
        kind: "imports",
        metadata: { specifier: spec.path, line: spec.line },
      });
    }
  }
}

function collectImportSpecs(node: SyntaxNode): ImportSpec[] {
  const specs: ImportSpec[] = [];

  function walk(n: SyntaxNode): void {
    if (n.type === "import_spec") {
      const pathNode = n.children.find((c) =>
        c.type === "interpreted_string_literal" || c.type === "raw_string_literal",
      );
      if (pathNode) {
        specs.push({ path: stripGoQuotes(pathNode.text), line: pathNode.startPosition.row + 1 });
      }
      return;
    }

    if (
      (n.type === "interpreted_string_literal" || n.type === "raw_string_literal") &&
      n.parent?.type === "import_declaration"
    ) {
      specs.push({ path: stripGoQuotes(n.text), line: n.startPosition.row + 1 });
      return;
    }

    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return specs;
}

function stripGoQuotes(str: string): string {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith('`') && str.endsWith('`'))) {
    return str.slice(1, -1);
  }
  return str;
}

function getGoModulePath(rootDir: string): string | null {
  const cached = _goModCache.get(rootDir);
  if (cached !== undefined) return cached;

  try {
    const content = readFileSync(join(rootDir, "go.mod"), "utf-8");
    const match = content.match(/^module\s+(.+)$/m);
    const result = match ? match[1].trim() : null;
    _goModCache.set(rootDir, result);
    return result;
  } catch {
    _goModCache.set(rootDir, null);
    return null;
  }
}

/**
 * Find non-test .go files in a directory — these form the package's public API.
 * Test files (_test.go) are scanned independently but aren't targets for
 * package-level imports.
 */
function findGoPackageFiles(dirPath: string): string[] {
  try {
    return readdirSync(dirPath)
      .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))
      .sort();
  } catch {
    return [];
  }
}
