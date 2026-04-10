import type { Command } from "commander";
import { resolve } from "node:path";
import { analyzeProject } from "../core/analyzer.js";
import { analyzeHealth } from "../core/health.js";
import { loadConfig } from "../core/config.js";
import { analyzeHotspots, type HotspotRisk } from "../core/hotspots.js";
import { analyzeCoupling } from "../core/coupling.js";
import { generateSuggestions } from "../core/suggest.js";
import { checkBoundaries } from "../core/boundaries.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Comprehensive project diagnostic — health, hotspots, dead exports, coupling, suggestions")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { json?: boolean }) => {
      const rootDir = resolve(dir);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const cyan = "\x1b[36m";
      const green = "\x1b[32m";
      const yellow = "\x1b[33m";
      const red = "\x1b[31m";

      if (!opts.json) process.stdout.write(`\n  ${dim}Running diagnostics...${reset}\r`);

      const [{ graph, stats }, config] = await Promise.all([
        analyzeProject(rootDir),
        loadConfig(rootDir),
      ]);

      const health = analyzeHealth(graph, config.boundaries);
      const hotspotReport = analyzeHotspots(graph, rootDir, 200);
      const couplingReport = analyzeCoupling(graph, rootDir, 300, 3, 0.3);
      const suggestReport = generateSuggestions(graph, health);

      const allEdges = graph.allEdges();
      const exportNodes = graph.allNodes().filter((n) => n.kind === "export");
      const deadExports: Array<{ file: string; name: string }> = [];
      for (const exp of exportNodes) {
        const users = allEdges.filter((e) => e.to === exp.id && e.kind === "uses_export");
        if (users.length === 0) {
          deadExports.push({ file: exp.filePath, name: exp.name });
        }
      }

      let boundaryReport = null;
      if (config.boundaries && Object.keys(config.boundaries).length > 0) {
        boundaryReport = checkBoundaries(graph, config.boundaries);
      }

      if (opts.json) {
        console.log(JSON.stringify({
          health: { score: health.score, grade: health.grade, summary: health.summary, penalties: health.penalties, cycles: health.cycles.length, godFiles: health.godFiles.length, orphans: health.orphans.length },
          hotspots: hotspotReport.hotspots.filter((h) => h.risk !== "low").slice(0, 10),
          deadExports: { count: deadExports.length, total: exportNodes.length, items: deadExports },
          coupling: { hidden: couplingReport.hidden.length, pairs: couplingReport.hidden.slice(0, 10) },
          suggestions: { count: suggestReport.suggestions.length, improvement: suggestReport.estimatedScoreImprovement, items: suggestReport.suggestions },
          boundaries: boundaryReport,
          files: stats.filesScanned,
          durationMs: stats.durationMs,
        }, null, 2));
        return;
      }

      process.stdout.write(`\r\x1b[K`);

      const langSet = new Set<string>();
      for (const node of graph.allNodes()) {
        if (node.kind !== "file") continue;
        const ext = node.filePath.slice(node.filePath.lastIndexOf("."));
        if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) langSet.add("TypeScript");
        else if (ext === ".py") langSet.add("Python");
        else if (ext === ".go") langSet.add("Go");
        else if (ext === ".rs") langSet.add("Rust");
        else if (ext === ".cs") langSet.add("C#");
        else if (ext === ".java") langSet.add("Java");
        else if (ext === ".kt") langSet.add("Kotlin");
      }
      const langs = [...langSet].join(" + ") || "unknown";

      const gradeColor = health.score >= 80 ? green : health.score >= 60 ? yellow : red;

      console.log(`  ${bold}I M P U L S E  —  Doctor${reset}`);
      console.log(`  ${stats.filesScanned} files ${dim}·${reset} ${langs} ${dim}·${reset} ${gradeColor}${health.score}/100 (${health.grade})${reset} ${dim}·${reset} ${stats.durationMs}ms\n`);

      // ── Health ──
      printSection("Health");
      console.log(`    Score: ${gradeColor}${health.score}/100 (${health.grade})${reset}`);
      console.log(`    ${health.summary}\n`);

      const p = health.penalties;
      const pLines: string[] = [];
      if (p.cycles > 0) pLines.push(`Cycles -${p.cycles}`);
      if (p.godFiles > 0) pLines.push(`God files -${p.godFiles}`);
      if (p.deepChains > 0) pLines.push(`Deep chains -${p.deepChains}`);
      if (p.orphans > 0) pLines.push(`Orphans -${p.orphans}`);
      if (p.hubConcentration > 0) pLines.push(`Hub conc. -${p.hubConcentration}`);
      if (p.stabilityViolations > 0) pLines.push(`SDP -${p.stabilityViolations}`);
      if (pLines.length > 0) {
        console.log(`    ${dim}Penalties: ${pLines.join(", ")}${reset}`);
      }

      // ── Hotspots ──
      const riskyHotspots = hotspotReport.hotspots.filter((h) => h.risk !== "low");
      printSection("Hotspots");
      if (riskyHotspots.length === 0) {
        console.log(`    ${green}No risky hotspots${reset}`);
      } else {
        const byRisk = (r: HotspotRisk) => riskyHotspots.filter((h) => h.risk === r).length;
        const parts: string[] = [];
        if (byRisk("critical") > 0) parts.push(`${red}${byRisk("critical")} critical${reset}`);
        if (byRisk("high") > 0) parts.push(`${yellow}${byRisk("high")} high${reset}`);
        if (byRisk("medium") > 0) parts.push(`${cyan}${byRisk("medium")} medium${reset}`);
        console.log(`    ${riskyHotspots.length} risky file(s): ${parts.join(", ")}\n`);

        const maxScore = riskyHotspots[0]?.score ?? 1;
        for (const h of riskyHotspots.slice(0, 5)) {
          const filled = Math.max(1, Math.round((h.score / maxScore) * 20));
          const bar = "█".repeat(filled) + "░".repeat(20 - filled);
          const riskColor = h.risk === "critical" ? red : h.risk === "high" ? yellow : cyan;
          console.log(`    ${riskColor}${bar}${reset}  ${bold}${h.file}${reset}`);
          console.log(`    ${dim}${h.changes} changes · ${h.affected} affected · ${riskColor}${h.risk.toUpperCase()}${reset}`);
        }
        if (riskyHotspots.length > 5) console.log(`    ${dim}...and ${riskyHotspots.length - 5} more${reset}`);
      }

      // ── Dead Exports ──
      printSection("Dead Exports");
      if (deadExports.length === 0) {
        console.log(`    ${green}No dead exports${reset}`);
      } else {
        const pct = exportNodes.length > 0 ? Math.round((deadExports.length / exportNodes.length) * 100) : 0;
        const byFile = new Map<string, string[]>();
        for (const d of deadExports) {
          if (!byFile.has(d.file)) byFile.set(d.file, []);
          byFile.get(d.file)!.push(d.name);
        }
        console.log(`    ${yellow}${deadExports.length}${reset} dead out of ${exportNodes.length} exports (${pct}%) across ${byFile.size} file(s)\n`);
        let shown = 0;
        for (const [file, names] of [...byFile.entries()].slice(0, 6)) {
          console.log(`    ${dim}${file}:${reset} ${names.join(", ")}`);
          shown++;
        }
        if (byFile.size > 6) console.log(`    ${dim}...and ${byFile.size - 6} more file(s)${reset}`);
      }

      // ── Hidden Coupling ──
      printSection("Hidden Coupling");
      if (couplingReport.hidden.length === 0) {
        console.log(`    ${green}No hidden coupling${reset}`);
      } else {
        console.log(`    ${yellow}${couplingReport.hidden.length}${reset} hidden pair(s) ${dim}(co-change without imports)${reset}\n`);
        for (const p of couplingReport.hidden.slice(0, 4)) {
          const pct = Math.round(p.couplingRatio * 100);
          console.log(`    ${red}${pct}%${reset}  ${p.fileA} ${dim}↔${reset} ${p.fileB}  ${dim}(${p.cochanges}×)${reset}`);
        }
        if (couplingReport.hidden.length > 4) console.log(`    ${dim}...and ${couplingReport.hidden.length - 4} more${reset}`);
      }

      // ── Suggestions ──
      printSection("Suggestions");
      if (suggestReport.suggestions.length === 0) {
        console.log(`    ${green}Architecture looks clean — no suggestions${reset}`);
      } else {
        const est = suggestReport.estimatedScoreImprovement;
        console.log(`    ${suggestReport.suggestions.length} suggestion(s)${est > 0 ? ` ${dim}(estimated ${green}+${est}${reset}${dim} score)${reset}` : ""}\n`);
        let idx = 1;
        for (const s of suggestReport.suggestions.slice(0, 5)) {
          if (s.kind === "split-god-file") {
            console.log(`    ${yellow}${idx}.${reset} Split: ${bold}${s.file}${reset} ${dim}(${s.dependents} dep → ${s.expectedMaxDependents} max)${reset}`);
          } else if (s.kind === "remove-dead-exports") {
            console.log(`    ${yellow}${idx}.${reset} Dead exports: ${bold}${s.file}${reset} ${dim}(${s.exports.join(", ")})${reset}`);
          } else if (s.kind === "break-cycle") {
            console.log(`    ${yellow}${idx}.${reset} Break cycle: ${bold}${s.cycle[0]}${reset} ${dim}↔${reset} ${bold}${s.cycle[1]}${reset}`);
          }
          idx++;
        }
        if (suggestReport.suggestions.length > 5) console.log(`    ${dim}...and ${suggestReport.suggestions.length - 5} more${reset}`);
      }

      // ── Boundaries ──
      printSection("Boundaries");
      if (!boundaryReport) {
        console.log(`    ${dim}No boundaries configured (run: impulse init .)${reset}`);
      } else {
        const violations = boundaryReport.violations?.length ?? 0;
        if (violations === 0) {
          const count = boundaryReport.boundaryStats?.length ?? 0;
          console.log(`    ${green}✓ All clean${reset} ${dim}(${count} boundaries configured)${reset}`);
        } else {
          console.log(`    ${red}${violations} violation(s)${reset}\n`);
          for (const v of (boundaryReport.violations ?? []).slice(0, 5)) {
            console.log(`    ${red}✗${reset} ${v.from} → ${v.to} ${dim}(${v.fromBoundary} cannot import ${v.toBoundary})${reset}`);
          }
        }
      }

      // ── Verdict ──
      console.log(`\n  ${"═".repeat(56)}\n`);

      const verdictLabel = health.score >= 90 ? `${green}EXCELLENT` :
        health.score >= 80 ? `${green}GOOD` :
        health.score >= 70 ? `${yellow}FAIR` :
        health.score >= 60 ? `${yellow}NEEDS WORK` :
        `${red}POOR`;

      console.log(`  ${bold}Verdict: ${verdictLabel}${reset} ${dim}(score ${health.score}/100)${reset}\n`);

      const actions: string[] = [];
      const criticalHotspots = riskyHotspots.filter((h) => h.risk === "critical");
      if (criticalHotspots.length > 0) {
        actions.push(`Fix ${criticalHotspots.length} critical hotspot(s): ${criticalHotspots.slice(0, 2).map((h) => h.file).join(", ")}`);
      }
      if (health.cycles.length > 0) {
        actions.push(`Break ${health.cycles.length} circular dependenc${health.cycles.length === 1 ? "y" : "ies"}`);
      }
      if (health.godFiles.length > 0) {
        actions.push(`Split ${health.godFiles.length} god file(s) to reduce coupling`);
      }
      if (deadExports.length > 0) {
        actions.push(`Remove ${deadExports.length} dead export(s)`);
      }
      if (couplingReport.hidden.length > 0) {
        actions.push(`Investigate ${couplingReport.hidden.length} hidden coupling pair(s)`);
      }

      if (actions.length === 0) {
        console.log(`  ${green}No priority actions — keep up the good work!${reset}`);
      } else {
        console.log(`  ${bold}Priority actions:${reset}`);
        const icons = ["⚡", "🔄", "🔧", "🧹", "🔗"];
        for (let i = 0; i < actions.length && i < 5; i++) {
          console.log(`    ${icons[i] || "→"} ${actions[i]}`);
        }
      }
      console.log();
    });
}

function printSection(name: string): void {
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const line = "─".repeat(54 - name.length);
  console.log(`\n  ── ${name} ${dim}${line}${reset}\n`);
}
