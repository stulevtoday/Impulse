#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject, getFileImpact, getParseWarnings, DependencyGraph } from "../core/index.js";
import { createWatcher } from "../watchers/fs-watcher.js";

const program = new Command();

program
  .name("impulse")
  .description("Understand your project. Know what breaks before it breaks.")
  .version("0.1.0");

function printWarnings(): void {
  const warnings = getParseWarnings();
  if (warnings.length > 0) {
    console.log(`  ⚠ ${warnings.length} file(s) could not be parsed:`);
    for (const w of warnings) {
      console.log(`    ${w.filePath}: ${w.error}`);
    }
    console.log();
  }
}

program
  .command("scan")
  .description("Scan a project and build the dependency graph")
  .argument("[dir]", "Project root directory", ".")
  .action(async (dir: string) => {
    const rootDir = resolve(dir);
    console.log(`\n  Impulse — scanning ${rootDir}\n`);

    const { graph, stats } = await analyzeProject(rootDir);

    console.log(`  Files scanned:  ${stats.filesScanned}`);
    if (stats.filesFailed > 0) {
      console.log(`  Files failed:   ${stats.filesFailed}`);
    }
    console.log(`  Path aliases:   ${stats.aliases}`);
    console.log(`  Nodes in graph: ${stats.nodeCount}`);
    console.log(`  Edges in graph: ${stats.edgeCount}`);
    console.log(`  Time:           ${stats.durationMs}ms\n`);

    printWarnings();

    const fileNodes = graph
      .allNodes()
      .filter((n) => n.kind === "file")
      .sort((a, b) => {
        const aDeps = graph.getDependencies(a.id).length;
        const bDeps = graph.getDependencies(b.id).length;
        return bDeps - aDeps;
      });

    if (fileNodes.length > 0) {
      console.log("  Files (sorted by import count):");
      for (const node of fileNodes.slice(0, 40)) {
        const deps = graph.getDependencies(node.id).filter((e) => e.kind === "imports");
        const localDeps = deps.filter((e) => !e.to.startsWith("external:")).length;
        const extDeps = deps.filter((e) => e.to.startsWith("external:")).length;
        console.log(
          `    ${node.filePath}  (${localDeps} local, ${extDeps} external)`,
        );
      }
      if (fileNodes.length > 40) {
        console.log(`    ...and ${fileNodes.length - 40} more`);
      }
    }

    console.log();
  });

program
  .command("impact")
  .description("Show what is affected by changing a file")
  .argument("<file>", "Relative path to the changed file")
  .argument("[dir]", "Project root directory", ".")
  .option("-d, --depth <n>", "Maximum traversal depth", "5")
  .action(async (file: string, dir: string, opts: { depth: string }) => {
    const rootDir = resolve(dir);
    const maxDepth = parseInt(opts.depth, 10);

    console.log(`\n  Impulse — analyzing impact of ${file}\n`);

    const { graph, stats } = await analyzeProject(rootDir);
    const impact = getFileImpact(graph, file, maxDepth);

    if (impact.affected.length === 0) {
      console.log("  No dependents found. This file is a leaf node.\n");
      return;
    }

    console.log(`  Changing ${file} affects:\n`);
    for (const item of impact.affected) {
      const indent = "  ".repeat(item.depth);
      const depthLabel = item.depth === 1 ? "direct" : `depth ${item.depth}`;
      console.log(`  ${indent}→ ${item.node.filePath}  (${depthLabel})`);
    }

    console.log(
      `\n  Total: ${impact.affected.length} affected nodes (scanned ${stats.filesScanned} files in ${stats.durationMs}ms)\n`,
    );
  });

program
  .command("graph")
  .description("Show the full dependency graph as an edge list")
  .argument("[dir]", "Project root directory", ".")
  .option("--local", "Only show local dependencies, hide external", false)
  .action(async (dir: string, opts: { local: boolean }) => {
    const rootDir = resolve(dir);

    const { graph, stats } = await analyzeProject(rootDir);
    let edges = graph.allEdges();

    if (opts.local) {
      edges = edges.filter((e) => !e.to.startsWith("external:"));
    }

    console.log(`\n  Impulse — dependency graph for ${rootDir}\n`);
    console.log(`  ${stats.nodeCount} nodes, ${stats.edgeCount} edges\n`);

    for (const edge of edges) {
      const from = edge.from.replace(/^file:/, "");
      const to = edge.to.replace(/^(file:|external:)/, "");
      const label = edge.to.startsWith("external:") ? " [ext]" : "";
      console.log(`  ${from}  →  ${to}${label}`);
    }

    console.log();
  });

program
  .command("why")
  .description("Show why file A depends on file B (the full chain)")
  .argument("<from>", "Source file (the one that might break)")
  .argument("<to>", "Target file (the one being changed)")
  .argument("[dir]", "Project root directory", ".")
  .action(async (from: string, to: string, dir: string) => {
    const rootDir = resolve(dir);
    console.log(`\n  Impulse — why does ${from} depend on ${to}?\n`);

    const { graph } = await analyzeProject(rootDir);
    const path = findPath(graph, `file:${from}`, `file:${to}`);

    if (!path) {
      console.log(`  No dependency path found from ${from} to ${to}.\n`);
      return;
    }

    console.log("  Dependency chain:\n");
    for (let i = 0; i < path.length; i++) {
      const label = path[i].replace(/^file:/, "");
      const prefix = i === 0 ? "  " : "    → ";
      console.log(`${prefix}${label}`);
    }
    console.log();
  });

function findPath(
  graph: import("../core/index.js").DependencyGraph,
  fromId: string,
  toId: string,
): string[] | null {
  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[] }> = [
    { id: fromId, path: [fromId] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === toId) return current.path;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    for (const edge of graph.getDependencies(current.id)) {
      if (!visited.has(edge.to)) {
        queue.push({ id: edge.to, path: [...current.path, edge.to] });
      }
    }
  }

  return null;
}

program
  .command("watch")
  .description("Watch a project for changes and show impact in real-time")
  .argument("[dir]", "Project root directory", ".")
  .action(async (dir: string) => {
    const rootDir = resolve(dir);
    console.log(`\n  Impulse — building initial graph for ${rootDir}...\n`);

    const { graph, ctx, stats } = await analyzeProject(rootDir);

    console.log(
      `  Ready. ${stats.filesScanned} files, ${stats.edgeCount} edges (${stats.durationMs}ms)`,
    );
    printWarnings();
    console.log("  Watching for changes... (Ctrl+C to stop)\n");

    createWatcher(rootDir, graph, ctx, {
      onChange(filePath, affected) {
        const time = new Date().toLocaleTimeString();
        console.log(`  [${time}] Changed: ${filePath}`);
        if (affected.length > 0) {
          console.log(`           Impact: ${affected.length} file(s) affected`);
          for (const f of affected.slice(0, 10)) {
            console.log(`             → ${f}`);
          }
          if (affected.length > 10) {
            console.log(`             ...and ${affected.length - 10} more`);
          }
        } else {
          console.log("           No dependents affected.");
        }
        const { nodes, edges } = graph.stats;
        console.log(`           Graph: ${nodes} nodes, ${edges} edges\n`);
      },
      onAdd(filePath) {
        const time = new Date().toLocaleTimeString();
        console.log(`  [${time}] Added: ${filePath}\n`);
      },
      onRemove(filePath) {
        const time = new Date().toLocaleTimeString();
        console.log(`  [${time}] Removed: ${filePath}\n`);
      },
      onError(error) {
        console.error(`  Error: ${error.message}`);
      },
    });
  });

program.parse();
