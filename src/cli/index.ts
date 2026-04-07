#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject, getFileImpact } from "../core/index.js";

const program = new Command();

program
  .name("impulse")
  .description("Understand your project. Know what breaks before it breaks.")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a project and build the dependency graph")
  .argument("[dir]", "Project root directory", ".")
  .action(async (dir: string) => {
    const rootDir = resolve(dir);
    console.log(`\n  Impulse — scanning ${rootDir}\n`);

    const { graph, stats } = await analyzeProject(rootDir);

    console.log(`  Files scanned:  ${stats.filesScanned}`);
    console.log(`  Nodes in graph: ${stats.nodeCount}`);
    console.log(`  Edges in graph: ${stats.edgeCount}`);
    console.log(`  Time:           ${stats.durationMs}ms\n`);

    const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
    if (fileNodes.length > 0) {
      console.log("  Files in graph:");
      for (const node of fileNodes.slice(0, 30)) {
        const deps = graph.getDependencies(node.id);
        const depCount = deps.filter((e) => e.kind === "imports").length;
        console.log(`    ${node.filePath}  (${depCount} imports)`);
      }
      if (fileNodes.length > 30) {
        console.log(`    ...and ${fileNodes.length - 30} more\n`);
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
  .action(async (dir: string) => {
    const rootDir = resolve(dir);

    const { graph, stats } = await analyzeProject(rootDir);
    const edges = graph.allEdges();

    console.log(`\n  Impulse — dependency graph for ${rootDir}\n`);
    console.log(`  ${stats.nodeCount} nodes, ${stats.edgeCount} edges\n`);

    for (const edge of edges) {
      const from = edge.from.replace(/^file:/, "");
      const to = edge.to.replace(/^(file:|external:)/, "");
      const label = edge.to.startsWith("external:") ? " [external]" : "";
      console.log(`  ${from}  →  ${to}${label}`);
    }

    console.log();
  });

program.parse();
