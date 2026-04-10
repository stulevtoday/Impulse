import { scanProject } from "./scanner.js";
import { parseFile } from "./parser.js";
import { rootNode, type ParseResult, type SyntaxNode } from "./parser-types.js";

export type ComplexityRisk = "simple" | "moderate" | "complex" | "alarming";

export interface FunctionComplexity {
  name: string;
  filePath: string;
  line: number;
  cyclomatic: number;
  cognitive: number;
  lineCount: number;
  risk: ComplexityRisk;
}

export interface FileComplexity {
  filePath: string;
  functions: FunctionComplexity[];
  totalCyclomatic: number;
  totalCognitive: number;
  avgCognitive: number;
  maxCognitive: number;
}

export interface ComplexityReport {
  files: FileComplexity[];
  functions: FunctionComplexity[];
  totalFunctions: number;
  avgCyclomatic: number;
  avgCognitive: number;
  distribution: {
    simple: number;
    moderate: number;
    complex: number;
    alarming: number;
  };
}

// ---------------------------------------------------------------------------
// Language-specific AST node type configurations
// ---------------------------------------------------------------------------

interface LanguageConfig {
  functions: Set<string>;
  branches: Set<string>;
  cases: Set<string>;
  nesting: Set<string>;
  logicalContainers: Set<string>;
  logicalOps: Set<string>;
  selfLogical: Set<string>;
  elseType: string | null;
  elifType: string | null;
}

function cfg(raw: {
  functions: string[];
  branches: string[];
  cases: string[];
  nesting: string[];
  logicalContainers: string[];
  logicalOps: string[];
  selfLogical?: string[];
  elseType?: string | null;
  elifType?: string | null;
}): LanguageConfig {
  return {
    functions: new Set(raw.functions),
    branches: new Set(raw.branches),
    cases: new Set(raw.cases),
    nesting: new Set(raw.nesting),
    logicalContainers: new Set(raw.logicalContainers),
    logicalOps: new Set(raw.logicalOps),
    selfLogical: new Set(raw.selfLogical ?? []),
    elseType: raw.elseType ?? null,
    elifType: raw.elifType ?? null,
  };
}

