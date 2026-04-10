import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import type { DependencyGraph } from "../core/graph.js";

export function registerTreeCommand(program: Command): void {
  program
    .command("tree")
    .description("Show dependency tree for a file — like cargo tree for your imports")
    .argument("<file>", "File to show the tree for")
    .argument("[dir]", "Project root directory", ".")
    .option("-r, --reverse", "Reverse tree — show what depends on this file")
    .option("-d, --depth <n>", "Maximum depth to display", "6")
    .option("--no-externals", "Hide external dependencies")
    .option("--json", "Output as JSON")
    .action(async (file: string, dir: string, opts: {
      reverse?: boolean; depth: string; externals: boolean; json?: boolean;
    }) => {
      const rootDir = resolve(dir);
      const maxDepth = parseInt(opts.depth, 10);
      const { graph } = await analyzeProject(rootDir);

      const fileId = `file:${file}`;
      const node = graph.getNode(fileId);

      if (!node) {
        if (opts.json) {
          console.log(JSON.stringify({ error: "File not found", file }));
        } else {
          console.log(`\n  File not found: ${file}\n`);
        }
        return;
      }

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const cyan = "\x1b[36m";

      if (opts.json) {
        const tree = buildTreeData(graph, fileId, opts.reverse ?? false, maxDepth, opts.externals);
        console.log(JSON.stringify(tree, null, 2));
        return;
      }

      const direction = opts.reverse ? "reverse" : "forward";
      const label = opts.reverse ? "Dependents of" : "Dependencies of";
      console.log(`\n  ${bold}${label}${reset} ${cyan}${file}${reset}\n`);

      const seen = new Set<string>();
      const lines: string[] = [];
      printTree(graph, fileId, "", true, seen, lines, direction, maxDepth, 0, opts.externals);

      for (const line of lines) {
        console.log("  " + line);
      }

      const total = seen.size - 1;
      console.log(`\n  ${dim}${total} ${opts.reverse ? "dependent(s)" : "dependenc" + (total === 1 ? "y" : "ies")} (max depth ${maxDepth})${reset}\n`);
    });
}

function printTree(
  graph: DependencyGraph,
  nodeId: string,
  prefix: string,
  isLast: boolean,
  seen: Set<string>,
  lines: string[],
  direction: "forward" | "reverse",
  maxDepth: number,
  depth: number,
  showExternals: boolean,
): void {
  const filePath = nodeId.replace(/^(file:|external:)/, "");
  const isExternal = nodeId.startsWith("external:");
  const isRoot = depth === 0;

  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";
  const green = "\x1b[32m";

  const connector = isRoot ? "" : (isLast ? "└── " : "├── ");
  const wasSeen = seen.has(nodeId);
  seen.add(nodeId);

  let label = filePath;
  if (isExternal) {
    label = `${dim}${filePath} [ext]${reset}`;
  } else if (wasSeen) {
    label = `${dim}${filePath} (circular ↑)${reset}`;
  } else {
    label = isRoot ? `${cyan}${filePath}${reset}` : filePath;
  }

  lines.push(prefix + connector + label);

  if (wasSeen || depth >= maxDepth || isExternal) return;

  let children: string[];
  if (direction === "forward") {
    const deps = graph.getDependencies(nodeId).filter((e) => e.kind === "imports");
    children = [...new Set(deps.map((e) => e.to))];
    if (!showExternals) {
      children = children.filter((c) => !c.startsWith("external:"));
    }
  } else {
    const deps = graph.getDependents(nodeId).filter((e) => e.kind === "imports");
    children = [...new Set(deps.map((e) => e.from))];
  }

  children.sort((a, b) => {
    const aExt = a.startsWith("external:");
    const bExt = b.startsWith("external:");
    if (aExt !== bExt) return aExt ? 1 : -1;
    return a.localeCompare(b);
  });

  const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");

  for (let i = 0; i < children.length; i++) {
    const childIsLast = i === children.length - 1;
    printTree(graph, children[i], childPrefix, childIsLast, seen, lines, direction, maxDepth, depth + 1, showExternals);
  }
}

interface TreeNode {
  file: string;
  external?: boolean;
  circular?: boolean;
  children?: TreeNode[];
}

function buildTreeData(
  graph: DependencyGraph,
  rootId: string,
  reverse: boolean,
  maxDepth: number,
  showExternals: boolean,
): TreeNode {
  const seen = new Set<string>();

  function build(nodeId: string, depth: number): TreeNode {
    const filePath = nodeId.replace(/^(file:|external:)/, "");
    const isExternal = nodeId.startsWith("external:");
    const wasSeen = seen.has(nodeId);
    seen.add(nodeId);

    const node: TreeNode = { file: filePath };
    if (isExternal) node.external = true;
    if (wasSeen) { node.circular = true; return node; }
    if (depth >= maxDepth || isExternal) return node;

    let children: string[];
    if (!reverse) {
      const deps = graph.getDependencies(nodeId).filter((e) => e.kind === "imports");
      children = deps.map((e) => e.to);
      if (!showExternals) children = children.filter((c) => !c.startsWith("external:"));
    } else {
      const deps = graph.getDependents(nodeId).filter((e) => e.kind === "imports");
      children = deps.map((e) => e.from);
    }

    if (children.length > 0) {
      node.children = children.sort().map((c) => build(c, depth + 1));
    }
    return node;
  }

  return build(rootId, 0);
}
