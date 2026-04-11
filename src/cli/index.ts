#!/usr/bin/env node

import { Command } from "commander";
import { resolve, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../core/analyzer.js";
import { getParseWarnings } from "../core/parser.js";
import { loadEnvFiles, analyzeEnv } from "../core/env.js";
import { DependencyGraph } from "../core/graph.js";
import { exportGraph, type ExportFormat } from "../core/export-graph.js";
import { analyzeHealth } from "../core/health.js";
import { loadConfig } from "../core/config.js";
import { generateBadgeSVG, type BadgeStyle } from "../core/badge.js";
import { createWatcher } from "../watchers/fs-watcher.js";
import { startDaemon } from "../server/index.js";
import { startExplorer } from "./explore.js";
import { registerDiffCommand } from "./diff.js";
import { registerImpactCommand } from "./impact.js";
import { registerHistoryCommand } from "./history.js";
import { registerHealthCommand } from "./health.js";
import { registerSuggestCommand } from "./suggest.js";
import { registerCheckCommand, registerInitCommand } from "./check.js";
import { registerHotspotsCommand } from "./hotspots.js";
import { registerExportsCommand } from "./exports.js";
import { registerTestCommand } from "./test-cmd.js";
import { registerCouplingCommand } from "./coupling.js";
import { registerFocusCommand } from "./focus.js";
import { registerDoctorCommand } from "./doctor.js";
import { registerSafeDeleteCommand } from "./safe-delete.js";
import { registerCompareCommand } from "./compare.js";
import { registerTreeCommand } from "./tree.js";
import { registerComplexityCommand } from "./complexity.js";
import { registerRiskCommand } from "./risk.js";
import { registerRefactorCommand } from "./refactor.js";
import { registerReviewCommand } from "./review.js";
import { runDashboard } from "./dashboard.js";

const program = new Command();

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));

program
  .name("impulse")
  .description("Understand your project. Know what breaks before it breaks.")
  .version(version);

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
  .option("--json", "Output as JSON")
  .action(async (dir: string, opts: { json?: boolean }) => {
    const rootDir = resolve(dir);

    if (opts.json) {
      const { graph, stats } = await analyzeProject(rootDir);
      const files = graph.allNodes().filter((n) => n.kind === "file").map((n) => {
        const deps = graph.getDependencies(n.id).filter((e) => e.kind === "imports");
        return {
          file: n.filePath,
          localImports: deps.filter((e) => !e.to.startsWith("external:")).length,
          externalImports: deps.filter((e) => e.to.startsWith("external:")).length,
          importedBy: graph.getDependents(n.id).filter((e) => e.kind === "imports").length,
        };
      });
      console.log(JSON.stringify({ ...stats, files }, null, 2));
      return;
    }

    process.stdout.write(`\n  Impulse — scanning ${rootDir}...\r`);

    const { graph, stats } = await analyzeProject(rootDir);
    process.stdout.write(`\x1b[K`);

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
    console.log(`  \x1b[2mTry: impulse health .  ·  impulse visualize .  ·  impulse impact <file> .\x1b[0m\n`);
  });

registerImpactCommand(program);

