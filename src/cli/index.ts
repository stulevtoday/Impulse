#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject, getFileImpact, getParseWarnings, DependencyGraph } from "../core/index.js";
import { createWatcher } from "../watchers/fs-watcher.js";
import { startDaemon } from "../server/index.js";
import { loadEnvFiles, analyzeEnv } from "../core/env.js";
import { analyzeHealth } from "../core/health.js";
import { startExplorer } from "./explore.js";

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
  .description("Show what is affected by changing a file (or a specific export)")
  .argument("<file>", "Relative path to the changed file")
  .argument("[dir]", "Project root directory", ".")
  .option("-d, --depth <n>", "Maximum traversal depth", "5")
  .option("-s, --symbol <name>", "Specific export name (symbol-level precision)")
  .option("--json", "Output as JSON")
  .action(async (file: string, dir: string, opts: { depth: string; symbol?: string; json?: boolean }) => {
    const rootDir = resolve(dir);
    const maxDepth = parseInt(opts.depth, 10);

    const { graph, stats } = await analyzeProject(rootDir);

    if (opts.symbol) {
      const impact = graph.analyzeExportImpact(file, opts.symbol, maxDepth);
      const fileAffected = impact.affected.filter((a) => a.node.kind === "file");

      if (opts.json) {
        console.log(JSON.stringify({
          changed: file,
          symbol: opts.symbol,
          affected: fileAffected.map((a) => ({ file: a.node.filePath, depth: a.depth })),
          count: fileAffected.length,
          analysisMs: stats.durationMs,
        }, null, 2));
        return;
      }

      const allExports = graph.getFileExports(file);
      const fileImpact = getFileImpact(graph, file, maxDepth);
      const totalFileAffected = fileImpact.affected.filter((a) => a.node.kind === "file").length;

      console.log(`\n  Impulse — symbol-level impact\n`);
      console.log(`  File:    ${file}`);
      console.log(`  Symbol:  ${opts.symbol}`);

      if (fileAffected.length === 0) {
        console.log(`\n  No files depend on this export.\n`);
      } else {
        console.log(`\n  \x1b[36m${fileAffected.length}\x1b[0m file(s) affected (vs ${totalFileAffected} at file level — \x1b[32m${Math.round((1 - fileAffected.length / Math.max(totalFileAffected, 1)) * 100)}% more precise\x1b[0m)\n`);
        for (const item of fileAffected) {
          const depthLabel = item.depth === 1 ? "direct" : `depth ${item.depth}`;
          console.log(`    → ${item.node.filePath}  (${depthLabel})`);
        }
      }

      if (allExports.length > 1) {
        console.log(`\n  Other exports in ${file}:`);
        for (const exp of allExports) {
          if (exp.name === opts.symbol) continue;
          const symImpact = graph.analyzeExportImpact(file, exp.name, maxDepth);
          const symFiles = symImpact.affected.filter((a) => a.node.kind === "file").length;
          console.log(`    ${exp.name}  → ${symFiles} file(s)`);
        }
      }

      console.log(`\n  ${stats.durationMs}ms\n`);
      return;
    }

    const impact = getFileImpact(graph, file, maxDepth);

    if (opts.json) {
      console.log(JSON.stringify({
        changed: file,
        affected: impact.affected.map((a) => ({ file: a.node.filePath, depth: a.depth })),
        count: impact.affected.length,
        analysisMs: stats.durationMs,
      }, null, 2));
      return;
    }

    console.log(`\n  Impulse — analyzing impact of ${file}\n`);

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

    const exports = graph.getFileExports(file);
    if (exports.length > 0) {
      console.log(`\n  Tip: use --symbol <name> for precision. Exports in this file:`);
      for (const exp of exports) {
        const symImpact = graph.analyzeExportImpact(file, exp.name, maxDepth);
        const symFiles = symImpact.affected.filter((a) => a.node.kind === "file").length;
        console.log(`    ${exp.name}  → ${symFiles} file(s)`);
      }
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

program
  .command("health")
  .description("Analyze project architecture health — cycles, god files, coupling")
  .argument("[dir]", "Project root directory", ".")
  .option("--json", "Output as JSON")
  .action(async (dir: string, opts: { json?: boolean }) => {
    const rootDir = resolve(dir);
    const { graph, stats } = await analyzeProject(rootDir);
    const report = analyzeHealth(graph);

    if (opts.json) {
      console.log(JSON.stringify({ ...report, analysisMs: stats.durationMs, filesAnalyzed: stats.filesScanned }, null, 2));
      return;
    }

    console.log(`\n  Impulse — Architecture Health Report`);
    console.log(`  ${stats.filesScanned} files analyzed in ${stats.durationMs}ms\n`);

    const gradeColors: Record<string, string> = {
      A: "\x1b[32m", B: "\x1b[32m", C: "\x1b[33m", D: "\x1b[33m", F: "\x1b[31m",
    };
    const color = gradeColors[report.grade] ?? "";
    const reset = "\x1b[0m";
    const dim = "\x1b[2m";

    console.log(`  Score: ${color}${report.score}/100 (${report.grade})${reset}`);
    console.log(`  ${report.summary}\n`);

    const p = report.penalties;
    const penaltyLines: string[] = [];
    if (p.cycles > 0) penaltyLines.push(`    Cycles:            -${p.cycles}`);
    if (p.godFiles > 0) penaltyLines.push(`    God files:         -${p.godFiles}`);
    if (p.deepChains > 0) penaltyLines.push(`    Deep chains:       -${p.deepChains}`);
    if (p.orphans > 0) penaltyLines.push(`    Orphans:           -${p.orphans}`);
    if (p.hubConcentration > 0) penaltyLines.push(`    Hub concentration: -${p.hubConcentration}`);
    if (penaltyLines.length > 0) {
      console.log("  Penalties:");
      for (const line of penaltyLines) console.log(line);
      console.log();
    }

    console.log("  Stats:");
    console.log(`    Files:             ${report.stats.totalFiles}`);
    console.log(`    Local edges:       ${report.stats.localEdges}`);
    console.log(`    External edges:    ${report.stats.externalEdges}`);
    console.log(`    Avg imports:       ${report.stats.avgImports}`);
    console.log(`    Avg imported by:   ${report.stats.avgImportedBy}`);
    console.log(`    Max imports:       ${report.stats.maxImports}`);
    console.log(`    Max imported by:   ${report.stats.maxImportedBy}`);

    if (report.cycles.length > 0) {
      console.log(`\n  ⚠ Circular Dependencies (${report.cycles.length}):\n`);
      for (const cycle of report.cycles.slice(0, 10)) {
        const display = cycle.severity === "tight-couple"
          ? `${cycle.cycle[0]} ↔ ${cycle.cycle[1]}`
          : cycle.cycle.join(" → ");
        console.log(`    ${display}  ${dim}(${cycle.severity})${reset}`);
      }
      if (report.cycles.length > 10) {
        console.log(`    ...and ${report.cycles.length - 10} more`);
      }
    }

    if (report.godFiles.length > 0) {
      console.log(`\n  ⚠ God Files (high coupling):\n`);
      for (const gf of report.godFiles) {
        const bar = "█".repeat(Math.min(gf.totalConnections, 40));
        console.log(`    ${gf.file}`);
        console.log(`      ${gf.importedBy} dependents, ${gf.imports} imports  ${bar}`);
      }
    }

    if (report.deepestChains.length > 0) {
      console.log(`\n  Deepest dependency chains:\n`);
      for (const dc of report.deepestChains.slice(0, 5)) {
        console.log(`    Depth ${dc.maxDepth}: ${dc.chain.join(" → ")}`);
      }
    }

    if (report.orphans.length > 0) {
      console.log(`\n  Isolated files (no local imports or dependents): ${report.orphans.length}\n`);
      for (const o of report.orphans) {
        console.log(`    ${o}`);
      }
    }

    console.log();
  });

program
  .command("diff")
  .description("Show impact of your uncommitted changes (git integration)")
  .argument("[dir]", "Project root directory", ".")
  .option("--staged", "Only analyze staged changes")
  .option("--json", "Output as JSON")
  .action(async (dir: string, opts: { staged?: boolean; json?: boolean }) => {
    const rootDir = resolve(dir);
    const { execSync } = await import("node:child_process");

    let changedFiles: string[];
    try {
      const cmd = opts.staged ? "git diff --cached --name-only" : "git diff --name-only HEAD";
      const raw = execSync(cmd, { cwd: rootDir, encoding: "utf-8" }).trim();
      changedFiles = raw ? raw.split("\n").filter((f) => f.length > 0) : [];
    } catch {
      if (!opts.json) console.log("\n  Not a git repository or no commits yet.\n");
      return;
    }

    if (changedFiles.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify({ changed: [], affected: [], count: 0 }));
      } else {
        console.log("\n  No uncommitted changes.\n");
      }
      return;
    }

    const { graph, stats } = await analyzeProject(rootDir);

    const allAffected = new Map<string, { depth: number; via: string }>();
    const changedSet = new Set(changedFiles);

    for (const file of changedFiles) {
      const impact = getFileImpact(graph, file);
      for (const item of impact.affected) {
        if (changedSet.has(item.node.filePath)) continue;
        const existing = allAffected.get(item.node.filePath);
        if (!existing || item.depth < existing.depth) {
          allAffected.set(item.node.filePath, { depth: item.depth, via: file });
        }
      }
    }

    const sorted = [...allAffected.entries()].sort((a, b) => a[1].depth - b[1].depth);

    if (opts.json) {
      console.log(JSON.stringify({
        changed: changedFiles,
        affected: sorted.map(([file, info]) => ({ file, depth: info.depth, via: info.via })),
        count: sorted.length,
        analysisMs: stats.durationMs,
      }, null, 2));
      return;
    }

    console.log(`\n  Impulse — impact of your changes (${stats.durationMs}ms)\n`);
    console.log(`  Changed files (${changedFiles.length}):`);
    for (const f of changedFiles) {
      console.log(`    \x1b[33m●\x1b[0m ${f}`);
    }

    if (sorted.length === 0) {
      console.log("\n  \x1b[32m✓ No other files affected by your changes.\x1b[0m\n");
    } else {
      console.log(`\n  Affected files (${sorted.length}):\n`);
      for (const [file, info] of sorted.slice(0, 30)) {
        const depth = info.depth === 1 ? "direct" : `depth ${info.depth}`;
        console.log(`    \x1b[31m→\x1b[0m ${file}  (${depth}, via ${info.via})`);
      }
      if (sorted.length > 30) console.log(`    ...+${sorted.length - 30} more`);
      console.log();
    }
  });

program
  .command("exports")
  .description("Show exports per file — who uses each, and which are dead")
  .argument("[dir]", "Project root directory", ".")
  .option("-f, --file <path>", "Show exports for a specific file only")
  .action(async (dir: string, opts: { file?: string }) => {
    const rootDir = resolve(dir);
    const { graph, stats } = await analyzeProject(rootDir);

    const exportNodes = graph.allNodes().filter((n) => n.kind === "export");
    const allEdges = graph.allEdges();

    const barrelFiles = new Set<string>();
    for (const fileNode of graph.allNodes().filter((n) => n.kind === "file")) {
      const deps = graph.getDependencies(fileNode.id).filter((e) => e.kind === "imports");
      if (deps.length > 0 && deps.every((e) => (e.metadata as Record<string, unknown>)?.reexport === true)) {
        barrelFiles.add(fileNode.filePath);
      }
    }

    const exportsByFile = new Map<string, Array<{ name: string; users: string[]; barrel: boolean }>>();
    for (const exp of exportNodes) {
      const users = allEdges
        .filter((e) => e.to === exp.id && e.kind === "uses_export")
        .map((e) => e.from.replace(/^file:/, ""));

      const list = exportsByFile.get(exp.filePath) ?? [];
      list.push({ name: exp.name, users, barrel: barrelFiles.has(exp.filePath) });
      exportsByFile.set(exp.filePath, list);
    }

    const files = opts.file
      ? [[opts.file, exportsByFile.get(opts.file) ?? []] as const]
      : [...exportsByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    let totalExports = 0;
    let deadExports = 0;
    let barrelExports = 0;

    console.log(`\n  Impulse — Export Analysis (${stats.filesScanned} files, ${stats.durationMs}ms)\n`);

    for (const [file, exports] of files) {
      if (exports.length === 0) continue;
      const isBarrel = barrelFiles.has(file);
      const dead = exports.filter((e) => e.users.length === 0 && !e.barrel);
      const barrelUnused = exports.filter((e) => e.users.length === 0 && e.barrel);
      totalExports += exports.length;
      deadExports += dead.length;
      barrelExports += barrelUnused.length;

      const label = isBarrel ? " \x1b[2m[barrel]\x1b[0m" : "";
      const deadLabel = dead.length > 0 ? `, \x1b[31m${dead.length} dead\x1b[0m` : "";
      console.log(`  ${file}${label}  (${exports.length} exports${deadLabel})`);

      for (const exp of exports.sort((a, b) => b.users.length - a.users.length)) {
        if (exp.users.length > 0) {
          console.log(`    \x1b[32m✓\x1b[0m ${exp.name}  — ${exp.users.length} user(s)`);
          for (const user of exp.users.slice(0, 5)) {
            console.log(`        ← ${user}`);
          }
          if (exp.users.length > 5) console.log(`        ...+${exp.users.length - 5} more`);
        } else if (exp.barrel) {
          console.log(`    \x1b[2m↗ ${exp.name}  — re-export (public API)\x1b[0m`);
        } else {
          console.log(`    \x1b[31m✗\x1b[0m ${exp.name}  — unused`);
        }
      }
      console.log();
    }

    const realDead = deadExports;
    console.log(`  Total: ${totalExports} exports, ${realDead} dead, ${barrelExports} barrel re-exports`);
    console.log(`  Dead export rate: ${totalExports > 0 ? Math.round(realDead / (totalExports - barrelExports) * 100) : 0}% (excluding barrels)\n`);
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

program.parse();
