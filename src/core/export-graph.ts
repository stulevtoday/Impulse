import type { DependencyGraph } from "./graph.js";

export type ExportFormat = "mermaid" | "dot" | "json";

function sanitizeMermaidId(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9]/g, "_");
}

function mermaidLabel(filePath: string): string {
  return filePath.replace(/"/g, "'");
}

export function exportGraph(
  graph: DependencyGraph,
  format: ExportFormat,
  localOnly: boolean = true,
): string {
  const fileNodes = graph.allNodes().filter((n) => n.kind === "file" && !n.id.startsWith("external:"));
  const fileIds = new Set(fileNodes.map((n) => n.id));
  let edges = graph.allEdges().filter((e) => e.kind === "imports");
  if (localOnly) {
    edges = edges.filter((e) => fileIds.has(e.from) && fileIds.has(e.to));
  }

  switch (format) {
    case "mermaid":
      return exportMermaid(fileNodes, edges);
    case "dot":
      return exportDot(fileNodes, edges, localOnly);
    case "json":
      return exportJSON(fileNodes, edges);
  }
}

function exportMermaid(
  nodes: Array<{ id: string; filePath: string }>,
  edges: Array<{ from: string; to: string }>,
): string {
  const lines: string[] = ["graph TD"];

  const dirColors = new Map<string, string>();
  const palette = [":::blue", ":::red", ":::green", ":::orange", ":::purple"];
  let ci = 0;

  for (const node of nodes) {
    const id = sanitizeMermaidId(node.filePath);
    const label = mermaidLabel(node.filePath);
    lines.push(`  ${id}["${label}"]`);
  }

  lines.push("");

  for (const edge of edges) {
    const from = edge.from.replace(/^file:/, "");
    const to = edge.to.replace(/^(file:|external:)/, "");
    lines.push(`  ${sanitizeMermaidId(from)} --> ${sanitizeMermaidId(to)}`);
  }

  return lines.join("\n");
}

function exportDot(
  nodes: Array<{ id: string; filePath: string }>,
  edges: Array<{ from: string; to: string }>,
  localOnly: boolean,
): string {
  const lines: string[] = [
    "digraph impulse {",
    '  rankdir=LR;',
    '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10, fillcolor="#1e2133", fontcolor="#eaecf3", color="#252838"];',
    '  edge [color="#4a5878", arrowsize=0.6];',
    '  bgcolor="#0b0d14";',
    "",
  ];

  const dirs = new Map<string, string[]>();
  for (const node of nodes) {
    const parts = node.filePath.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(node.filePath);
  }

  for (const [dir, files] of dirs) {
    lines.push(`  subgraph "cluster_${dir.replace(/[^a-zA-Z0-9]/g, "_")}" {`);
    lines.push(`    label="${dir}";`);
    lines.push('    style="rounded"; color="#363a50"; fontcolor="#626780"; fontsize=9;');
    for (const f of files) {
      lines.push(`    "${f}";`);
    }
    lines.push("  }");
  }

  lines.push("");

  for (const edge of edges) {
    const from = edge.from.replace(/^file:/, "");
    const to = edge.to.replace(/^(file:|external:)/, "");
    lines.push(`  "${from}" -> "${to}";`);
  }

  lines.push("}");
  return lines.join("\n");
}

function exportJSON(
  nodes: Array<{ id: string; filePath: string }>,
  edges: Array<{ from: string; to: string }>,
): string {
  return JSON.stringify({
    nodes: nodes.map((n) => ({ id: n.id, file: n.filePath })),
    edges: edges.map((e) => ({
      from: e.from.replace(/^file:/, ""),
      to: e.to.replace(/^(file:|external:)/, ""),
    })),
  }, null, 2);
}
