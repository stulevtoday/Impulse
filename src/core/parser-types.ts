import type { Node, Tree } from "web-tree-sitter";

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

type LanguageId = "typescript" | "tsx" | "python" | "go" | "rust" | "csharp" | "java" | "kotlin" | "php" | "c" | "cpp";

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
