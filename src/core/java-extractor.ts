import { rootNode, type ParseResult, type SyntaxNode } from "./parser-types.js";
import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ExtractorContext, ExtractionResult } from "./types.js";
import { join } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";

/**
 * Java uses packages and class-level imports. Strategy:
 * 1. Build a package→files map for the entire project (cached)
 * 2. Build a fully-qualified type→file map for precise resolution
 * 3. For each file, extract imports via tree-sitter AST
 * 4. Resolve imports to local files or mark as external
 * 5. Detect public type declarations as exports
 */

let _packageMapCache = new Map<string, Map<string, string[]>>();
let _typeMapCache = new Map<string, Map<string, string>>();

const JAVA_STDLIB_ROOTS = new Set([
  "java", "javax", "javafx", "sun", "jdk",
]);

const JAVA_KNOWN_EXTERNAL_PREFIXES = [
  "com.sun.", "com.oracle.", "org.w3c.", "org.xml.", "org.ietf.",
];

const JAVA_SKIP_DIRS = new Set([
  "node_modules", "target", "build", ".gradle", ".git",
  ".idea", ".settings", "bin", "out", ".mvn",
]);

export function extractJavaDependencies(
  parsed: ParseResult,
  ctx: ExtractorContext,
): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileId = `file:${parsed.filePath}`;

  nodes.push({ id: fileId, kind: "file", filePath: parsed.filePath, name: parsed.filePath });

  if (!parsed.tree) return { nodes, edges };

  const root = rootNode(parsed.tree);
  const pkgMap = getPackageMap(ctx.rootDir);
  const typeMap = getTypeMap(ctx.rootDir, pkgMap);

  visitJavaNode(root, parsed, ctx, pkgMap, typeMap, fileId, nodes, edges);

  return { nodes, edges };
}

function visitJavaNode(
  node: SyntaxNode,
  parsed: ParseResult,
  ctx: ExtractorContext,
  pkgMap: Map<string, string[]>,
  typeMap: Map<string, string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  switch (node.type) {
    case "import_declaration":
      handleImport(node, parsed, ctx, pkgMap, typeMap, fileId, nodes, edges);
      return;
    case "class_declaration":
    case "interface_declaration":
    case "enum_declaration":
    case "record_declaration":
    case "annotation_type_declaration":
      handleTypeDeclaration(node, parsed, fileId, nodes, edges);
      break;
  }

  for (const child of node.children) {
    visitJavaNode(child, parsed, ctx, pkgMap, typeMap, fileId, nodes, edges);
  }
}

// ── Import Handling ──

interface JavaImport {
  path: string;
  isStatic: boolean;
  isWildcard: boolean;
  line: number;
}

function parseImportNode(node: SyntaxNode): JavaImport | null {
  const isStatic = node.children.some((c) => c.text === "static");
  const isWildcard = node.children.some((c) => c.type === "asterisk" || c.text === "*");

  const scopedId = node.children.find((c) =>
    c.type === "scoped_identifier" || c.type === "identifier",
  );
  if (!scopedId) return null;

  return {
    path: scopedId.text,
    isStatic,
    isWildcard,
    line: node.startPosition.row + 1,
  };
}

function handleImport(
  node: SyntaxNode,
  parsed: ParseResult,
  _ctx: ExtractorContext,
  pkgMap: Map<string, string[]>,
  typeMap: Map<string, string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const imp = parseImportNode(node);
  if (!imp) return;

  const specifier = imp.isWildcard ? `${imp.path}.*` : imp.path;

  if (isExternalImport(imp.path)) {
    edges.push({
      from: fileId,
      to: `external:${specifier}`,
      kind: "imports",
      metadata: { specifier, line: imp.line },
    });
    return;
  }

  if (imp.isWildcard) {
    handleWildcardImport(imp, specifier, parsed, pkgMap, fileId, nodes, edges);
    return;
  }

  if (imp.isStatic) {
    handleStaticImport(imp, specifier, typeMap, parsed, fileId, nodes, edges);
    return;
  }

  handleRegularImport(imp, typeMap, parsed, fileId, nodes, edges);
}

function handleWildcardImport(
  imp: JavaImport,
  specifier: string,
  parsed: ParseResult,
  pkgMap: Map<string, string[]>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const pkgFiles = (pkgMap.get(imp.path) ?? []).filter((f) => f !== parsed.filePath);

  if (pkgFiles.length > 0) {
    for (const target of pkgFiles) {
      const targetId = `file:${target}`;
      nodes.push({ id: targetId, kind: "file", filePath: target, name: target });
      edges.push({
        from: fileId,
        to: targetId,
        kind: "imports",
        metadata: { specifier, line: imp.line },
      });
    }
  } else {
    edges.push({
      from: fileId,
      to: `external:${specifier}`,
      kind: "imports",
      metadata: { specifier, line: imp.line },
    });
  }
}

