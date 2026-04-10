import { rootNode, type ParseResult, type SyntaxNode } from "./parser-types.js";
import type { GraphNode, GraphEdge } from "./graph-types.js";
import type { ExtractorContext, ExtractionResult } from "./types.js";
import { join } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";

/**
 * Kotlin uses the JVM package/import system. Strategy:
 * 1. Build package→files map scanning both .kt and .java files (JVM interop)
 * 2. Build fully-qualified name→file type map for precise resolution
 * 3. Resolve imports via tree-sitter AST
 * 4. Kotlin is public-by-default — export anything without private/internal/protected
 */

let _packageMapCache = new Map<string, Map<string, string[]>>();
let _typeMapCache = new Map<string, Map<string, string>>();

const KOTLIN_STDLIB_ROOTS = new Set([
  "kotlin", "kotlinx", "java", "javax", "javafx", "sun", "jdk",
]);

const KOTLIN_KNOWN_EXTERNAL_PREFIXES = [
  "com.sun.", "com.oracle.", "org.w3c.", "org.xml.", "org.ietf.",
  "org.jetbrains.", "io.ktor.",
];

const JVM_SKIP_DIRS = new Set([
  "node_modules", "target", "build", ".gradle", ".git",
  ".idea", ".settings", "bin", "out", ".mvn",
]);

const NONPUBLIC_VISIBILITY = new Set(["private", "internal", "protected"]);

export function extractKotlinDependencies(
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

  visitKotlinNode(root, parsed, pkgMap, typeMap, fileId, nodes, edges);

  return { nodes, edges };
}

function visitKotlinNode(
  node: SyntaxNode,
  parsed: ParseResult,
  pkgMap: Map<string, string[]>,
  typeMap: Map<string, string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  switch (node.type) {
    case "import_header":
      handleImport(node, parsed, pkgMap, typeMap, fileId, nodes, edges);
      return;
    case "class_declaration":
    case "object_declaration":
      handleTypeExport(node, parsed, fileId, nodes, edges);
      break;
    case "function_declaration":
    case "property_declaration":
      if (node.parent?.type === "source_file") {
        handleMemberExport(node, parsed, fileId, nodes, edges);
      }
      break;
  }

  for (const child of node.children) {
    visitKotlinNode(child, parsed, pkgMap, typeMap, fileId, nodes, edges);
  }
}

// ── Import Handling ──

function handleImport(
  node: SyntaxNode,
  parsed: ParseResult,
  pkgMap: Map<string, string[]>,
  typeMap: Map<string, string>,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const identifierNode = node.children.find((c) => c.type === "identifier");
  if (!identifierNode) return;

  const path = identifierNode.text;
  const isWildcard = node.children.some((c) => c.type === "wildcard_import");
  const line = node.startPosition.row + 1;
  const specifier = isWildcard ? `${path}.*` : path;

  if (isExternalImport(path)) {
    edges.push({
      from: fileId,
      to: `external:${specifier}`,
      kind: "imports",
      metadata: { specifier, line },
    });
    return;
  }

  if (isWildcard) {
    const pkgFiles = (pkgMap.get(path) ?? []).filter((f) => f !== parsed.filePath);
    if (pkgFiles.length > 0) {
      for (const target of pkgFiles) {
        const targetId = `file:${target}`;
        nodes.push({ id: targetId, kind: "file", filePath: target, name: target });
        edges.push({ from: fileId, to: targetId, kind: "imports", metadata: { specifier, line } });
      }
    } else {
      edges.push({ from: fileId, to: `external:${specifier}`, kind: "imports", metadata: { specifier, line } });
    }
    return;
  }

  const typeFile = typeMap.get(path);
  if (typeFile && typeFile !== parsed.filePath) {
    const targetId = `file:${typeFile}`;
    nodes.push({ id: targetId, kind: "file", filePath: typeFile, name: typeFile });
    edges.push({ from: fileId, to: targetId, kind: "imports", metadata: { specifier: path, line } });

    const name = path.split(".").pop()!;
    const exportId = `export:${typeFile}:${name}`;
    nodes.push({ id: exportId, kind: "export", filePath: typeFile, name });
    edges.push({ from: fileId, to: exportId, kind: "uses_export", metadata: { line } });
  } else {
    edges.push({ from: fileId, to: `external:${path}`, kind: "imports", metadata: { specifier: path, line } });
  }
}

// ── Export Detection ──

