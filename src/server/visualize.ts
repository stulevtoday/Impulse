export function getVisualizationHTML(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Impulse — Dependency Graph</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0a12; color: #c8c8d0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; overflow: hidden; }
svg { width: 100vw; height: 100vh; display: block; }

#controls {
  position: absolute; top: 16px; left: 16px; z-index: 10;
  display: flex; flex-direction: column; gap: 8px;
}
#search {
  background: #14141f; border: 1px solid #2a2a3a; color: #e0e0e8;
  padding: 10px 14px; border-radius: 8px; width: 280px; font-size: 14px;
  outline: none; transition: border-color 0.2s;
}
#search:focus { border-color: #5b7fff; }
#search::placeholder { color: #555; }

#health-badge {
  position: absolute; top: 16px; right: 16px; z-index: 10;
  background: #14141f; border: 1px solid #2a2a3a; border-radius: 10px;
  padding: 12px 18px; text-align: center; min-width: 100px;
}
#health-grade { font-size: 28px; font-weight: 700; line-height: 1; }
#health-score { font-size: 12px; color: #888; margin-top: 4px; }
#health-summary { font-size: 11px; color: #666; margin-top: 4px; max-width: 220px; }

#info {
  position: absolute; bottom: 16px; left: 16px; z-index: 10;
  font-size: 12px; color: #555;
}

#tooltip {
  position: absolute; background: #1a1a28; border: 1px solid #2a2a3a;
  padding: 10px 14px; border-radius: 8px; font-size: 12px;
  pointer-events: none; display: none; z-index: 20;
  max-width: 350px; line-height: 1.5;
}
#tooltip .tt-file { color: #7cacff; font-weight: 600; }
#tooltip .tt-stat { color: #888; }