program
  .command("graph")
  .description("Show the full dependency graph — supports mermaid, dot, and json export")
  .argument("[dir]", "Project root directory", ".")
  .option("--local", "Only show local dependencies, hide external", false)
  .option("--format <fmt>", "Output format: text, mermaid, dot, json", "text")
  .action(async (dir: string, opts: { local: boolean; format: string }) => {
    const rootDir = resolve(dir);

    const { graph, stats } = await analyzeProject(rootDir);

    if (opts.format !== "text") {
      const fmt = opts.format as ExportFormat;
      console.log(exportGraph(graph, fmt, opts.local));
      return;
    }

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
  graph: DependencyGraph,
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
      onConfigChange(configFile, rebuildStats) {
        const time = new Date().toLocaleTimeString();
        console.log(`  [${time}] ⚙ Config changed: ${configFile}`);
        console.log(`           Full rebuild: ${rebuildStats.files} files, ${rebuildStats.edges} edges (${rebuildStats.durationMs}ms)\n`);
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

program
  .command("env")
  .description("Show environment variable usage across the project")
  .argument("[dir]", "Project root directory", ".")
  .action(async (dir: string) => {
    const rootDir = resolve(dir);
    console.log(`\n  Impulse — environment variable analysis\n`);

    const [{ graph }, envDefs] = await Promise.all([
      analyzeProject(rootDir),
      loadEnvFiles(rootDir),
    ]);

    const vars = analyzeEnv(graph, envDefs);

    if (vars.length === 0) {
      console.log("  No environment variables found.\n");
      return;
    }

    const undefined_ = vars.filter((v) => v.definedIn.length === 0 && v.usedBy.length > 0);
    const unused = vars.filter((v) => v.definedIn.length > 0 && v.usedBy.length === 0);
    const used = vars.filter((v) => v.definedIn.length > 0 && v.usedBy.length > 0);

    if (undefined_.length > 0) {
      console.log(`  ⚠ Used in code but NOT in any .env file (${undefined_.length}):\n`);
      for (const v of undefined_) {
        console.log(`    ${v.name}`);
        for (const f of v.usedBy) console.log(`      ← ${f}`);
      }
      console.log();
    }

    if (unused.length > 0) {
      console.log(`  ⚠ Defined in .env but NOT used in code (${unused.length}):\n`);
      for (const v of unused) {
        console.log(`    ${v.name}  (${v.definedIn.join(", ")})`);
      }
      console.log();
    }

    if (used.length > 0) {
      console.log(`  ✓ Defined and used (${used.length}):\n`);
      for (const v of used) {
        console.log(`    ${v.name}  (${v.definedIn.join(", ")}) → ${v.usedBy.length} file(s)`);
      }
      console.log();
    }

    console.log(`  Total: ${vars.length} env vars (${undefined_.length} undefined, ${unused.length} unused)\n`);
  });

program
  .command("explore")
  .description("Interactive graph explorer — navigate dependencies in the terminal")
  .argument("[dir]", "Project root directory", ".")
  .action(async (dir: string) => {
    const rootDir = resolve(dir);
    console.log(`\n  Impulse — indexing ${rootDir}...`);
    const { graph, stats } = await analyzeProject(rootDir);
    console.log(`  Ready: ${stats.filesScanned} files, ${stats.edgeCount} edges (${stats.durationMs}ms)`);
    startExplorer(graph);
  });

registerHealthCommand(program);
registerInitCommand(program);
registerCheckCommand(program);
registerDiffCommand(program);
registerHistoryCommand(program);
registerSuggestCommand(program);
registerHotspotsCommand(program);
registerExportsCommand(program);
registerTestCommand(program);
registerCouplingCommand(program);
registerFocusCommand(program);
registerDoctorCommand(program);
registerSafeDeleteCommand(program);
registerCompareCommand(program);
registerTreeCommand(program);
registerComplexityCommand(program);
registerRiskCommand(program);
registerRefactorCommand(program);
registerReviewCommand(program);

program
  .command("badge")
  .description("Generate an SVG health badge for your README")
  .argument("[dir]", "Project root directory", ".")
  .option("-o, --output <path>", "Write badge to file instead of stdout")
  .option("--style <style>", "Badge style: flat, flat-square", "flat")
  .option("--label <text>", "Badge label text", "impulse")
  .action(async (dir: string, opts: { output?: string; style: string; label: string }) => {
    const rootDir = resolve(dir);
    const [{ graph }, config] = await Promise.all([
      analyzeProject(rootDir),
      loadConfig(rootDir),
    ]);
    const health = analyzeHealth(graph, config.boundaries);
    const svg = generateBadgeSVG({
      score: health.score,
      grade: health.grade,
      style: opts.style as BadgeStyle,
      label: opts.label,
    });
    if (opts.output) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(resolve(opts.output), svg, "utf-8");
      console.log(`  Badge written to ${opts.output} (${health.score}/100 ${health.grade})`);
    } else {
      process.stdout.write(svg);
    }
  });

program
  .command("daemon")
  .description("Start the Impulse daemon with HTTP API")
  .argument("[dir]", "Project root directory", ".")
  .option("-p, --port <n>", "Port to listen on", "4096")
  .action(async (dir: string, opts: { port: string }) => {
    const rootDir = resolve(dir);
    const port = parseInt(opts.port, 10);
    await startDaemon(rootDir, port);
  });

program
  .command("visualize")
  .description("Start daemon and open interactive dependency graph in the browser")
  .argument("[dir]", "Project root directory", ".")
  .option("-p, --port <n>", "Port to listen on", "4096")
  .action(async (dir: string, opts: { port: string }) => {
    const rootDir = resolve(dir);
    const port = parseInt(opts.port, 10);
    const url = `http://localhost:${port}/visualize`;

    const { exec } = await import("node:child_process");
    startDaemon(rootDir, port).then(() => {});

    setTimeout(() => {
      const cmd = process.platform === "darwin" ? "open"
        : process.platform === "win32" ? "start" : "xdg-open";
      exec(`${cmd} ${url}`);
    }, 2000);
  });

program
  .command("ci")
  .description("Run CI analysis — preview what Impulse CI would report on a PR")
  .argument("[dir]", "Project root directory", ".")
  .option("--base <ref>", "Base branch ref for comparison", "origin/main")
  .option("--threshold <n>", "Minimum health score (fails if below)", "0")
  .action(async (dir: string, opts: { base: string; threshold: string }) => {
    process.env.IMPULSE_BASE_REF = opts.base;
    process.env.IMPULSE_THRESHOLD = opts.threshold;
    process.argv[2] = resolve(dir);
    await import("../ci/index.js");
  });

if (process.argv.length <= 2) {
  runDashboard().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  program.parse();
}
