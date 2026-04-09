import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject, loadConfig, checkBoundaries } from "../core/index.js";

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Validate architecture boundaries defined in .impulserc.json")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .option("--init", "Create a starter .impulserc.json")
    .action(async (dir: string, opts: { json?: boolean; init?: boolean }) => {
      const rootDir = resolve(dir);

      if (opts.init) {
        const { writeFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const starter = JSON.stringify({
          boundaries: {
            core: { path: "src/core/**", allow: [] },
            cli: { path: "src/cli/**", allow: ["core"] },
            server: { path: "src/server/**", allow: ["core"] },
          },
          thresholds: { health: 70 },
        }, null, 2) + "\n";
        await writeFile(join(rootDir, ".impulserc.json"), starter);
        console.log("\n  Created .impulserc.json with starter boundaries.\n");
        return;
      }

      const config = await loadConfig(rootDir);

      if (!config.boundaries || Object.keys(config.boundaries).length === 0) {
        console.log("\n  No boundaries defined. Create .impulserc.json:");
        console.log("    impulse check . --init\n");
        return;
      }

      const { graph, stats } = await analyzeProject(rootDir);
      const report = checkBoundaries(graph, config.boundaries);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const red = "\x1b[31m";
      const green = "\x1b[32m";
      const cyan = "\x1b[36m";
      const yellow = "\x1b[33m";

      console.log(`\n  ${cyan}Impulse — Boundary Check${reset}`);
      console.log(`  ${stats.filesScanned} files analyzed in ${stats.durationMs}ms\n`);

      console.log("  Boundaries:");
      for (const bs of report.boundaryStats) {
        const status = bs.violations > 0
          ? `${red}${bs.violations} violation(s)${reset}`
          : `${green}clean${reset}`;
        console.log(`    ${bs.name}  ${dim}(${bs.path})${reset}  ${bs.files} files  ${status}`);
        console.log(`      ${dim}${bs.internalEdges} internal, ${bs.externalEdges} cross-boundary imports${reset}`);
      }

      if (report.unassigned.length > 0) {
        console.log(`\n  ${yellow}Unassigned files (${report.unassigned.length}):${reset}`);
        for (const f of report.unassigned.slice(0, 10)) {
          console.log(`    ${dim}${f}${reset}`);
        }
        if (report.unassigned.length > 10) {
          console.log(`    ${dim}...and ${report.unassigned.length - 10} more${reset}`);
        }
      }

      if (report.violations.length > 0) {
        console.log(`\n  ${red}✗ ${report.violations.length} violation(s):${reset}\n`);
        for (const v of report.violations) {
          console.log(`    ${v.from}  →  ${v.to}`);
          console.log(`      ${dim}${v.fromBoundary} cannot import from ${v.toBoundary}${reset}`);
        }
        console.log();
        process.exitCode = 1;
      } else {
        console.log(`\n  ${green}✓ All boundaries respected.${reset}\n`);
      }
    });
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Auto-detect project structure and create .impulserc.json")
    .argument("[dir]", "Project root directory", ".")
    .action(async (dir: string) => {
      const rootDir = resolve(dir);
      const { writeFile, access } = await import("node:fs/promises");
      const { join } = await import("node:path");

      const configPath = join(rootDir, ".impulserc.json");
      try {
        await access(configPath);
        console.log("\n  .impulserc.json already exists. Delete it first to re-init.\n");
        return;
      } catch {}

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const cyan = "\x1b[36m";
      const green = "\x1b[32m";
      const bold = "\x1b[1m";

      process.stdout.write(`\n  ${dim}Scanning project...${reset}`);
      const { graph, stats } = await analyzeProject(rootDir);
      process.stdout.write(`\r\x1b[K`);

      console.log(`  ${bold}Impulse Init${reset}  ${dim}(${stats.filesScanned} files found)${reset}\n`);

      const fileNodes = graph.allNodes().filter((n) => n.kind === "file");
      const dirCounts = new Map<string, number>();

      for (const node of fileNodes) {
        const lastSlash = node.filePath.lastIndexOf("/");
        if (lastSlash <= 0) continue;
        const dirPath = node.filePath.slice(0, lastSlash);
        const parts = dirPath.split("/");
        const groupDir = parts.length >= 2 ? parts.slice(0, 2).join("/") : parts[0];
        dirCounts.set(groupDir, (dirCounts.get(groupDir) ?? 0) + 1);
      }

      const significantDirs = [...dirCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1]);

      if (significantDirs.length === 0) {
        console.log("  No clear directory structure detected.");
        console.log("  Create .impulserc.json manually.\n");
        return;
      }

      const boundaries: Record<string, { path: string; allow: string[] }> = {};
      const dirToName = new Map<string, string>();

      for (const [dirPath] of significantDirs) {
        const name = dirPath.split("/").pop()!
          .replace(/[^a-zA-Z0-9-]/g, "-")
          .toLowerCase();
        dirToName.set(dirPath, name);
        boundaries[name] = { path: `${dirPath}/**`, allow: [] };
      }

      const edges = graph.allEdges().filter(
        (e) => e.kind === "imports" && !e.to.startsWith("external:"),
      );

      const allowSets = new Map<string, Set<string>>();
      for (const [, name] of dirToName) allowSets.set(name, new Set());

      for (const edge of edges) {
        const fromPath = edge.from.replace("file:", "");
        const toPath = edge.to.replace("file:", "");

        let fromBoundary: string | undefined;
        let toBoundary: string | undefined;

        for (const [dirPath, name] of dirToName) {
          if (fromPath.startsWith(dirPath + "/") || fromPath.startsWith(dirPath)) fromBoundary = name;
          if (toPath.startsWith(dirPath + "/") || toPath.startsWith(dirPath)) toBoundary = name;
        }

        if (fromBoundary && toBoundary && fromBoundary !== toBoundary) {
          allowSets.get(fromBoundary)!.add(toBoundary);
        }
      }

      for (const [name, allowed] of allowSets) {
        boundaries[name].allow = [...allowed].sort();
      }

      const config = { boundaries, thresholds: { health: 70 } };
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

      console.log(`  Detected ${significantDirs.length} boundaries:\n`);
      for (const [name, rule] of Object.entries(boundaries)) {
        const deps = rule.allow.length > 0
          ? `${dim}→ ${rule.allow.join(", ")}${reset}`
          : `${green}(no cross-boundary deps)${reset}`;
        console.log(`    ${cyan}${name}${reset}  ${dim}${rule.path}${reset}  ${deps}`);
      }

      console.log(`\n  ${green}Created .impulserc.json${reset}`);
      console.log(`  ${dim}Run${reset} ${bold}impulse check .${reset} ${dim}to validate boundaries${reset}\n`);
    });
}
