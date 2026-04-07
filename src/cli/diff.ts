import type { Command } from "commander";
import { resolve } from "node:path";
import type Parser from "tree-sitter";
import { analyzeProject, getFileImpact } from "../core/index.js";
import { parseFile } from "../core/parser.js";

interface LineRange {
  start: number;
  end: number;
}

interface ExportRange {
  name: string;
  startLine: number;
  endLine: number;
}

async function getChangedLineRanges(
  rootDir: string,
  files: string[],
  staged: boolean,
): Promise<Map<string, LineRange[]>> {
  const { execSync } = await import("node:child_process");
  const result = new Map<string, LineRange[]>();
  for (const file of files) {
    try {
      const cmd = staged
        ? `git diff --cached --unified=0 -- "${file}"`
        : `git diff --unified=0 HEAD -- "${file}"`;
      const raw = execSync(cmd, { cwd: rootDir, encoding: "utf-8", stdio: "pipe" }) as string;
      const ranges: LineRange[] = [];
      for (const line of raw.split("\n")) {
        const match = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
        if (match) {
          const start = parseInt(match[1], 10);
          const count = match[2] ? parseInt(match[2], 10) : 1;
          if (count > 0) {
            ranges.push({ start, end: start + count - 1 });
          }
        }
      }
      if (ranges.length > 0) result.set(file, ranges);
    } catch {
      continue;
    }
  }
  return result;
}

function findExportRanges(rootNode: Parser.SyntaxNode): ExportRange[] {
  const ranges: ExportRange[] = [];

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === "export_statement") {
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;

      const declaration = node.children.find((c) =>
        ["function_declaration", "class_declaration", "lexical_declaration",
         "variable_declaration", "interface_declaration", "type_alias_declaration",
        ].includes(c.type),
      );

      if (declaration) {
        const nameNode = declaration.children.find(
          (c) => c.type === "identifier" || c.type === "type_identifier",
        );
        if (nameNode) {
          ranges.push({ name: nameNode.text, startLine, endLine });
        }
      }
      return;
    }

    for (const child of node.children) walk(child);
  }

  walk(rootNode);
  return ranges;
}

function detectChangedExports(exports: ExportRange[], changedLines: LineRange[]): string[] {
  const changed = new Set<string>();
  for (const exp of exports) {
    for (const range of changedLines) {
      if (range.start <= exp.endLine && range.end >= exp.startLine) {
        changed.add(exp.name);
        break;
      }
    }
  }
  return [...changed];
}

export function registerDiffCommand(program: Command): void {
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
      const changedSet = new Set(changedFiles);

      const changedLineRanges = await getChangedLineRanges(rootDir, changedFiles, opts.staged ?? false);

      const symbolResults: Array<{
        file: string;
        changedExports: string[];
        symbolAffected: number;
        fileAffected: number;
      }> = [];

      const allAffected = new Map<string, { depth: number; via: string }>();

      for (const file of changedFiles) {
        const fileImpact = getFileImpact(graph, file);
        for (const item of fileImpact.affected) {
          if (changedSet.has(item.node.filePath)) continue;
          const existing = allAffected.get(item.node.filePath);
          if (!existing || item.depth < existing.depth) {
            allAffected.set(item.node.filePath, { depth: item.depth, via: file });
          }
        }

        const exports = graph.getFileExports(file);
        if (exports.length === 0) continue;

        const ranges = changedLineRanges.get(file);
        if (!ranges) continue;

        const parsed = await parseFile(rootDir, file);
        if (!parsed) continue;

        const exportRanges = findExportRanges(parsed.tree.rootNode);
        const changedExports = detectChangedExports(exportRanges, ranges);

        if (changedExports.length > 0 && changedExports.length < exports.length) {
          const { merged } = graph.analyzeExportsImpact(file, changedExports);
          const symFiles = merged.affected.filter(
            (a) => a.node.kind === "file" && !changedSet.has(a.node.filePath),
          ).length;
          const allFiles = fileImpact.affected.filter(
            (a) => a.node.kind === "file" && !changedSet.has(a.node.filePath),
          ).length;

          symbolResults.push({
            file,
            changedExports,
            symbolAffected: symFiles,
            fileAffected: allFiles,
          });
        }
      }

      const sorted = [...allAffected.entries()].sort((a, b) => a[1].depth - b[1].depth);

      if (opts.json) {
        console.log(JSON.stringify({
          changed: changedFiles,
          affected: sorted.map(([file, info]) => ({ file, depth: info.depth, via: info.via })),
          count: sorted.length,
          symbolAnalysis: symbolResults,
          analysisMs: stats.durationMs,
        }, null, 2));
        return;
      }

      console.log(`\n  Impulse — impact of your changes (${stats.durationMs}ms)\n`);
      console.log(`  Changed files (${changedFiles.length}):`);
      for (const f of changedFiles) {
        const sym = symbolResults.find((s) => s.file === f);
        if (sym) {
          console.log(`    \x1b[33m●\x1b[0m ${f}  \x1b[2m(changed: ${sym.changedExports.join(", ")})\x1b[0m`);
        } else {
          console.log(`    \x1b[33m●\x1b[0m ${f}`);
        }
      }

      if (symbolResults.length > 0) {
        console.log(`\n  \x1b[36m🔬 Symbol-level precision:\x1b[0m\n`);
        for (const sym of symbolResults) {
          const pct = Math.round((1 - sym.symbolAffected / Math.max(sym.fileAffected, 1)) * 100);
          console.log(`    ${sym.file}`);
          console.log(`      changed: ${sym.changedExports.map((e) => `\x1b[33m${e}\x1b[0m`).join(", ")}`);
          console.log(`      \x1b[36m${sym.symbolAffected}\x1b[0m file(s) affected (vs ${sym.fileAffected} at file level — \x1b[32m${pct}% more precise\x1b[0m)`);
        }
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
}