const TS_CFG = cfg({
  functions: ["function_declaration", "generator_function_declaration", "method_definition", "arrow_function"],
  branches: ["if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "catch_clause", "ternary_expression"],
  cases: ["switch_case"],
  nesting: ["if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "switch_statement", "try_statement", "arrow_function"],
  logicalContainers: ["binary_expression"],
  logicalOps: ["&&", "||", "??"],
  elseType: "else_clause",
});

const PYTHON_CFG = cfg({
  functions: ["function_definition"],
  branches: ["if_statement", "for_statement", "while_statement", "except_clause", "conditional_expression"],
  cases: [],
  nesting: ["if_statement", "for_statement", "while_statement", "try_statement", "with_statement", "function_definition"],
  logicalContainers: ["boolean_operator"],
  logicalOps: ["and", "or"],
  elseType: "else_clause",
  elifType: "elif_clause",
});

const GO_CFG = cfg({
  functions: ["function_declaration", "method_declaration", "func_literal"],
  branches: ["if_statement", "for_statement", "communication_case", "type_case"],
  cases: ["expression_case", "default_case"],
  nesting: ["if_statement", "for_statement", "expression_switch_statement", "type_switch_statement", "select_statement", "func_literal"],
  logicalContainers: ["binary_expression"],
  logicalOps: ["&&", "||"],
  elseType: "else_clause",
});

const RUST_CFG = cfg({
  functions: ["function_item", "closure_expression"],
  branches: ["if_expression", "if_let_expression", "for_expression", "while_expression", "while_let_expression", "loop_expression"],
  cases: ["match_arm"],
  nesting: ["if_expression", "if_let_expression", "for_expression", "while_expression", "while_let_expression", "loop_expression", "match_expression", "closure_expression"],
  logicalContainers: ["binary_expression"],
  logicalOps: ["&&", "||"],
  elseType: "else_clause",
});

const JAVA_CFG = cfg({
  functions: ["method_declaration", "constructor_declaration", "lambda_expression"],
  branches: ["if_statement", "for_statement", "enhanced_for_statement", "while_statement", "do_statement", "catch_clause", "ternary_expression"],
  cases: ["switch_block_statement_group", "switch_rule"],
  nesting: ["if_statement", "for_statement", "enhanced_for_statement", "while_statement", "do_statement", "switch_expression", "try_statement", "lambda_expression"],
  logicalContainers: ["binary_expression"],
  logicalOps: ["&&", "||"],
  elseType: "else",
});

const KOTLIN_CFG = cfg({
  functions: ["function_declaration", "lambda_literal"],
  branches: ["if_expression", "for_statement", "while_statement", "do_while_statement", "catch_block"],
  cases: ["when_entry"],
  nesting: ["if_expression", "for_statement", "while_statement", "do_while_statement", "when_expression", "lambda_literal"],
  logicalContainers: [],
  logicalOps: [],
  selfLogical: ["conjunction", "disjunction"],
  elseType: null,
});

const PHP_CFG = cfg({
  functions: ["function_definition", "method_declaration", "arrow_function"],
  branches: ["if_statement", "for_statement", "foreach_statement", "while_statement", "do_statement", "catch_clause", "conditional_expression"],
  cases: ["case_statement", "match_condition_list"],
  nesting: ["if_statement", "for_statement", "foreach_statement", "while_statement", "do_statement", "switch_statement", "try_statement", "match_expression", "arrow_function"],
  logicalContainers: ["binary_expression"],
  logicalOps: ["&&", "||", "and", "or", "??"],
  elseType: "else_clause",
  elifType: "else_if_clause",
});

const C_CFG = cfg({
  functions: ["function_definition"],
  branches: ["if_statement", "for_statement", "while_statement", "do_statement", "case_statement", "conditional_expression"],
  cases: ["case_statement"],
  nesting: ["if_statement", "for_statement", "while_statement", "do_statement", "switch_statement"],
  logicalContainers: ["binary_expression"],
  logicalOps: ["&&", "||"],
  elseType: "else_clause",
});

const CPP_CFG = cfg({
  functions: ["function_definition", "lambda_expression"],
  branches: ["if_statement", "for_statement", "for_range_loop", "while_statement", "do_statement", "catch_clause", "conditional_expression"],
  cases: ["case_statement"],
  nesting: ["if_statement", "for_statement", "for_range_loop", "while_statement", "do_statement", "switch_statement", "try_statement", "lambda_expression"],
  logicalContainers: ["binary_expression"],
  logicalOps: ["&&", "||"],
  elseType: "else_clause",
});

const CONFIGS: Record<string, LanguageConfig> = {
  typescript: TS_CFG,
  tsx: TS_CFG,
  python: PYTHON_CFG,
  go: GO_CFG,
  rust: RUST_CFG,
  java: JAVA_CFG,
  kotlin: KOTLIN_CFG,
  php: PHP_CFG,
  c: C_CFG,
  cpp: CPP_CFG,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeComplexity(rootDir: string): Promise<ComplexityReport> {
  const scan = await scanProject(rootDir);
  const files: FileComplexity[] = [];

  const BATCH = 20;
  for (let i = 0; i < scan.files.length; i += BATCH) {
    const batch = scan.files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => parseFile(rootDir, f)));

    for (const parsed of results) {
      if (!parsed) continue;
      const fns = computeFileComplexity(parsed);
      if (fns.length === 0) continue;
      files.push({ filePath: parsed.filePath, functions: fns, ...aggregate(fns) });
    }
  }

  return buildComplexityReport(files);
}

/**
 * Build a ComplexityReport from pre-computed per-file data.
 * Useful when complexity is computed during an existing parse pass
 * (e.g. via the analyzeProject onParsed hook) to avoid double-parsing.
 */
export function buildComplexityReport(files: FileComplexity[]): ComplexityReport {
  const allFunctions: FunctionComplexity[] = [];
  for (const f of files) allFunctions.push(...f.functions);
  allFunctions.sort((a, b) => b.cognitive - a.cognitive);

  const dist = { simple: 0, moderate: 0, complex: 0, alarming: 0 };
  for (const fn of allFunctions) dist[fn.risk]++;

  const avgCyc = allFunctions.length
    ? allFunctions.reduce((s, f) => s + f.cyclomatic, 0) / allFunctions.length
    : 0;
  const avgCog = allFunctions.length
    ? allFunctions.reduce((s, f) => s + f.cognitive, 0) / allFunctions.length
    : 0;

  return {
    files,
    functions: allFunctions,
    totalFunctions: allFunctions.length,
    avgCyclomatic: Math.round(avgCyc * 10) / 10,
    avgCognitive: Math.round(avgCog * 10) / 10,
    distribution: dist,
  };
}

/**
 * Compute complexity for every function/method in a single parsed file.
 * Exported so it can be called independently (e.g. from tests or watch mode).
 */
export function computeFileComplexity(parsed: ParseResult): FunctionComplexity[] {
  if (!parsed.tree) return [];
  const config = CONFIGS[parsed.language];
  if (!config) return [];

  const root = rootNode(parsed.tree);
  const fns = findFunctions(root, config);
  const results: FunctionComplexity[] = [];

  for (const fn of fns) {
    const { cyclomatic, cognitive } = walkComplexity(fn.node, config);
    const lineCount = fn.endLine - fn.line + 1;
    results.push({
      name: fn.name,
      filePath: parsed.filePath,
      line: fn.line,
      cyclomatic,
      cognitive,
      lineCount,
      risk: classifyRisk(cognitive),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Function discovery
// ---------------------------------------------------------------------------

interface FunctionInfo {
  name: string;
  node: SyntaxNode;
  line: number;
  endLine: number;
}

function findFunctions(root: SyntaxNode, config: LanguageConfig): FunctionInfo[] {
  const results: FunctionInfo[] = [];

  function walk(node: SyntaxNode, className: string | null): void {
    if (isClassLike(node)) {
      const name = getChildIdentifier(node);
      for (const child of node.children) walk(child, name);
      return;
    }

    if (config.functions.has(node.type)) {
      const name = resolveFunctionName(node, config, className);
      results.push({
        name,
        node,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
      return;
    }

    if (isVariableWithFunction(node, config)) {
      for (const child of node.children) {
        if (child.type === "variable_declarator" || child.type === "property_declaration") {
          const fnChild = child.children.find((c) => config.functions.has(c.type));
          if (fnChild) {
            const varName = getChildIdentifier(child);
            results.push({
              name: className ? `${className}.${varName ?? "(anonymous)"}` : varName ?? `(anonymous:${fnChild.startPosition.row + 1})`,
              node: fnChild,
              line: fnChild.startPosition.row + 1,
              endLine: fnChild.endPosition.row + 1,
            });
          } else {
            walk(child, className);
          }
        } else {
          walk(child, className);
        }
      }
      return;
    }

    for (const child of node.children) walk(child, className);
  }

  walk(root, null);
  return results;
}

const CLASS_TYPES = new Set([
  "class_declaration", "class", "class_definition",
  "interface_declaration", "object_declaration",
  "impl_item", "trait_item",
  "struct_item",
]);

function isClassLike(node: SyntaxNode): boolean {
  return CLASS_TYPES.has(node.type);
}

function isVariableWithFunction(node: SyntaxNode, config: LanguageConfig): boolean {
  if (node.type !== "lexical_declaration" && node.type !== "variable_declaration" && node.type !== "export_statement") {
    return false;
  }
  return node.children.some((c) => {
    if (c.type === "variable_declarator" || c.type === "property_declaration") {
      return c.children.some((gc) => config.functions.has(gc.type));
    }
    return false;
  });
}

function resolveFunctionName(node: SyntaxNode, config: LanguageConfig, className: string | null): string {
  const ident = getChildIdentifier(node);
  if (ident) return className ? `${className}.${ident}` : ident;

  const declName = findDeclaratorName(node);
  if (declName) return className ? `${className}.${declName}` : declName;

  if (node.parent) {
    if (node.parent.type === "variable_declarator") {
      const varName = getChildIdentifier(node.parent);
      if (varName) return className ? `${className}.${varName}` : varName;
    }
    if (node.parent.type === "pair" || node.parent.type === "property") {
      const key = node.parent.children.find((c) =>
        c.type === "property_identifier" || c.type === "string",
      );
      if (key) return className ? `${className}.${key.text}` : key.text;
    }
  }

  return `(anonymous:${node.startPosition.row + 1})`;
}

function findDeclaratorName(node: SyntaxNode): string | null {
  for (const child of node.children) {
    if (child.type === "function_declarator") return getChildIdentifier(child);
    if (child.type === "pointer_declarator" || child.type === "reference_declarator") {
      const nested = findDeclaratorName(child);
      if (nested) return nested;
    }
  }
  return null;
}

function getChildIdentifier(node: SyntaxNode): string | null {
  for (const child of node.children) {
    if (
      child.type === "identifier" ||
      child.type === "property_identifier" ||
      child.type === "type_identifier" ||
      child.type === "simple_identifier" ||
      child.type === "name"
    ) {
      return child.text;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Complexity computation
// ---------------------------------------------------------------------------

function walkComplexity(
  fnNode: SyntaxNode,
  config: LanguageConfig,
): { cyclomatic: number; cognitive: number } {
  let cyclomatic = 1;
  let cognitive = 0;

  function walk(node: SyntaxNode, nesting: number): void {
    if (node !== fnNode && config.functions.has(node.type)) {
      return;
    }

    // --- else clause: special nesting handling ---
    if (config.elseType && node.type === config.elseType) {
      handleElse(node, nesting);
      return;
    }

    // --- elif (Python, PHP): same level as parent if ---
    if (config.elifType && node.type === config.elifType) {
      const effective = Math.max(0, nesting - 1);
      cyclomatic += 1;
      cognitive += 1 + effective;
      const childNesting = effective + 1;
      for (const child of node.children) walk(child, childNesting);
      return;
    }

    // --- branches ---
    if (config.branches.has(node.type)) {
      cyclomatic += 1;
      cognitive += 1 + nesting;
    }

    // --- switch/match cases ---
    if (config.cases.has(node.type)) {
      cyclomatic += 1;
    }

    // --- logical operators (binary_expression with &&/||) ---
    if (config.logicalContainers.has(node.type)) {
      if (hasLogicalOp(node, config)) {
        cyclomatic += 1;
        cognitive += 1;
      }
    }

    // --- self-referencing logical nodes (Kotlin conjunction/disjunction) ---
    if (config.selfLogical.has(node.type)) {
      cyclomatic += 1;
      cognitive += 1;
    }

    // --- nesting for children ---
    let childNesting = nesting;
    if (config.nesting.has(node.type)) {
      childNesting = nesting + 1;
    }

    for (const child of node.children) walk(child, childNesting);
  }

  function handleElse(node: SyntaxNode, nesting: number): void {
    const chainedIf = node.children.find(
      (c) => config.branches.has(c.type) && c.type.includes("if"),
    );

    if (chainedIf) {
      walk(chainedIf, Math.max(0, nesting - 1));
      for (const child of node.children) {
        if (child !== chainedIf) walk(child, Math.max(0, nesting - 1));
      }
    } else {
      cognitive += 1;
      for (const child of node.children) walk(child, nesting);
    }
  }

  walk(fnNode, 0);
  return { cyclomatic, cognitive };
}

function hasLogicalOp(node: SyntaxNode, config: LanguageConfig): boolean {
  for (const child of node.children) {
    if (child.childCount === 0) {
      if (config.logicalOps.has(child.type) || config.logicalOps.has(child.text)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Risk classification
// ---------------------------------------------------------------------------

function classifyRisk(cognitive: number): ComplexityRisk {
  if (cognitive <= 4) return "simple";
  if (cognitive <= 10) return "moderate";
  if (cognitive <= 25) return "complex";
  return "alarming";
}

function aggregate(fns: FunctionComplexity[]): {
  totalCyclomatic: number;
  totalCognitive: number;
  avgCognitive: number;
  maxCognitive: number;
} {
  let totalCyc = 0;
  let totalCog = 0;
  let maxCog = 0;
  for (const fn of fns) {
    totalCyc += fn.cyclomatic;
    totalCog += fn.cognitive;
    if (fn.cognitive > maxCog) maxCog = fn.cognitive;
  }
  return {
    totalCyclomatic: totalCyc,
    totalCognitive: totalCog,
    avgCognitive: fns.length ? Math.round((totalCog / fns.length) * 10) / 10 : 0,
    maxCognitive: maxCog,
  };
}