#legend {
  position: absolute; bottom: 16px; right: 16px; z-index: 10;
  background: #14141f; border: 1px solid #2a2a3a; border-radius: 8px;
  padding: 10px 14px; font-size: 11px; max-height: 200px; overflow-y: auto;
}
.legend-item { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.node { cursor: pointer; transition: opacity 0.3s; }
.node text {
  paint-order: stroke;
  stroke: #0a0a12;
  stroke-width: 3px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.link { stroke-opacity: 0.45; transition: stroke-opacity 0.3s; }
.dimmed .node { opacity: 0.08; }
.dimmed .link { stroke-opacity: 0.03; }
.dimmed .node.highlighted { opacity: 1; }
.dimmed .link.highlighted { stroke-opacity: 0.6; }

@keyframes ripple-in {
  0% { opacity: 0.08; filter: brightness(1); }
  40% { opacity: 1; filter: brightness(2); }
  100% { opacity: 1; filter: brightness(1); }
}
.ripple { animation: ripple-in 0.8s ease-out forwards; }
.dimmed .node.highlighted { opacity: 0.08; }
.dimmed .node.highlighted.rippled { opacity: 1; transition: none; }
</style>
</head>
<body>
<div id="controls">
  <input type="text" id="search" placeholder="Search files..." autocomplete="off" spellcheck="false">
</div>
<div id="health-badge">
  <div id="health-grade">...</div>
  <div id="health-score"></div>
  <div id="health-summary"></div>
</div>
<div id="info"></div>
<div id="tooltip"></div>
<div id="legend"></div>
<svg></svg>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const API = "http://localhost:${port}";

async function main() {
  const [graphData, healthData] = await Promise.all([
    fetch(API + "/graph").then(r => r.json()),
    fetch(API + "/health").then(r => r.json()).catch(() => null),
  ]);

  if (healthData) {
    const gradeEl = document.getElementById("health-grade");
    const scoreEl = document.getElementById("health-score");
    const summaryEl = document.getElementById("health-summary");
    const colors = { A: "#4ade80", B: "#86efac", C: "#fbbf24", D: "#fb923c", F: "#f87171" };
    gradeEl.textContent = healthData.grade;
    gradeEl.style.color = colors[healthData.grade] || "#888";
    scoreEl.textContent = healthData.score + "/100";
    summaryEl.textContent = healthData.summary;
  }

  const fileNodes = graphData.data.nodes.filter(n => n.kind === "file" && !n.id.startsWith("external:"));
  const fileIds = new Set(fileNodes.map(n => n.id));
  const fileEdges = graphData.data.edges.filter(e =>
    fileIds.has(e.from) && fileIds.has(e.to) && e.kind === "imports"
  );

  const degreeIn = new Map();
  const degreeOut = new Map();
  fileEdges.forEach(e => {
    degreeIn.set(e.to, (degreeIn.get(e.to) || 0) + 1);
    degreeOut.set(e.from, (degreeOut.get(e.from) || 0) + 1);
  });

  const dirOf = f => {
    const parts = (f.file || f).split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  };
  const baseName = f => (f.file || f).split("/").pop();
  const dirs = [...new Set(fileNodes.map(dirOf))].sort();
  const palette = [
    "#5b7fff","#ff6b8a","#4ade80","#fbbf24","#a78bfa",
    "#f472b6","#38bdf8","#fb923c","#34d399","#e879f9",
    "#60a5fa","#facc15","#2dd4bf","#f97316","#818cf8"
  ];
  const colorMap = new Map();
  dirs.forEach((d, i) => colorMap.set(d, palette[i % palette.length]));
  const nodeColor = n => colorMap.get(dirOf(n)) || "#555";

  const nodes = fileNodes.map(n => ({
    id: n.id,
    file: n.file,
    radius: 4 + Math.sqrt((degreeIn.get(n.id) || 0) + (degreeOut.get(n.id) || 0)) * 2.5,
    inDeg: degreeIn.get(n.id) || 0,
    outDeg: degreeOut.get(n.id) || 0,
  }));

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const links = fileEdges
    .filter(e => nodeMap.has(e.from) && nodeMap.has(e.to))
    .map(e => ({ source: e.from, target: e.to }));

  document.getElementById("info").textContent =
    nodes.length + " files, " + links.length + " local edges";

  const legendEl = document.getElementById("legend");
  dirs.forEach(d => {
    const count = fileNodes.filter(n => dirOf(n) === d).length;
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = '<div class="legend-dot" style="background:' + colorMap.get(d) + '"></div>' +
      '<span>' + d + ' (' + count + ')</span>';
    legendEl.appendChild(item);
  });

  const width = window.innerWidth;
  const height = window.innerHeight;

  const svg = d3.select("svg");

  svg.append("defs").append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 0 10 6")
    .attr("refX", 10)
    .attr("refY", 3)
    .attr("markerWidth", 7)
    .attr("markerHeight", 5)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,0 L10,3 L0,6Z")
    .attr("fill", "#6a7aaa");

  const g = svg.append("g");

  svg.call(d3.zoom()
    .scaleExtent([0.1, 8])
    .on("zoom", e => g.attr("transform", e.transform))
  );

  const link = g.append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "link")
    .attr("stroke", "#4a5a8a")
    .attr("stroke-width", 1.2)
    .attr("marker-end", "url(#arrow)");

  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  node.append("circle")
    .attr("r", d => d.radius)
    .attr("fill", d => nodeColor(d))
    .attr("stroke", d => d3.color(nodeColor(d)).brighter(0.5))
    .attr("stroke-width", 1);

  const allBases = nodes.map(n => baseName(n));
  const dupes = new Set(allBases.filter((b, i) => allBases.indexOf(b) !== i));
  const labelOf = n => {
    const base = baseName(n);
    if (!dupes.has(base)) return base;
    const parts = n.file.split("/");
    return parts.length > 1 ? parts.slice(-2).join("/") : base;
  };

  node.append("text")
    .text(d => labelOf(d))
    .attr("dx", d => d.radius + 4)
    .attr("dy", 3)
    .attr("fill", "#999")
    .attr("font-size", d => d.radius > 6 ? 11 : 0)
    .style("pointer-events", "none");

  const tooltip = document.getElementById("tooltip");

  node.on("mouseover", (e, d) => {
    tooltip.style.display = "block";
    tooltip.innerHTML =
      '<div class="tt-file">' + d.file + '</div>' +
      '<div class="tt-stat">Imports: ' + d.outDeg + ' local</div>' +
      '<div class="tt-stat">Imported by: ' + d.inDeg + ' file(s)</div>';
  })
  .on("mousemove", e => {
    tooltip.style.left = (e.pageX + 14) + "px";
    tooltip.style.top = (e.pageY - 10) + "px";
  })
  .on("mouseout", () => { tooltip.style.display = "none"; });

  node.on("click", async (e, d) => {
    e.stopPropagation();
    try {
      const impact = await fetch(API + "/impact?file=" + encodeURIComponent(d.file)).then(r => r.json());
      const affectedIds = new Set(impact.affected.map(a => "file:" + a.file));
      affectedIds.add(d.id);

      const byDepth = new Map();
      byDepth.set(0, [d.id]);
      for (const a of impact.affected) {
        const list = byDepth.get(a.depth) || [];
        list.push("file:" + a.file);
        byDepth.set(a.depth, list);
      }

      svg.classed("dimmed", true);
      node.classed("highlighted", false);
      link.classed("highlighted", false);

      const maxDepth = Math.max(...byDepth.keys(), 0);
      for (let depth = 0; depth <= maxDepth; depth++) {
        const ids = new Set(byDepth.get(depth) || []);
        setTimeout(() => {
          node.filter(n => ids.has(n.id))
            .classed("highlighted", true)
            .classed("rippled", true)
            .select("circle")
            .classed("ripple", false)
            .each(function() { this.offsetWidth; })
            .classed("ripple", true)
            .each(function() {
              this.addEventListener("animationend", () => {
                this.classList.remove("ripple");
                this.style.filter = "";
              }, { once: true });
            });
          link.filter(l => affectedIds.has(l.source.id) && affectedIds.has(l.target.id) && ids.has(l.source.id))
            .classed("highlighted", true);
        }, depth * 400);
      }
    } catch {}
  });

  svg.on("click", () => {
    svg.classed("dimmed", false);
    node.classed("highlighted", false);
    link.classed("highlighted", false);
  });

  const searchInput = document.getElementById("search");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase();
    if (!q) {
      svg.classed("dimmed", false);
      node.classed("highlighted", false);
      link.classed("highlighted", false);
      return;
    }
    const matched = new Set(nodes.filter(n => n.file.toLowerCase().includes(q)).map(n => n.id));
    svg.classed("dimmed", matched.size > 0);
    node.classed("highlighted", n => matched.has(n.id));
    link.classed("highlighted", l => matched.has(l.source.id) || matched.has(l.target.id));
  });

  const labelThreshold = nodes.length > 100 ? 10 : 6;
  node.select("text").attr("font-size", d => d.radius > labelThreshold ? 11 : 0);

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(nodes.length > 200 ? 50 : 90))
    .force("charge", d3.forceManyBody().strength(nodes.length > 200 ? -120 : -280).theta(0.9))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(d => d.radius + 2).iterations(1))
    .alphaDecay(nodes.length > 200 ? 0.05 : 0.0228)
    .on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          return d.target.x - (dx/dist) * ((d.target.radius||6) + 4);
        })
        .attr("y2", d => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          return d.target.y - (dy/dist) * ((d.target.radius||6) + 4);
        });
      node.attr("transform", d => "translate(" + d.x + "," + d.y + ")");
    })
    .on("end", () => {
      node.select("text").attr("font-size", d => d.radius > 6 ? 11 : 0);
    });
}

main().catch(err => {
  document.body.innerHTML = '<div style="padding:40px;color:#f87171;font-size:16px;">' +
    'Failed to connect to Impulse daemon at ${port}.<br>' +
    'Start with: <code>impulse daemon .</code></div>';
});
</script>
</body>
</html>`;
}
