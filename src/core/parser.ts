import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript);

const tsxParser = new Parser();
tsxParser.setLanguage(TypeScript.tsx);

export interface ParseResult {
  filePath: string;
  tree: Parser.Tree;
  source: string;
  language: "typescript" | "tsx";
}

function getLanguage(filePath: string): "typescript" | "tsx" | null {
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
    default:
      return null;
  }
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

export async function parseFile(
  rootDir: string,
  relativePath: string,
): Promise<ParseResult | null> {
  const language = getLanguage(relativePath);
  if (!language) return null;

  try {
    const fullPath = `${rootDir}/${relativePath}`;
    const source = await readFile(fullPath, "utf-8");
    const parser = language === "tsx" ? tsxParser : tsParser;
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
