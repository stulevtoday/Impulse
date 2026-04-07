import * as readline from "node:readline";
import type { DependencyGraph, GraphNode } from "../core/graph.js";

export function startExplorer(graph: DependencyGraph): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n  Impulse Explorer — interactive dependency graph\n");
  console.log("  Commands:");
  console.log("    file <path>     Select a file and show its connections");
  console.log("    impact <path>   Show what breaks if this file changes");
  console.log("    top [n]         Show top N most-connected files");
  console.log("    orphans         Show files with no dependents");
  console.log("    hubs            Show files that are imported by 5+ others");
  console.log("    search <term>   Search files by name");
  console.log("    stats           Show graph statistics");
  console.log("    quit            Exit\n");

  const prompt = () => rl.question("  impulse> ", (input) => handleInput(input.trim()));

  const handleInput = (input: string) => {
    if (!input) { prompt(); return; }

    const [cmd, ...args] = input.split(/\s+/);
    const arg = args.join(" ");

    switch (cmd) {
      case "file":
      case "f":
        showFile(graph, arg);
        break;
      case "impact":
      case "i":
        showImpact(graph, arg);
        break;
      case "top":
      case "t":
        showTop(graph, parseInt(arg || "15", 10));
        break;
      case "orphans":
      case "o":
        showOrphans(graph);
        break;
      case "hubs":
      case "h":
        showHubs(graph);
        break;
      case "search":
      case "s":
        searchFiles(graph, arg);
        break;
      case "stats":
        showStats(graph);
        break;
      case "quit":
      case "q":
      case "exit":
        console.log("\n  Bye.\n");
        rl.close();
        process.exit(0);
      default:
        console.log(`  Unknown command: ${cmd}\n`);
    }

    prompt();
  };

  prompt();
}

function showFile(graph: DependencyGraph, path: string): void {
  if (!path) { console.log("  Usage: file <path>\n"); return; }

  const match = findFile(graph, path);
  if (!match) { console.log(`  File not found: ${path}\n`); return; }

  const fileId = `file:${match.filePath}`;
  const deps = graph.getDependencies(fileId);
  const dependents = graph.getDependents(fileId);

  const localDeps = deps.filter((e) => !e.to.startsWith("external:"));
  const extDeps = deps.filter((e) => e.to.startsWith("external:"));
  const importedBy = dependents.filter((e) => e.kind === "imports");

  console.log(`\n  ${match.filePath}`);
  console.log("  " + "─".repeat(60));

  if (localDeps.length > 0) {
    console.log(`\n  Imports (${localDeps.length} local):`);
    for (const d of localDeps) {
      console.log(`    → ${d.to.replace(/^file:/, "")}`);
    }
  }

  if (extDeps.length > 0) {
    console.log(`\n  External (${extDeps.length}):`);
    for (const d of extDeps) {
      console.log(`    → ${d.to.replace(/^external:/, "")}  [ext]`);
    }
  }

  if (importedBy.length > 0) {
    console.log(`\n  Imported by (${importedBy.length}):`);
    for (const d of importedBy) {
      console.log(`    ← ${d.from.replace(/^file:/, "")}`);
    }
  } else {
    console.log("\n  Not imported by anyone (leaf or entry point)");
  }

  console.log();
}

function showImpact(graph: DependencyGraph, path: string): void {
  if (!path) { console.log("  Usage: impact <path>\n"); return; }

  const match = findFile(graph, path);
  if (!match) { console.log(`  File not found: ${path}\n`); return; }

  const result = graph.analyzeFileImpact(match.filePath);

  if (result.affected.length === 0) {
    console.log(`\n  ${match.filePath}: no dependents affected.\n`);
    return;
  }

  console.log(`\n  Impact of changing ${match.filePath}:`);
  console.log(`  ${result.affected.length} file(s) affected:\n`);

  for (const item of result.affected) {
    const indent = "  ".repeat(item.depth);
    const depth = item.depth === 1 ? "direct" : `depth ${item.depth}`;
    console.log(`  ${indent}→ ${item.node.filePath}  (${depth})`);
  }
  console.log();
}

