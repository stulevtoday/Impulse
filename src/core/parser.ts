import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createRequire } from "node:module";

export type SyntaxNode = Omit<
  Node,
  "children" | "namedChildren" | "parent"
> & {
  readonly children: SyntaxNode[];
  readonly namedChildren: SyntaxNode[];
  readonly parent: SyntaxNode | null;
};

export function rootNode(tree: Tree): SyntaxNode {
  return tree.rootNode as unknown as SyntaxNode;
}

export type { Tree };

const require = createRequire(import.meta.url);

function wasmPath(name: string): string {
  return require.resolve(`tree-sitter-wasms/out/${name}`);
}

type LanguageId = "typescript" | "tsx" | "python" | "go" | "rust" | "csharp";

export interface ParseResult {
  filePath: string;
  tree: Tree | null;
  source: string;
  language: LanguageId;
}

export interface ParseWarning {
  filePath: string;
  error: string;
}

const warnings: ParseWarning[] = [];

export function getParseWarnings(): ParseWarning[] {
  return [...warnings];
}

export function clearParseWarnings(): void {
  warnings.length = 0;
}

const WASM_FILES: Record<Exclude<LanguageId, "csharp">, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
};

const parsers = new Map<string, Parser>();
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (parsers.size > 0) return;
  if (!initPromise) {
    initPromise = doInit();
  }
  return initPromise;
}

async function doInit(): Promise<void> {
  await Parser.init();

  const entries = Object.entries(WASM_FILES) as [string, string][];
  for (const [lang, file] of entries) {
    const parser = new Parser();
    const language = await Language.load(wasmPath(file));
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
}

function getLanguage(filePath: string): LanguageId | null {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return "typescript";
    case ".py":
    case ".pyw":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".cs":
      return "csharp";
    default:
      return null;
  }
}

export async function parseFile(
  rootDir: string,
  relativePath: string,
): Promise<ParseResult | null> {
  const language = getLanguage(relativePath);
  if (!language) return null;

  try {
    await ensureInit();
    const fullPath = `${rootDir}/${relativePath}`;
    const source = await readFile(fullPath, "utf-8");

    if (language === "csharp") {
      return { filePath: relativePath, tree: null, source, language };
    }

    const parser = parsers.get(language)!;
    const tree = parser.parse(source);
    if (!tree) return null;

    return { filePath: relativePath, tree, source, language };
  } catch (err) {
    warnings.push({
      filePath: relativePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