function handleStaticImport(
  imp: JavaImport,
  specifier: string,
  typeMap: Map<string, string>,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const resolved = resolveStaticImport(imp.path, typeMap);

  if (resolved && resolved !== parsed.filePath) {
    const targetId = `file:${resolved}`;
    nodes.push({ id: targetId, kind: "file", filePath: resolved, name: resolved });
    edges.push({
      from: fileId,
      to: targetId,
      kind: "imports",
      metadata: { specifier, line: imp.line },
    });
  } else {
    edges.push({
      from: fileId,
      to: `external:${specifier}`,
      kind: "imports",
      metadata: { specifier, line: imp.line },
    });
  }
}

function handleRegularImport(
  imp: JavaImport,
  typeMap: Map<string, string>,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const typeFile = typeMap.get(imp.path);

  if (typeFile && typeFile !== parsed.filePath) {
    const targetId = `file:${typeFile}`;
    nodes.push({ id: targetId, kind: "file", filePath: typeFile, name: typeFile });
    edges.push({
      from: fileId,
      to: targetId,
      kind: "imports",
      metadata: { specifier: imp.path, line: imp.line },
    });

    const className = imp.path.split(".").pop()!;
    const exportId = `export:${typeFile}:${className}`;
    nodes.push({ id: exportId, kind: "export", filePath: typeFile, name: className });
    edges.push({
      from: fileId,
      to: exportId,
      kind: "uses_export",
      metadata: { line: imp.line },
    });
  } else {
    edges.push({
      from: fileId,
      to: `external:${imp.path}`,
      kind: "imports",
      metadata: { specifier: imp.path, line: imp.line },
    });
  }
}

// ── Export Detection (public types) ──

function handleTypeDeclaration(
  node: SyntaxNode,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const modifiers = node.children.find((c) => c.type === "modifiers");
  const isPublic = modifiers?.children.some((c) => c.text === "public") ?? false;
  if (!isPublic) return;

  const nameNode = node.children.find((c) => c.type === "identifier");
  if (!nameNode) return;

  const exportId = `export:${parsed.filePath}:${nameNode.text}`;
  nodes.push({
    id: exportId,
    kind: "export",
    filePath: parsed.filePath,
    name: nameNode.text,
    line: nameNode.startPosition.row + 1,
  });
  edges.push({ from: fileId, to: exportId, kind: "exports", metadata: {} });
}

// ── Resolution Helpers ──

function isExternalImport(path: string): boolean {
  const root = path.split(".")[0];
  if (JAVA_STDLIB_ROOTS.has(root)) return true;
  for (const prefix of JAVA_KNOWN_EXTERNAL_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Static imports reference a member: com.example.MyClass.method
 * Walk backwards through segments to find the class in the type map.
 */
function resolveStaticImport(
  path: string,
  typeMap: Map<string, string>,
): string | null {
  const parts = path.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    const candidate = parts.slice(0, i).join(".");
    const file = typeMap.get(candidate);
    if (file) return file;
  }
  return null;
}

// ── Package and Type Map Construction ──

const PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;/m;
const PUBLIC_TYPE_RE =
  /\bpublic\s+(?:(?:static|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+(\w+)/g;

function getPackageMap(rootDir: string): Map<string, string[]> {
  const cached = _packageMapCache.get(rootDir);
  if (cached) return cached;

  const pkgMap = new Map<string, string[]>();
  const javaFiles = findAllJavaFiles(rootDir, "");

  for (const file of javaFiles) {
    try {
      const content = readFileSync(join(rootDir, file), "utf-8");
      const match = content.match(PACKAGE_RE);
      if (match) {
        const pkg = match[1];
        const list = pkgMap.get(pkg) ?? [];
        list.push(file);
        pkgMap.set(pkg, list);
      }
    } catch { /* skip unreadable */ }
  }

  _packageMapCache.set(rootDir, pkgMap);
  return pkgMap;
}

function getTypeMap(
  rootDir: string,
  pkgMap: Map<string, string[]>,
): Map<string, string> {
  const cached = _typeMapCache.get(rootDir);
  if (cached) return cached;

  const typeMap = new Map<string, string>();

  for (const [pkg, files] of pkgMap) {
    for (const file of files) {
      try {
        const content = readFileSync(join(rootDir, file), "utf-8");
        PUBLIC_TYPE_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = PUBLIC_TYPE_RE.exec(content)) !== null) {
          typeMap.set(`${pkg}.${match[1]}`, file);
        }
      } catch { /* skip */ }
    }
  }

  _typeMapCache.set(rootDir, typeMap);
  return typeMap;
}

function findAllJavaFiles(rootDir: string, rel: string): string[] {
  const results: string[] = [];
  const abs = rel ? join(rootDir, rel) : rootDir;

  try {
    for (const entry of readdirSync(abs)) {
      if (JAVA_SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const entryRel = rel ? `${rel}/${entry}` : entry;
      const entryAbs = join(abs, entry);

      try {
        const stat = statSync(entryAbs);
        if (stat.isDirectory()) {
          results.push(...findAllJavaFiles(rootDir, entryRel));
        } else if (entry.endsWith(".java")) {
          results.push(entryRel);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results;
}