function showTop(graph: DependencyGraph, n: number): void {
  const files = graph.allNodes()
    .filter((nd) => nd.kind === "file")
    .map((nd) => {
      const deps = graph.getDependencies(nd.id);
      const dependents = graph.getDependents(nd.id);
      return {
        file: nd.filePath,
        imports: deps.filter((e) => e.kind === "imports" && !e.to.startsWith("external:")).length,
        importedBy: dependents.filter((e) => e.kind === "imports").length,
        score: deps.length + dependents.length,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

  console.log(`\n  Top ${n} most-connected files:\n`);
  console.log("  %-55s  %s  %s", "File", "In", "Out");
  console.log("  " + "─".repeat(70));

  for (const f of files) {
    const bar = "█".repeat(Math.min(f.importedBy, 30));
    console.log(`  ${f.file.padEnd(55)}  ${String(f.importedBy).padStart(3)}  ${String(f.imports).padStart(3)}  ${bar}`);
  }
  console.log();
}

function showOrphans(graph: DependencyGraph): void {
  const orphans = graph.allNodes()
    .filter((n) => n.kind === "file" && !n.filePath.includes("node_modules"))
    .filter((n) => {
      const dependents = graph.getDependents(n.id);
      return dependents.length === 0;
    })
    .map((n) => n.filePath)
    .sort();

  console.log(`\n  Orphan files (not imported by anyone): ${orphans.length}\n`);
  for (const f of orphans) {
    console.log(`    ${f}`);
  }
  console.log();
}

function showHubs(graph: DependencyGraph): void {
  const hubs = graph.allNodes()
    .filter((n) => n.kind === "file")
    .map((n) => ({
      file: n.filePath,
      importedBy: graph.getDependents(n.id).filter((e) => e.kind === "imports").length,
    }))
    .filter((h) => h.importedBy >= 5)
    .sort((a, b) => b.importedBy - a.importedBy);

  console.log(`\n  Hub files (imported by 5+ files): ${hubs.length}\n`);
  for (const h of hubs) {
    const bar = "█".repeat(Math.min(h.importedBy, 40));
    console.log(`  ${String(h.importedBy).padStart(3)} ← ${h.file}  ${bar}`);
  }
  console.log();
}

function searchFiles(graph: DependencyGraph, term: string): void {
  if (!term) { console.log("  Usage: search <term>\n"); return; }

  const lower = term.toLowerCase();
  const matches = graph.allNodes()
    .filter((n) => n.kind === "file" && n.filePath.toLowerCase().includes(lower))
    .map((n) => n.filePath)
    .sort();

  console.log(`\n  Files matching "${term}": ${matches.length}\n`);
  for (const f of matches) {
    console.log(`    ${f}`);
  }
  console.log();
}

function showStats(graph: DependencyGraph): void {
  const nodes = graph.allNodes();
  const edges = graph.allEdges();

  const files = nodes.filter((n) => n.kind === "file");
  const symbols = nodes.filter((n) => n.kind === "symbol");
  const envVars = nodes.filter((n) => n.kind === "env_var");
  const localEdges = edges.filter((e) => !e.to.startsWith("external:"));
  const extEdges = edges.filter((e) => e.to.startsWith("external:"));

  console.log("\n  Graph statistics:");
  console.log("  " + "─".repeat(40));
  console.log(`  Files:            ${files.length}`);
  console.log(`  Symbols:          ${symbols.length}`);
  console.log(`  Env variables:    ${envVars.length}`);
  console.log(`  Total nodes:      ${nodes.length}`);
  console.log(`  Local edges:      ${localEdges.length}`);
  console.log(`  External edges:   ${extEdges.length}`);
  console.log(`  Total edges:      ${edges.length}`);

  const avgDeps = files.length > 0
    ? (localEdges.length / files.length).toFixed(1)
    : "0";
  console.log(`  Avg local deps:   ${avgDeps}`);
  console.log();
}

function findFile(graph: DependencyGraph, query: string): GraphNode | null {
  const lower = query.toLowerCase();

  const exact = graph.allNodes().find(
    (n) => n.kind === "file" && n.filePath === query,
  );
  if (exact) return exact;

  const endsWith = graph.allNodes().find(
    (n) => n.kind === "file" && n.filePath.toLowerCase().endsWith(lower),
  );
  if (endsWith) return endsWith;

  const includes = graph.allNodes().find(
    (n) => n.kind === "file" && n.filePath.toLowerCase().includes(lower),
  );
  return includes ?? null;
}