function handleTypeExport(
  node: SyntaxNode,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  if (isNonPublic(node)) return;

  const nameNode = node.children.find((c) => c.type === "type_identifier");
  if (!nameNode) return;

  const exportId = `export:${parsed.filePath}:${nameNode.text}`;
  nodes.push({
    id: exportId, kind: "export", filePath: parsed.filePath,
    name: nameNode.text, line: nameNode.startPosition.row + 1,
  });
  edges.push({ from: fileId, to: exportId, kind: "exports", metadata: {} });
}

function handleMemberExport(
  node: SyntaxNode,
  parsed: ParseResult,
  fileId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  if (isNonPublic(node)) return;

  const nameNode = node.children.find((c) => c.type === "simple_identifier");
  if (!nameNode) return;

  const exportId = `export:${parsed.filePath}:${nameNode.text}`;
  nodes.push({
    id: exportId, kind: "export", filePath: parsed.filePath,
    name: nameNode.text, line: nameNode.startPosition.row + 1,
  });
  edges.push({ from: fileId, to: exportId, kind: "exports", metadata: {} });
}

function isNonPublic(node: SyntaxNode): boolean {
  const modifiers = node.children.find((c) => c.type === "modifiers");
  if (!modifiers) return false;
  const vis = modifiers.children.find((c) => c.type === "visibility_modifier");
  return vis != null && NONPUBLIC_VISIBILITY.has(vis.text);
}

// ── Resolution ──

function isExternalImport(path: string): boolean {
  const root = path.split(".")[0];
  if (KOTLIN_STDLIB_ROOTS.has(root)) return true;
  for (const prefix of KOTLIN_KNOWN_EXTERNAL_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

// ── Package and Type Maps ──
// Scans both .kt and .java for cross-language resolution in JVM projects.

const PKG_RE = /^\s*package\s+([\w.]+)/m;

const KT_DECL_RE =
  /^(?:\w+\s+)*(?:class|interface|object|fun|val|var|typealias)\s+(?:<[^>]+>\s+)?(\w+)/gm;
const KT_PRIVATE_DECL_RE =
  /^(?:private|internal|protected)\s+(?:\w+\s+)*(?:class|interface|object|fun|val|var|typealias)\s+(?:<[^>]+>\s+)?(\w+)/gm;

const JAVA_PUBLIC_TYPE_RE =
  /\bpublic\s+(?:(?:static|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+(\w+)/g;

function getPackageMap(rootDir: string): Map<string, string[]> {
  const cached = _packageMapCache.get(rootDir);
  if (cached) return cached;

  const pkgMap = new Map<string, string[]>();
  const files = findJvmSourceFiles(rootDir, "");

  for (const file of files) {
    try {
      const content = readFileSync(join(rootDir, file), "utf-8");
      const match = content.match(PKG_RE);
      if (match) {
        const pkg = match[1];
        const list = pkgMap.get(pkg) ?? [];
        list.push(file);
        pkgMap.set(pkg, list);
      }
    } catch { /* skip */ }
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

        if (file.endsWith(".java")) {
          JAVA_PUBLIC_TYPE_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = JAVA_PUBLIC_TYPE_RE.exec(content)) !== null) {
            typeMap.set(`${pkg}.${m[1]}`, file);
          }
        } else {
          const all = new Set<string>();
          KT_DECL_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = KT_DECL_RE.exec(content)) !== null) all.add(m[1]);

          const nonPublic = new Set<string>();
          KT_PRIVATE_DECL_RE.lastIndex = 0;
          while ((m = KT_PRIVATE_DECL_RE.exec(content)) !== null) nonPublic.add(m[1]);

          for (const name of all) {
            if (!nonPublic.has(name)) typeMap.set(`${pkg}.${name}`, file);
          }
        }
      } catch { /* skip */ }
    }
  }

  _typeMapCache.set(rootDir, typeMap);
  return typeMap;
}

function findJvmSourceFiles(rootDir: string, rel: string): string[] {
  const results: string[] = [];
  const abs = rel ? join(rootDir, rel) : rootDir;

  try {
    for (const entry of readdirSync(abs)) {
      if (JVM_SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const entryRel = rel ? `${rel}/${entry}` : entry;
      const entryAbs = join(abs, entry);

      try {
        const stat = statSync(entryAbs);
        if (stat.isDirectory()) {
          results.push(...findJvmSourceFiles(rootDir, entryRel));
        } else if (entry.endsWith(".kt") || entry.endsWith(".java")) {
          results.push(entryRel);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results;
}
