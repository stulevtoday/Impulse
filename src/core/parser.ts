import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript);

const tsxParser = new Parser();
tsxParser.setLanguage(TypeScript.tsx);

const pyParser = new Parser();
pyParser.setLanguage(Python);

const goParser = new Parser();
goParser.setLanguage(Go);

const rustParser = new Parser();
rustParser.setLanguage(Rust);

export type Language = "typescript" | "tsx" | "python" | "go" | "rust";

export interface ParseResult {
  filePath: string;
  tree: Parser.Tree;
  source: string;
  language: Language;
}

function getLanguage(filePath: string): Language | null {
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
    default:
      return null;
  }
}

const parserMap: Record<Language, Parser> = {
  typescript: tsParser,
  tsx: tsxParser,
  python: pyParser,
  go: goParser,
  rust: rustParser,
};

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

export async function parseFile(
  rootDir: string,
  relativePath: string,
): Promise<ParseResult | null> {
  const language = getLanguage(relativePath);
  if (!language) return null;

  try {
    const fullPath = `${rootDir}/${relativePath}`;
    const source = await readFile(fullPath, "utf-8");
    const parser = parserMap[language];
    const tree = parser.parse(source);
    return { filePath: relativePath, tree, source, language };
  } catch (err) {
    warnings.push({
      filePath: relativePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
