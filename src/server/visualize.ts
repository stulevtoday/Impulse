export function getVisualizationHTML(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Impulse — Dashboard</title>
<style>
:root {
  --bg: #0b0d14;
  --s0: #10121b;
  --s1: #161926;
  --s2: #1e2133;
  --s3: #262a3d;
  --bd: #252838;
  --bd2: #363a50;
  --t1: #eaecf3;
  --t2: #a0a4b8;
  --t3: #626780;
  --t4: #454960;
  --ac: #6c8aff;
  --ac2: #8da4ff;
  --acbg: rgba(108,138,255,.12);
  --ok: #4ade80;
  --okbg: rgba(74,222,128,.12);
  --warn: #fbbf24;
  --warnbg: rgba(251,191,36,.12);
  --err: #f87171;
  --errbg: rgba(248,113,113,.12);
  --info: #38bdf8;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  --r: 6px;
  --rl: 10px;
  --tr: .2s ease;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--t2);
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ── Splash ── */
#splash {
  position: fixed; inset: 0; z-index: 1000;
  background: var(--bg);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  transition: opacity .4s ease;
}
#splash.hidden { opacity: 0; pointer-events: none; }
.splash-title { font-size: 20px; font-weight: 700; letter-spacing: 6px; color: var(--t1); }
.splash-sub { font-size: 12px; color: var(--t3); margin-top: 8px; animation: pulse 1.5s ease infinite; }

/* ── Header ── */
#header {
  height: 52px; flex-shrink: 0;
  background: var(--s0);
  border-bottom: 1px solid var(--bd);
  display: flex; align-items: center;
  padding: 0 16px; gap: 16px;
  z-index: 50;
}
.logo {
  font-size: 13px; font-weight: 700; letter-spacing: 4px;
  color: var(--t1); white-space: nowrap; user-select: none;
}
.logo span { color: var(--ac); }
.search-wrap {
  position: relative; flex: 0 1 320px;
}
#search {
  width: 100%; height: 34px;
  background: var(--s1); border: 1px solid var(--bd);
  color: var(--t1); border-radius: var(--r);
  padding: 0 12px 0 32px; font-size: 13px;
  outline: none; transition: border-color var(--tr);
  font-family: var(--font);
}
#search:focus { border-color: var(--ac); }
#search::placeholder { color: var(--t4); }
.search-icon {
  position: absolute; left: 10px; top: 50%;
  transform: translateY(-50%);
  width: 14px; height: 14px; color: var(--t4);
  pointer-events: none;
}
.search-kbd {
  position: absolute; right: 8px; top: 50%;
  transform: translateY(-50%);
  font-size: 11px; color: var(--t4);
  background: var(--s2); border: 1px solid var(--bd);
  padding: 1px 5px; border-radius: 3px;
  pointer-events: none; font-family: var(--mono);
}
#search-drop {
  position: absolute; top: 100%; left: 0; right: 0;
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: 0 0 var(--r) var(--r);
  max-height: 260px; overflow-y: auto;
  display: none; z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
#search-drop.open { display: block; }
.search-item {
  padding: 8px 12px; cursor: pointer;
  display: flex; align-items: center; gap: 8px;
  transition: background var(--tr);
}
.search-item:hover, .search-item.active { background: var(--s2); }
.search-item-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.search-item-path { color: var(--t1); font-size: 12px; }
.search-item-dir { color: var(--t3); font-size: 11px; margin-left: auto; }

.header-fill { flex: 1; }

.metrics { display: flex; gap: 20px; }
.metric { text-align: center; }
.metric-val { font-size: 15px; font-weight: 600; color: var(--t1); line-height: 1.2; }
.metric-lbl { font-size: 10px; color: var(--t3); text-transform: uppercase; letter-spacing: .5px; }

#health-badge {
  display: flex; align-items: center; gap: 10px;
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--rl); padding: 6px 14px;
  cursor: default;
}
#health-grade {
  font-size: 22px; font-weight: 700; line-height: 1;
}
#health-score { font-size: 12px; color: var(--t3); }
#health-summary { display: none; }

/* ── App Layout ── */
#app {
  flex: 1; display: flex; overflow: hidden;
}

/* ── Sidebar ── */
#sidebar {
  width: 260px; flex-shrink: 0;
  background: var(--s0);
  border-right: 1px solid var(--bd);
  display: flex; flex-direction: column;
  transition: width .25s ease;
  overflow: hidden;
}
#sidebar.collapsed { width: 0; border-right: none; }
.sidebar-head {
  height: 36px; display: flex; align-items: center;
  padding: 0 12px; gap: 8px;
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}
.sidebar-head h3 {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; color: var(--t3); flex: 1;
}
.sidebar-scroll {
  flex: 1; overflow-y: auto; padding: 6px 0;
}

.dir-group {}
.dir-label {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 12px; cursor: pointer;
  font-size: 12px; font-weight: 500; color: var(--t2);
  transition: background var(--tr);
  user-select: none;
}
.dir-label:hover { background: var(--s1); }
.dir-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.dir-name { flex: 1; }
.dir-count {
  font-size: 10px; color: var(--t4);
  background: var(--s2); padding: 1px 5px;
  border-radius: 8px; min-width: 18px; text-align: center;
}
.dir-arrow {
  font-size: 10px; color: var(--t4);
  transition: transform .2s;
}
.dir-group.collapsed .dir-arrow { transform: rotate(-90deg); }
.dir-group.collapsed .dir-files { display: none; }
.dir-files {}

.file-item {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 12px 3px 28px; cursor: pointer;
  font-size: 12px; color: var(--t3);
  transition: background var(--tr), color var(--tr);
}
.file-item:hover { background: var(--s1); color: var(--t2); }
.file-item.active { background: var(--acbg); color: var(--ac); }
.file-item-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-item-badge {
  font-size: 10px; color: var(--t4);
  font-family: var(--mono);
}

.sidebar-divider {
  height: 1px; background: var(--bd);
  margin: 8px 12px;
}

.legend-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; color: var(--t3);
  padding: 8px 12px 4px;
}

/* ── Canvas ── */
#canvas {
  flex: 1; position: relative;
  background: var(--bg);
  overflow: hidden;
}
#canvas svg { width: 100%; height: 100%; display: block; }

#zoom-ctrl {
  position: absolute; bottom: 16px; right: 16px;
  display: flex; flex-direction: column; gap: 2px;
  z-index: 10;
}
#zoom-ctrl button {
  width: 32px; height: 32px;
  background: var(--s1); border: 1px solid var(--bd);
  color: var(--t2); font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--tr), color var(--tr);
}
#zoom-ctrl button:first-child { border-radius: var(--r) var(--r) 0 0; }
#zoom-ctrl button:last-child { border-radius: 0 0 var(--r) var(--r); }
#zoom-ctrl button:hover { background: var(--s2); color: var(--t1); }

.canvas-info {
  position: absolute; bottom: 16px; left: 16px;
  font-size: 11px; color: var(--t4); z-index: 10;
}

#tooltip {
  position: absolute; z-index: 60;
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--r);
  padding: 10px 14px;
  font-size: 12px; line-height: 1.6;
  pointer-events: none; display: none;
  max-width: 360px;
  box-shadow: 0 6px 20px rgba(0,0,0,.4);
}
.tt-file { color: var(--ac); font-weight: 600; margin-bottom: 4px; }
.tt-row { color: var(--t3); display: flex; justify-content: space-between; gap: 16px; }
.tt-val { color: var(--t2); }

/* ── Detail Panel ── */
#detail {
  width: 0; flex-shrink: 0;
  background: var(--s0);
  border-left: 1px solid var(--bd);
  transition: width .25s ease;
  overflow: hidden;
  display: flex; flex-direction: column;
}
#detail.open { width: 340px; }

.detail-head {
  height: 44px; display: flex; align-items: center;
  padding: 0 12px; gap: 8px;
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}
.detail-file {
  flex: 1; font-size: 13px; font-weight: 600;
  color: var(--t1); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.btn-icon {
  width: 28px; height: 28px;
  background: transparent; border: none;
  color: var(--t3); font-size: 18px; cursor: pointer;
  border-radius: var(--r);
  display: flex; align-items: center; justify-content: center;
  transition: background var(--tr), color var(--tr);
}
.btn-icon:hover { background: var(--s2); color: var(--t1); }

.detail-scroll {
  flex: 1; overflow-y: auto; padding: 12px;
}

.section { margin-bottom: 16px; }
.section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; color: var(--t3);
  margin-bottom: 8px;
  display: flex; align-items: center; gap: 6px;
}
.section-badge {
  font-size: 11px; font-weight: 600;
  padding: 1px 6px; border-radius: 8px;
  background: var(--s2); color: var(--t2);
}

.stat-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.stat-box {
  background: var(--s1); border-radius: var(--r);
  padding: 10px; text-align: center;
}
.stat-val { font-size: 18px; font-weight: 700; color: var(--t1); line-height: 1.2; }
.stat-lbl { font-size: 10px; color: var(--t3); margin-top: 2px; }

.list-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0; font-size: 12px;
}
.list-row-icon { flex-shrink: 0; font-size: 10px; }
.list-row-text { flex: 1; color: var(--t2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row-sub { color: var(--t3); font-size: 11px; flex-shrink: 0; }

.bar-row {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 4px; font-size: 12px;
}
.bar-track {
  flex: 1; height: 6px; background: var(--s2);
  border-radius: 3px; overflow: hidden;
}
.bar-fill { height: 100%; border-radius: 3px; transition: width .3s ease; }
.bar-label { color: var(--t3); min-width: 30px; text-align: right; font-size: 11px; }

.empty-state {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 40px 20px; color: var(--t4);
  text-align: center; gap: 8px;
}
.empty-icon { font-size: 28px; opacity: .5; }

.detail-loading {
  display: flex; align-items: center; justify-content: center;
  padding: 40px; color: var(--t3);
}

/* ── Bottom Panel ── */
#bottom {
  flex-shrink: 0;
  background: var(--s0);
  border-top: 1px solid var(--bd);
  display: flex; flex-direction: column;
  max-height: 280px;
  transition: max-height .25s ease;
}
#bottom.collapsed { max-height: 37px; }

.tab-bar {
  height: 37px; flex-shrink: 0;
  display: flex; align-items: stretch;
  padding: 0 4px; gap: 2px;
  border-bottom: 1px solid var(--bd);
}
.tab {
  padding: 0 14px; background: none; border: none;
  color: var(--t3); font-size: 12px; font-weight: 500;
  cursor: pointer; position: relative;
  transition: color var(--tr);
  font-family: var(--font);
  white-space: nowrap;
}
.tab:hover { color: var(--t2); }
.tab.active { color: var(--ac); }
.tab.active::after {
  content: ''; position: absolute;
  bottom: 0; left: 8px; right: 8px; height: 2px;
  background: var(--ac); border-radius: 1px 1px 0 0;
}
.tab-count {
  font-size: 10px; margin-left: 4px; opacity: .6;
}
.tab-fill { flex: 1; }

#bottom-toggle {
  width: 36px; height: 100%;
  background: none; border: none;
  color: var(--t3); font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color var(--tr), transform var(--tr);
}
#bottom-toggle:hover { color: var(--t2); }
#bottom.collapsed #bottom-toggle { transform: rotate(180deg); }

.bottom-scroll {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 12px 16px;
}
.tab-pane { display: none; }
.tab-pane.active { display: block; }

.pane-loading { padding: 20px; text-align: center; color: var(--t3); }
.pane-empty { padding: 20px; text-align: center; color: var(--t4); }

/* ── Overview Grid ── */
.overview-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.overview-card {
  background: var(--s1); border-radius: var(--r);
  padding: 14px;
}
.overview-card h4 {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; color: var(--t3); margin-bottom: 10px;
}
.ov-row {
  display: flex; justify-content: space-between;
  font-size: 12px; padding: 2px 0;
}
.ov-label { color: var(--t3); }
.ov-value { color: var(--t1); font-weight: 500; }
.ov-value.penalty { color: var(--err); }
.ov-value.ok { color: var(--ok); }

/* ── Hotspot / Coupling rows ── */
.hs-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--bd);
}
.hs-item:last-child { border-bottom: none; }
.hs-bar { width: 80px; flex-shrink: 0; }
.hs-info { flex: 1; min-width: 0; }
.hs-file { font-size: 12px; font-weight: 500; color: var(--t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hs-meta { font-size: 11px; color: var(--t3); }
.risk-badge {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  padding: 2px 6px; border-radius: 3px; flex-shrink: 0;
}
.risk-critical { background: var(--errbg); color: var(--err); }
.risk-high { background: var(--warnbg); color: var(--warn); }
.risk-medium { background: rgba(56,189,248,.12); color: var(--info); }
.risk-low { background: var(--s2); color: var(--t3); }

.cycle-item {
  padding: 6px 0; font-size: 12px; border-bottom: 1px solid var(--bd);
}
.cycle-item:last-child { border-bottom: none; }
.cycle-path { color: var(--t1); }
.cycle-severity { font-size: 11px; color: var(--t3); margin-left: 4px; }

.sugg-card {
  background: var(--s1); border-radius: var(--r);
  padding: 12px; margin-bottom: 8px;
}
.sugg-title { font-size: 12px; font-weight: 600; color: var(--t1); margin-bottom: 4px; }
.sugg-detail { font-size: 11px; color: var(--t3); }

/* ── Graph Styles ── */
.node { cursor: pointer; }
.node circle { transition: filter .2s, stroke-width .2s; }
.node:hover circle { filter: brightness(1.3); stroke-width: 2px; }
.node text {
  paint-order: stroke;
  stroke: var(--bg);
  stroke-width: 3px;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
.link { stroke-opacity: .3; transition: stroke-opacity .3s; }

.dimmed .node { opacity: .06; transition: opacity .15s; }
.dimmed .link { stroke-opacity: .02; }
.dimmed .node.hl { opacity: 1; }
.dimmed .link.hl { stroke-opacity: .5; }

@keyframes rippleIn {
  0% { opacity: .06; filter: brightness(1); }
  30% { opacity: 1; filter: brightness(1.8); }
  100% { opacity: 1; filter: brightness(1); }
}
.ripple-anim circle { animation: rippleIn .6s ease-out forwards; }

.node.selected circle { stroke-width: 2.5px; filter: drop-shadow(0 0 6px currentColor); }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-thumb { background: var(--s3); border-radius: 3px; }
::-webkit-scrollbar-track { background: transparent; }

/* ── Animations ── */
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
@keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

.fade-in { animation: fadeIn .3s ease; }
.slide-up { animation: slideUp .3s ease; }

/* ── Live Indicator ── */
.live-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ok); display: inline-block;
  margin-right: 5px; vertical-align: middle;
  animation: livePulse 2s ease infinite;
}
.live-dot.inactive { background: var(--t4); animation: none; }
@keyframes livePulse { 0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(74,222,128,.4)} 50%{opacity:.7;box-shadow:0 0 0 4px rgba(74,222,128,0)} }

.live-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: .5px;
  color: var(--ok); font-weight: 600; vertical-align: middle;
}
.live-label.inactive { color: var(--t4); }

#toast {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(60px);
  background: var(--s1); border: 1px solid var(--bd);
  border-radius: var(--rl); padding: 10px 20px;
  font-size: 12px; color: var(--t2); z-index: 200;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
  opacity: 0; transition: transform .3s ease, opacity .3s ease;
  pointer-events: none; white-space: nowrap;
}
#toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
</style>
</head>
<body>

<div id="splash">
  <div class="splash-title">I M P U L S E</div>
  <div class="splash-sub">Indexing your project...</div>
</div>

<header id="header">
  <div class="logo"><span>I</span>MPULSE</div>
  <div class="search-wrap">
    <svg class="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="15" y2="15"/>
    </svg>
    <input id="search" placeholder="Search files..." autocomplete="off" spellcheck="false">
    <span class="search-kbd">/</span>
    <div id="search-drop"></div>
  </div>
  <div id="live-status" style="display:flex;align-items:center;gap:2px;margin-left:8px;cursor:default" title="Live — auto-refreshes on file changes">
    <span class="live-dot"></span><span class="live-label">LIVE</span>
  </div>
  <div class="header-fill"></div>
  <div class="metrics" id="metrics"></div>
  <div id="review-badge" style="display:none;padding:4px 12px;border-radius:var(--r);font-size:12px;font-weight:600;letter-spacing:1px;cursor:default">
    <span id="review-label"></span>
  </div>
  <div id="health-badge">
    <span id="health-grade">-</span>
    <div>
      <div id="health-score" style="font-size:12px;color:var(--t3)"></div>
    </div>
  </div>
</header>

<div id="app">
  <aside id="sidebar">
    <div class="sidebar-head">
      <h3>Files</h3>
      <button class="btn-icon" id="sidebar-toggle" title="Toggle sidebar">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="1" y="2" width="14" height="12" rx="2"/><line x1="6" y1="2" x2="6" y2="14"/>
        </svg>
      </button>
    </div>
    <div class="sidebar-scroll" id="sidebar-body"></div>
  </aside>

  <main id="canvas">
    <svg id="graph"></svg>
    <div class="canvas-info" id="canvas-info"></div>
    <div id="zoom-ctrl">
      <button id="z-in" title="Zoom in (+)">+</button>
      <button id="z-out" title="Zoom out (-)">&#8722;</button>
      <button id="z-fit" title="Fit to screen (0)">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="10" height="10" rx="1"/><line x1="1" y1="1" x2="4" y2="4"/><line x1="15" y1="1" x2="12" y2="4"/><line x1="1" y1="15" x2="4" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/>
        </svg>
      </button>
    </div>
    <div id="tooltip"></div>
  </main>

  <aside id="detail">
    <div class="detail-head">
      <span class="detail-file" id="detail-title"></span>
      <button class="btn-icon" id="detail-close" title="Close (Esc)">&times;</button>
    </div>
    <div class="detail-scroll" id="detail-body">
      <div class="empty-state">
        <div class="empty-icon">&#9678;</div>
        <div>Click a node to inspect</div>
      </div>
    </div>
  </aside>
</div>

<div id="bottom" class="collapsed">
  <div class="tab-bar">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="hotspots">Hotspots</button>
    <button class="tab" data-tab="cycles">Cycles</button>
    <button class="tab" data-tab="exports">Dead Exports</button>
    <button class="tab" data-tab="coupling">Coupling</button>
    <button class="tab" data-tab="suggestions">Suggestions</button>
    <button class="tab" data-tab="boundaries">Boundaries</button>
    <button class="tab" data-tab="risk">Risk</button>
    <button class="tab" data-tab="owners">Owners</button>
    <button class="tab" data-tab="secrets">Secrets</button>
    <button class="tab" data-tab="debt">Debt</button>
    <button class="tab" data-tab="deps">Deps</button>
    <div class="tab-fill"></div>
    <button id="bottom-toggle" title="Toggle panel">&#9650;</button>
  </div>
  <div class="bottom-scroll" id="bottom-body">
    <div id="pane-overview" class="tab-pane active"></div>
    <div id="pane-hotspots" class="tab-pane"></div>
    <div id="pane-cycles" class="tab-pane"></div>
    <div id="pane-exports" class="tab-pane"></div>
    <div id="pane-coupling" class="tab-pane"></div>
    <div id="pane-suggestions" class="tab-pane"></div>
    <div id="pane-boundaries" class="tab-pane"></div>
    <div id="pane-risk" class="tab-pane"></div>
    <div id="pane-owners" class="tab-pane"></div>
    <div id="pane-secrets" class="tab-pane"></div>
    <div id="pane-debt" class="tab-pane"></div>
    <div id="pane-deps" class="tab-pane"></div>
  </div>
</div>

<div id="toast"></div>
<script src="https://d3js.org/d3.v7.min.js"><\/script>
<script>
var API = "http://localhost:${port}";
var q = function(s) { return document.querySelector(s); };
var qa = function(s) { return document.querySelectorAll(s); };

var palette = [
  "#6c8aff","#ff6b8a","#4ade80","#fbbf24","#a78bfa",
  "#f472b6","#38bdf8","#fb923c","#34d399","#e879f9",
  "#60a5fa","#facc15","#2dd4bf","#f97316","#818cf8"
];

var state = {
  graphData: null,
  healthData: null,
  nodes: [],
  links: [],
  nodeMap: {},
  colorMap: {},
  dirs: [],
  sim: null,
  zoomBehavior: null,
  gNode: null,
  gLink: null,
  selectedFile: null,
  tabLoaded: {},
};

/* ── Helpers ── */
function baseName(p) { return (p||"").split("/").pop()||p; }
function dirOf(p) { var s=(p||"").split("/"); return s.length>1 ? s.slice(0,-1).join("/") : "."; }
function esc(s) { var d=document.createElement("div"); d.textContent=s; return d.innerHTML; }

function fetchJSON(path) {
  return fetch(API + path).then(function(r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).catch(function() { return null; });
}

/* ── Data Loading ── */
function loadCore() {
  return Promise.all([
    fetchJSON("/graph"),
    fetchJSON("/health"),
  ]).then(function(results) {
    state.graphData = results[0];
    state.healthData = results[1];
  });
}

/* ── Header ── */
function renderHeader() {
  var gd = state.graphData;
  var hd = state.healthData;

  var met = q("#metrics");
  if (gd) {
    var fileCount = gd.data ? gd.data.nodes.filter(function(n){return n.kind==="file" && n.id.indexOf("external:")!==0}).length : gd.nodes;
    var edgeCount = gd.edges || 0;
    met.innerHTML =
      '<div class="metric"><div class="metric-val">' + fileCount + '</div><div class="metric-lbl">Files</div></div>' +
      '<div class="metric"><div class="metric-val">' + edgeCount + '</div><div class="metric-lbl">Edges</div></div>';
  }

  if (hd) {
    var colors = { A:"#4ade80", B:"#86efac", C:"#fbbf24", D:"#fb923c", F:"#f87171" };
    q("#health-grade").textContent = hd.grade;
    q("#health-grade").style.color = colors[hd.grade] || "#888";
    q("#health-score").textContent = hd.score + "/100";
  }
}

/* ── Sidebar ── */
function renderSidebar() {
  var body = q("#sidebar-body");
  if (!state.nodes.length) { body.innerHTML = '<div class="empty-state"><div>No files</div></div>'; return; }

  var groups = {};
  state.dirs.forEach(function(d) { groups[d] = []; });
  state.nodes.forEach(function(n) {
    var d = dirOf(n.file);
    if (groups[d]) groups[d].push(n);
  });

  var html = '';
  state.dirs.forEach(function(d) {
    var files = groups[d] || [];
    if (files.length === 0) return;
    files.sort(function(a,b) { return baseName(a.file).localeCompare(baseName(b.file)); });
    var color = state.colorMap[d] || "#555";

    html += '<div class="dir-group">';
    html += '<div class="dir-label" data-dir="' + esc(d) + '">';
    html += '<div class="dir-dot" style="background:' + color + '"></div>';
    html += '<span class="dir-name">' + esc(d) + '</span>';
    html += '<span class="dir-count">' + files.length + '</span>';
    html += '<span class="dir-arrow">&#9662;</span>';
    html += '</div>';
    html += '<div class="dir-files">';
    files.forEach(function(f) {
      var badge = f.inDeg + f.outDeg;
      html += '<div class="file-item" data-file="' + esc(f.file) + '">';
      html += '<span class="file-item-name">' + esc(baseName(f.file)) + '</span>';
      if (badge > 0) html += '<span class="file-item-badge">' + badge + '</span>';
      html += '</div>';
    });
    html += '</div></div>';
  });

  html += '<div class="sidebar-divider"></div>';
  html += '<div class="legend-title">Legend</div>';
  state.dirs.forEach(function(d) {
    var color = state.colorMap[d] || "#555";
    var count = (groups[d] || []).length;
    if (count === 0) return;
    html += '<div class="dir-label" style="cursor:default">';
    html += '<div class="dir-dot" style="background:' + color + '"></div>';
    html += '<span class="dir-name">' + esc(d) + '</span>';
    html += '<span class="dir-count">' + count + '</span>';
    html += '</div>';
  });

  body.innerHTML = html;

  body.addEventListener("click", function(e) {
    var label = e.target.closest(".dir-label[data-dir]");
    if (label) {
      label.parentElement.classList.toggle("collapsed");
      return;
    }
    var item = e.target.closest(".file-item");
    if (item) {
      var file = item.getAttribute("data-file");
      selectFile(file);
    }
  });
}

/* ── Graph ── */
function processGraphData() {
  var gd = state.graphData;
  if (!gd || !gd.data) return;

  var fileNodes = gd.data.nodes.filter(function(n) { return n.kind==="file" && n.id.indexOf("external:")!==0; });
  var fileIds = {};
  fileNodes.forEach(function(n) { fileIds[n.id] = true; });
  var fileEdges = gd.data.edges.filter(function(e) { return fileIds[e.from] && fileIds[e.to] && e.kind==="imports"; });

  var degIn = {};
  var degOut = {};
  fileEdges.forEach(function(e) {
    degIn[e.to] = (degIn[e.to]||0) + 1;
    degOut[e.from] = (degOut[e.from]||0) + 1;
  });

  var dirSet = {};
  fileNodes.forEach(function(n) {
    var d = dirOf(n.file || "");
    dirSet[d] = true;
  });
  state.dirs = Object.keys(dirSet).sort();
  state.colorMap = {};
  state.dirs.forEach(function(d, i) { state.colorMap[d] = palette[i % palette.length]; });

  state.nodes = fileNodes.map(function(n) {
    var iD = degIn[n.id]||0;
    var oD = degOut[n.id]||0;
    return {
      id: n.id,
      file: n.file,
      radius: 4 + Math.sqrt(iD + oD) * 2.2,
      inDeg: iD,
      outDeg: oD,
    };
  });

  state.nodeMap = {};
  state.nodes.forEach(function(n) { state.nodeMap[n.id] = n; });

  state.links = fileEdges
    .filter(function(e) { return state.nodeMap[e.from] && state.nodeMap[e.to]; })
    .map(function(e) { return { source: e.from, target: e.to }; });
}

function nodeColor(n) {
  return state.colorMap[dirOf(n.file)] || "#555";
}

function initGraph() {
  processGraphData();
  if (!state.nodes.length) return;

  var width = q("#canvas").clientWidth;
  var height = q("#canvas").clientHeight;

  q("#canvas-info").textContent = state.nodes.length + " files, " + state.links.length + " edges";

  var svg = d3.select("#graph");
  svg.selectAll("*").remove();

  var defs = svg.append("defs");

  defs.append("filter")
    .attr("id", "glow")
    .append("feGaussianBlur")
    .attr("stdDeviation", "3")
    .attr("result", "blur");

  defs.append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 0 10 6")
    .attr("refX", 10).attr("refY", 3)
    .attr("markerWidth", 6).attr("markerHeight", 4)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,0 L10,3 L0,6Z")
    .attr("fill", "#4a5878");

  var g = svg.append("g");

  state.zoomBehavior = d3.zoom()
    .scaleExtent([0.08, 10])
    .on("zoom", function(e) { g.attr("transform", e.transform); });
  svg.call(state.zoomBehavior);

  state.gLink = g.append("g").selectAll("line").data(state.links).join("line")
    .attr("class", "link")
    .attr("stroke", "#3d4a70")
    .attr("stroke-width", 1)
    .attr("marker-end", "url(#arrow)");

  state.gNode = g.append("g").selectAll("g").data(state.nodes).join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", function(e, d) { if(!e.active) state.sim.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on("drag", function(e, d) { d.fx=e.x; d.fy=e.y; })
      .on("end", function(e, d) { if(!e.active) state.sim.alphaTarget(0); d.fx=null; d.fy=null; })
    );

  state.gNode.append("circle")
    .attr("r", function(d) { return d.radius; })
    .attr("fill", function(d) { return nodeColor(d); })
    .attr("stroke", function(d) { return d3.color(nodeColor(d)).brighter(.6); })
    .attr("stroke-width", 1);

  var allBases = state.nodes.map(function(n) { return baseName(n.file); });
  var dupSet = {};
  allBases.forEach(function(b, i) { if (allBases.indexOf(b) !== i) dupSet[b] = true; });

  function labelOf(n) {
    var b = baseName(n.file);
    if (!dupSet[b]) return b;
    var parts = n.file.split("/");
    return parts.length > 1 ? parts.slice(-2).join("/") : b;
  }

  var labelThreshold = state.nodes.length > 100 ? 9 : 6;

  state.gNode.append("text")
    .text(function(d) { return labelOf(d); })
    .attr("dx", function(d) { return d.radius + 4; })
    .attr("dy", 3)
    .attr("fill", "#8890a8")
    .attr("font-size", function(d) { return d.radius > labelThreshold ? 11 : 0; });

  var tooltip = q("#tooltip");

  state.gNode.on("mouseover", function(e, d) {
    tooltip.style.display = "block";
    tooltip.innerHTML =
      '<div class="tt-file">' + esc(d.file) + '</div>' +
      '<div class="tt-row"><span>Imports</span><span class="tt-val">' + d.outDeg + ' local</span></div>' +
      '<div class="tt-row"><span>Imported by</span><span class="tt-val">' + d.inDeg + ' file(s)</span></div>' +
      '<div class="tt-row"><span>Connections</span><span class="tt-val">' + (d.inDeg + d.outDeg) + '</span></div>';
  })
  .on("mousemove", function(e) {
    tooltip.style.left = (e.pageX + 14) + "px";
    tooltip.style.top = (e.pageY - 10) + "px";
  })
  .on("mouseout", function() { tooltip.style.display = "none"; });

  state.gNode.on("click", function(e, d) {
    e.stopPropagation();
    selectFile(d.file);
    showImpactRipple(d);
  });

  svg.on("click", function() {
    clearHighlight();
    hideDetail();
  });

  var N = state.nodes.length;
  state.sim = d3.forceSimulation(state.nodes)
    .force("link", d3.forceLink(state.links).id(function(d){return d.id}).distance(N > 200 ? 50 : 80))
    .force("charge", d3.forceManyBody().strength(N > 200 ? -100 : -240).theta(.9))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(function(d){return d.radius+2}).iterations(1))
    .alphaDecay(N > 200 ? .04 : .023)
    .on("tick", tick);

  function tick() {
    state.gLink
      .attr("x1", function(d){return d.source.x})
      .attr("y1", function(d){return d.source.y})
      .attr("x2", function(d) {
        var dx=d.target.x-d.source.x, dy=d.target.y-d.source.y;
        var dist=Math.sqrt(dx*dx+dy*dy)||1;
        return d.target.x-(dx/dist)*((d.target.radius||6)+3);
      })
      .attr("y2", function(d) {
        var dx=d.target.x-d.source.x, dy=d.target.y-d.source.y;
        var dist=Math.sqrt(dx*dx+dy*dy)||1;
        return d.target.y-(dy/dist)*((d.target.radius||6)+3);
      });
    state.gNode.attr("transform", function(d){return "translate("+d.x+","+d.y+")";});
  }
}

/* ── Impact Ripple ── */
function showImpactRipple(d) {
  fetchJSON("/impact?file=" + encodeURIComponent(d.file)).then(function(impact) {
    if (!impact) return;
    var affectedIds = {};
    affectedIds[d.id] = true;
    impact.affected.forEach(function(a) { affectedIds["file:"+a.file] = true; });

    var byDepth = {};
    byDepth[0] = [d.id];
    impact.affected.forEach(function(a) {
      var list = byDepth[a.depth] || [];
      list.push("file:" + a.file);
      byDepth[a.depth] = list;
    });

    var svgEl = d3.select("#graph");
    svgEl.classed("dimmed", true);
    state.gNode.classed("hl", false).classed("ripple-anim", false);
    state.gLink.classed("hl", false);

    var maxD = Math.max.apply(null, Object.keys(byDepth).map(Number).concat([0]));
    for (var depth = 0; depth <= maxD; depth++) {
      (function(dep) {
        var ids = {};
        (byDepth[dep]||[]).forEach(function(id){ids[id]=true;});
        setTimeout(function() {
          state.gNode.filter(function(n){return ids[n.id];})
            .classed("hl", true)
            .classed("ripple-anim", false)
            .each(function(){ this.offsetWidth; })
            .classed("ripple-anim", true);
          state.gLink.filter(function(l){return affectedIds[l.source.id] && affectedIds[l.target.id] && ids[l.source.id];})
            .classed("hl", true);
        }, dep * 350);
      })(depth);
    }
  });
}

function clearHighlight() {
  d3.select("#graph").classed("dimmed", false);
  if (state.gNode) {
    state.gNode.classed("hl", false).classed("ripple-anim", false).classed("selected", false);
  }
  if (state.gLink) state.gLink.classed("hl", false);
  qa(".file-item.active").forEach(function(el) { el.classList.remove("active"); });
}

function highlightNode(file) {
  if (!state.gNode) return;
  state.gNode.classed("selected", function(d) { return d.file === file; });
  var item = q('.file-item[data-file="' + file.replace(/"/g, '\\\\"') + '"]');
  if (item) {
    qa(".file-item.active").forEach(function(el) { el.classList.remove("active"); });
    item.classList.add("active");
    item.scrollIntoView({ block: "nearest" });
  }
}

/* ── Select File ── */
function selectFile(file) {
  state.selectedFile = file;
  highlightNode(file);
  showDetail(file);

  var nd = null;
  state.nodes.forEach(function(n) { if (n.file === file) nd = n; });
  if (nd) {
    showImpactRipple(nd);
  }
}

/* ── Detail Panel ── */
function showDetail(file) {
  var panel = q("#detail");
  var body = q("#detail-body");
  var title = q("#detail-title");

  panel.classList.add("open");
  title.textContent = baseName(file);
  title.title = file;
  body.innerHTML = '<div class="detail-loading">Loading...</div>';

  fetchJSON("/focus?file=" + encodeURIComponent(file)).then(function(data) {
    if (!data || !data.exists) {
      body.innerHTML = '<div class="empty-state"><div>No data for this file</div></div>';
      return;
    }
    renderDetail(body, data, file);
  });
}

function renderDetail(container, data, file) {
  var h = '';

  var local = data.imports ? data.imports.filter(function(i){return i.indexOf("/")>=0;}).length : 0;
  var ext = data.imports ? data.imports.filter(function(i){return i.indexOf("/")<0;}).length : 0;

  h += '<div class="section"><div class="stat-grid">';
  h += '<div class="stat-box"><div class="stat-val">' + local + '</div><div class="stat-lbl">Imports</div></div>';
  h += '<div class="stat-box"><div class="stat-val">' + (data.importedBy ? data.importedBy.length : 0) + '</div><div class="stat-lbl">Imported By</div></div>';
  h += '<div class="stat-box"><div class="stat-val">' + (data.blastRadius||0) + '</div><div class="stat-lbl">Blast Radius</div></div>';
  h += '<div class="stat-box"><div class="stat-val">' + (data.testsCovering ? data.testsCovering.length : 0) + '</div><div class="stat-lbl">Tests</div></div>';
  h += '</div></div>';

  if (data.impactByDepth && Object.keys(data.impactByDepth).length > 0) {
    h += '<div class="section"><div class="section-title">Impact by Depth</div>';
    var maxCount = Math.max.apply(null, Object.values(data.impactByDepth).concat([1]));
    Object.keys(data.impactByDepth).sort(function(a,b){return a-b;}).forEach(function(d) {
      var count = data.impactByDepth[d];
      var pct = Math.round((count / maxCount) * 100);
      var label = d === "1" ? "direct" : "depth " + d;
      h += '<div class="bar-row">';
      h += '<span style="width:50px;color:var(--t3)">' + label + '</span>';
      h += '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--ac)"></div></div>';
      h += '<span class="bar-label">' + count + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  if (data.exports && data.exports.length > 0) {
    var dead = data.exports.filter(function(e){return e.dead;}).length;
    h += '<div class="section"><div class="section-title">Exports <span class="section-badge">' + data.exports.length + '</span>';
    if (dead > 0) h += ' <span class="section-badge" style="background:var(--errbg);color:var(--err)">' + dead + ' dead</span>';
    h += '</div>';
    data.exports.forEach(function(exp) {
      var icon = exp.dead ? '<span style="color:var(--err)">&#10005;</span>' : '<span style="color:var(--ok)">&#10003;</span>';
      var sub = exp.dead ? 'unused' : exp.consumers.length + ' consumer(s)';
      h += '<div class="list-row"><span class="list-row-icon">' + icon + '</span>';
      h += '<span class="list-row-text">' + esc(exp.name) + '</span>';
      h += '<span class="list-row-sub">' + sub + '</span></div>';
    });
    h += '</div>';
  }

  if (data.importedBy && data.importedBy.length > 0) {
    h += '<div class="section"><div class="section-title">Imported By <span class="section-badge">' + data.importedBy.length + '</span></div>';
    data.importedBy.slice(0, 12).forEach(function(f) {
      h += '<div class="list-row"><span class="list-row-icon" style="color:var(--ac)">&larr;</span>';
      h += '<span class="list-row-text">' + esc(f) + '</span></div>';
    });
    if (data.importedBy.length > 12) {
      h += '<div style="font-size:11px;color:var(--t4);padding:4px 0">...and ' + (data.importedBy.length - 12) + ' more</div>';
    }
    h += '</div>';
  }

  if (data.testsCovering && data.testsCovering.length > 0) {
    h += '<div class="section"><div class="section-title">Tests <span class="section-badge" style="background:var(--okbg);color:var(--ok)">' + data.testsCovering.length + '</span></div>';
    data.testsCovering.forEach(function(t) {
      h += '<div class="list-row"><span class="list-row-icon" style="color:var(--ok)">&#9889;</span>';
      h += '<span class="list-row-text">' + esc(t) + '</span></div>';
    });
    h += '</div>';
  }

  if (data.gitChanges > 0) {
    h += '<div class="section"><div class="section-title">Git</div>';
    h += '<div style="font-size:12px;color:var(--t2)">' + data.gitChanges + ' change(s)';
    if (data.lastChanged) h += ' &middot; last ' + esc(data.lastChanged);
    h += '</div>';
    if (data.topCochangers && data.topCochangers.length > 0) {
      h += '<div style="font-size:11px;color:var(--t3);margin-top:6px">Often changes with:</div>';
      data.topCochangers.slice(0, 5).forEach(function(c) {
        h += '<div class="list-row"><span class="list-row-text">' + esc(c.file) + '</span>';
        h += '<span class="list-row-sub">' + c.cochanges + '&times;</span></div>';
      });
    }
    h += '</div>';
  }

  container.innerHTML = h;
  container.classList.add("fade-in");
}

function hideDetail() {
  q("#detail").classList.remove("open");
  state.selectedFile = null;
  qa(".file-item.active").forEach(function(el) { el.classList.remove("active"); });
}

/* ── Bottom Panel Tabs ── */
function initBottom() {
  var tabs = qa(".tab[data-tab]");
  var toggle = q("#bottom-toggle");
  var bottom = q("#bottom");

  tabs.forEach(function(tab) {
    tab.addEventListener("click", function() {
      var name = tab.getAttribute("data-tab");
      tabs.forEach(function(t) { t.classList.remove("active"); });
      tab.classList.add("active");
      qa(".tab-pane").forEach(function(p) { p.classList.remove("active"); });
      q("#pane-" + name).classList.add("active");

      if (bottom.classList.contains("collapsed")) {
        bottom.classList.remove("collapsed");
      }
      loadTabIfNeeded(name);
    });
  });

  toggle.addEventListener("click", function() {
    bottom.classList.toggle("collapsed");
  });
}

function loadTabIfNeeded(name) {
  if (state.tabLoaded[name]) return;
  state.tabLoaded[name] = true;

  var pane = q("#pane-" + name);

  switch (name) {
    case "overview": renderOverview(pane); break;
    case "hotspots": loadAndRender(pane, "/hotspots", renderHotspots); break;
    case "cycles": renderCycles(pane); break;
    case "exports": loadAndRender(pane, "/exports", renderExports); break;
    case "coupling": loadAndRender(pane, "/coupling", renderCoupling); break;
    case "suggestions": loadAndRender(pane, "/suggest", renderSuggestions); break;
    case "boundaries": loadAndRender(pane, "/check", renderBoundaries); break;
    case "risk": loadAndRender(pane, "/risk", renderRisk); break;
    case "owners": loadAndRender(pane, "/owners", renderOwners); break;
    case "secrets": loadAndRender(pane, "/secrets", renderSecrets); break;
    case "debt": loadAndRender(pane, "/debt", renderDebt); break;
    case "deps": loadAndRender(pane, "/deps", renderDeps); break;
  }
}

function loadAndRender(pane, endpoint, renderer) {
  pane.innerHTML = '<div class="pane-loading">Loading...</div>';
  fetchJSON(endpoint).then(function(data) {
    if (!data) { pane.innerHTML = '<div class="pane-empty">Failed to load data</div>'; return; }
    renderer(pane, data);
  });
}

/* ── Tab: Overview ── */
function renderOverview(pane) {
  var hd = state.healthData;
  if (!hd) { pane.innerHTML = '<div class="pane-empty">Health data unavailable</div>'; return; }

  var h = '<div class="overview-grid">';

  h += '<div class="overview-card"><h4>Health Score</h4>';
  var gc = { A:"#4ade80", B:"#86efac", C:"#fbbf24", D:"#fb923c", F:"#f87171" };
  h += '<div style="font-size:36px;font-weight:700;color:' + (gc[hd.grade]||"#888") + ';line-height:1">' + hd.grade + '</div>';
  h += '<div style="font-size:14px;color:var(--t2);margin-top:4px">' + hd.score + ' / 100</div>';
  if (hd.summary) h += '<div style="font-size:11px;color:var(--t3);margin-top:6px">' + esc(hd.summary) + '</div>';
  h += '</div>';

  if (hd.penalties) {
    h += '<div class="overview-card"><h4>Penalties</h4>';
    var pKeys = ["cycles","godFiles","deepChains","orphans","hubConcentration","stabilityViolations"];
    var pLabels = ["Cycles","God Files","Deep Chains","Orphans","Hub Conc.","SDP Violations"];
    pKeys.forEach(function(k, i) {
      var v = hd.penalties[k] || 0;
      if (v > 0) {
        h += '<div class="ov-row"><span class="ov-label">' + pLabels[i] + '</span><span class="ov-value penalty">-' + v + '</span></div>';
      }
    });
    var total = pKeys.reduce(function(s,k){return s+(hd.penalties[k]||0);}, 0);
    if (total === 0) h += '<div style="color:var(--ok);font-size:12px">No penalties</div>';
    h += '</div>';
  }

  if (hd.stats) {
    h += '<div class="overview-card"><h4>Statistics</h4>';
    var statPairs = [
      ["Files", hd.stats.totalFiles],
      ["Local edges", hd.stats.localEdges],
      ["External edges", hd.stats.externalEdges],
      ["Avg imports", hd.stats.avgImports],
      ["Avg imported by", hd.stats.avgImportedBy],
      ["Max imports", hd.stats.maxImports],
      ["Max imported by", hd.stats.maxImportedBy],
    ];
    statPairs.forEach(function(p) {
      h += '<div class="ov-row"><span class="ov-label">' + p[0] + '</span><span class="ov-value">' + p[1] + '</span></div>';
    });
    h += '</div>';
  }

  if (hd.stability && hd.stability.modules && hd.stability.modules.length > 0) {
    h += '<div class="overview-card"><h4>Module Stability</h4>';
    hd.stability.modules.forEach(function(m) {
      var pct = Math.round((1 - m.instability) * 100);
      h += '<div style="margin-bottom:6px">';
      h += '<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--t1)">' + esc(m.name) + '</span><span style="color:var(--t3)">I=' + m.instability.toFixed(2) + '</span></div>';
      h += '<div class="bar-track" style="margin-top:3px"><div class="bar-fill" style="width:' + pct + '%;background:var(--ac)"></div></div>';
      h += '</div>';
    });
    if (hd.stability.violations && hd.stability.violations.length > 0) {
      h += '<div style="margin-top:8px;font-size:11px;color:var(--err)">' + hd.stability.violations.length + ' SDP violation(s)</div>';
    } else {
      h += '<div style="margin-top:8px;font-size:11px;color:var(--ok)">Dependencies flow toward stability</div>';
    }
    h += '</div>';
  }

  h += '</div>';
  pane.innerHTML = h;
}

/* ── Tab: Hotspots ── */
function renderHotspots(pane, data) {
  if (!data.hotspots || data.hotspots.length === 0) {
    pane.innerHTML = '<div class="pane-empty">No hotspots found</div>';
    return;
  }
  var maxScore = data.hotspots[0].score || 1;
  var h = '';
  data.hotspots.slice(0, 20).forEach(function(hs) {
    var pct = Math.round((hs.score / maxScore) * 100);
    var riskCls = "risk-" + hs.risk;
    h += '<div class="hs-item">';
    h += '<div class="hs-bar"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + riskColor(hs.risk) + '"></div></div></div>';
    h += '<div class="hs-info"><div class="hs-file">' + esc(hs.file) + '</div>';
    h += '<div class="hs-meta">' + hs.changes + ' changes &middot; ' + hs.affected + ' affected &middot; score ' + hs.score + '</div></div>';
    h += '<span class="risk-badge ' + riskCls + '">' + hs.risk + '</span>';
    h += '</div>';
  });
  if (data.hotspots.length > 20) {
    h += '<div style="padding:8px 0;font-size:11px;color:var(--t4)">...and ' + (data.hotspots.length - 20) + ' more</div>';
  }
  pane.innerHTML = h;
  addFileClickHandlers(pane);
}

function riskColor(risk) {
  var map = { critical: "var(--err)", high: "var(--warn)", medium: "var(--info)", low: "var(--t3)" };
  return map[risk] || "var(--t3)";
}

/* ── Tab: Cycles ── */
function renderCycles(pane) {
  var hd = state.healthData;
  if (!hd || !hd.cycles || hd.cycles.length === 0) {
    pane.innerHTML = '<div class="pane-empty" style="color:var(--ok)">No circular dependencies</div>';
    return;
  }
  var h = '<div style="font-size:12px;color:var(--t3);margin-bottom:12px">' + hd.cycles.length + ' circular dependenc' + (hd.cycles.length===1?'y':'ies') + ' found</div>';
  hd.cycles.slice(0, 25).forEach(function(c) {
    var display = c.severity === "tight-couple"
      ? esc(c.cycle[0]) + ' <span style="color:var(--warn)">&harr;</span> ' + esc(c.cycle[1])
      : c.cycle.map(esc).join(' <span style="color:var(--err)">&rarr;</span> ');
    h += '<div class="cycle-item">';
    h += '<span class="cycle-path">' + display + '</span>';
    h += '<span class="cycle-severity">(' + c.severity + ')</span>';
    h += '</div>';
  });
  if (hd.cycles.length > 25) {
    h += '<div style="padding:8px 0;font-size:11px;color:var(--t4)">...and ' + (hd.cycles.length - 25) + ' more</div>';
  }
  pane.innerHTML = h;
}

/* ── Tab: Dead Exports ── */
function renderExports(pane, data) {
  if (!data.exports) { pane.innerHTML = '<div class="pane-empty">No export data</div>'; return; }
  var dead = data.exports.filter(function(e){return e.dead;});
  if (dead.length === 0) {
    pane.innerHTML = '<div class="pane-empty" style="color:var(--ok)">No dead exports (' + data.total + ' total)</div>';
    return;
  }
  var h = '<div style="font-size:12px;color:var(--t3);margin-bottom:12px">' + dead.length + ' dead out of ' + data.total + ' total exports</div>';
  var byFile = {};
  dead.forEach(function(e) {
    if (!byFile[e.file]) byFile[e.file] = [];
    byFile[e.file].push(e.name);
  });
  Object.keys(byFile).sort().forEach(function(f) {
    h += '<div style="margin-bottom:10px">';
    h += '<div class="hs-file" style="margin-bottom:4px">' + esc(f) + '</div>';
    byFile[f].forEach(function(name) {
      h += '<div class="list-row"><span class="list-row-icon" style="color:var(--err)">&#10005;</span>';
      h += '<span class="list-row-text">' + esc(name) + '</span></div>';
    });
    h += '</div>';
  });
  pane.innerHTML = h;
  addFileClickHandlers(pane);
}

/* ── Tab: Coupling ── */
function renderCoupling(pane, data) {
  var hidden = data.hidden || [];
  if (hidden.length === 0) {
    var total = (data.pairs || []).length;
    pane.innerHTML = '<div class="pane-empty" style="color:var(--ok)">No hidden coupling' + (total > 0 ? ' (' + total + ' confirmed pairs)' : '') + '</div>';
    return;
  }
  var h = '<div style="font-size:12px;color:var(--t3);margin-bottom:12px">' + hidden.length + ' hidden coupling pair(s) &mdash; co-change in git, no import</div>';
  hidden.slice(0, 15).forEach(function(p) {
    var pct = Math.round(p.couplingRatio * 100);
    h += '<div class="hs-item">';
    h += '<div class="hs-bar"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--err)"></div></div></div>';
    h += '<div class="hs-info"><div class="hs-file">' + esc(baseName(p.fileA)) + ' &harr; ' + esc(baseName(p.fileB)) + '</div>';
    h += '<div class="hs-meta">' + pct + '% ratio &middot; ' + p.cochanges + ' co-changes</div></div>';
    h += '</div>';
  });
  if (hidden.length > 15) {
    h += '<div style="padding:8px 0;font-size:11px;color:var(--t4)">...and ' + (hidden.length - 15) + ' more</div>';
  }
  pane.innerHTML = h;
}

/* ── Tab: Suggestions ── */
function renderSuggestions(pane, data) {
  if (!data.suggestions || data.suggestions.length === 0) {
    pane.innerHTML = '<div class="pane-empty" style="color:var(--ok)">No suggestions &mdash; architecture looks clean</div>';
    return;
  }
  var h = '';
  if (data.estimatedScoreImprovement > 0) {
    h += '<div style="font-size:12px;color:var(--ok);margin-bottom:12px">Potential improvement: +' + data.estimatedScoreImprovement + ' (' + data.currentScore + ' &rarr; ' + data.potentialScore + ')</div>';
  }
  data.suggestions.forEach(function(s, i) {
    h += '<div class="sugg-card">';
    if (s.kind === "split-god-file") {
      h += '<div class="sugg-title">' + (i+1) + '. Split: ' + esc(s.file) + '</div>';
      h += '<div class="sugg-detail">' + s.dependents + ' dependents &rarr; expected max ' + s.expectedMaxDependents + '</div>';
      if (s.clusters) {
        s.clusters.forEach(function(cl) {
          h += '<div class="sugg-detail" style="margin-top:4px">' + cl.exports.map(esc).join(", ") + ' &rarr; ' + esc(cl.suggestedFile) + '</div>';
        });
      }
    } else if (s.kind === "remove-dead-exports") {
      h += '<div class="sugg-title">' + (i+1) + '. Dead exports: ' + esc(s.file) + '</div>';
      h += '<div class="sugg-detail">' + s.exports.map(esc).join(", ") + '</div>';
    } else if (s.kind === "break-cycle") {
      h += '<div class="sugg-title">' + (i+1) + '. Break cycle: ' + esc(s.cycle[0]) + ' &harr; ' + esc(s.cycle[1]) + '</div>';
      if (s.sharedSymbols) h += '<div class="sugg-detail">Extract ' + s.sharedSymbols.map(esc).join(", ") + ' &rarr; ' + esc(s.suggestedExtraction || "shared module") + '</div>';
    }
    h += '</div>';
  });
  pane.innerHTML = h;
  addFileClickHandlers(pane);
}

/* ── Tab: Boundaries ── */
function renderBoundaries(pane, data) {
  if (data.error) {
    pane.innerHTML = '<div class="pane-empty">' + esc(data.error) + '</div>';
    return;
  }
  var violations = data.violations || [];
  var h = '';
  if (data.boundaries && data.boundaries.length > 0) {
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">';
    data.boundaries.forEach(function(b) {
      var status = b.violations > 0 ? 'var(--err)' : 'var(--ok)';
      h += '<div style="background:var(--s1);border-radius:var(--r);padding:8px 12px;font-size:12px">';
      h += '<span style="color:var(--t1);font-weight:500">' + esc(b.name) + '</span>';
      h += ' <span style="color:var(--t3)">' + b.files + ' files</span>';
      h += ' <span style="color:' + status + '">' + (b.violations > 0 ? b.violations + ' violation(s)' : 'clean') + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }
  if (violations.length === 0) {
    h += '<div style="color:var(--ok);font-size:12px;padding:8px 0">No boundary violations</div>';
  } else {
    h += '<div style="font-size:12px;color:var(--err);margin-bottom:8px">' + violations.length + ' violation(s)</div>';
    violations.forEach(function(v) {
      h += '<div class="cycle-item">';
      h += '<span class="cycle-path">' + esc(v.from) + ' <span style="color:var(--err)">&rarr;</span> ' + esc(v.to) + '</span>';
      if (v.reason) h += '<div style="font-size:11px;color:var(--t3)">' + esc(v.reason) + '</div>';
      h += '</div>';
    });
  }
  pane.innerHTML = h;
}

/* ── Tab: Risk ── */
function renderRisk(pane, data) {
  var files = data.files || [];
  if (files.length === 0) { pane.innerHTML = '<div class="pane-empty">No risk data</div>'; return; }
  var d = data.distribution || {};
  var h = '<div style="display:flex;gap:12px;margin-bottom:12px;font-size:12px">';
  h += '<span style="color:var(--err)">' + (d.critical||0) + ' critical</span>';
  h += '<span style="color:var(--warn)">' + (d.high||0) + ' high</span>';
  h += '<span style="color:var(--info)">' + (d.medium||0) + ' medium</span>';
  h += '<span style="color:var(--t3)">' + (d.low||0) + ' low</span>';
  h += '</div>';
  files.slice(0, 20).forEach(function(f) {
    var pct = Math.min(100, f.score);
    var color = f.risk === "critical" ? "var(--err)" : f.risk === "high" ? "var(--warn)" : f.risk === "medium" ? "var(--info)" : "var(--t4)";
    h += '<div style="margin-bottom:8px">';
    h += '<div class="hs-file" style="font-size:12px;color:var(--t1)">' + esc(f.file) + '</div>';
    h += '<div class="hs-bar"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div></div>';
    h += '<div style="font-size:11px;color:var(--t3);display:flex;gap:8px;margin-top:2px">';
    h += '<span class="risk-badge risk-' + f.risk + '">' + f.risk + ' ' + f.score + '</span>';
    if (f.raw) {
      h += '<span>comp ' + (f.dimensions?.complexity||0) + '</span>';
      h += '<span>churn ' + (f.dimensions?.churn||0) + '</span>';
      h += '<span>impact ' + (f.dimensions?.impact||0) + '</span>';
      h += '<span>coupling ' + (f.dimensions?.coupling||0) + '</span>';
    }
    h += '</div></div>';
  });
  pane.innerHTML = h;
  addFileClickHandlers(pane);
}

/* ── Tab: Owners ── */
function renderOwners(pane, data) {
  var files = data.files || [];
  var h = '<div style="font-size:12px;margin-bottom:12px">' + data.teamSize + ' author(s) across ' + files.length + ' files</div>';
  var hot = data.hotBusFactor || [];
  if (hot.length > 0) {
    h += '<div style="font-size:12px;font-weight:500;color:var(--t1);margin-bottom:6px">Knowledge Risk (bus factor 1 + high blast radius)</div>';
    hot.forEach(function(f) {
      h += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">';
      h += '<span style="color:var(--err)">&#9888;</span>';
      h += '<span class="hs-file" style="color:var(--t1)">' + esc(f.file) + '</span>';
      h += '<span style="color:var(--t3)">bus factor ' + f.busFactor + ' &middot; ' + f.blastRadius + ' dep(s)</span>';
      h += '</div>';
    });
    h += '<div style="height:12px"></div>';
  }
  var busiest = data.busiestAuthors || [];
  if (busiest.length > 0) {
    h += '<div style="font-size:12px;font-weight:500;color:var(--t1);margin-bottom:6px">Team Distribution</div>';
    var maxF = busiest[0]?.files || 1;
    busiest.forEach(function(a) {
      var pct = Math.round((a.files / maxF) * 100);
      h += '<div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:12px">';
      h += '<div style="width:120px;height:6px;background:var(--s2);border-radius:3px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:var(--ac);border-radius:3px"></div></div>';
      h += '<span style="color:var(--t1)">' + esc(a.name) + '</span>';
      h += '<span style="color:var(--t3)">(' + a.files + ' files)</span>';
      h += '</div>';
    });
  }
  pane.innerHTML = h;
  addFileClickHandlers(pane);
}

/* ── Tab: Secrets ── */
function renderSecrets(pane, data) {
  var issues = data.issues || [];
  if (issues.length === 0) {
    pane.innerHTML = '<div style="color:var(--ok);font-size:12px;padding:8px 0">&#10003; No security issues detected</div>';
    return;
  }
  var h = '<div style="font-size:12px;color:var(--err);margin-bottom:8px">' + issues.length + ' issue(s) found</div>';
  if (data.framework) h += '<div style="font-size:11px;color:var(--t3);margin-bottom:8px">Framework: ' + esc(data.framework) + '</div>';
  issues.forEach(function(issue) {
    var color = issue.severity === "critical" ? "var(--err)" : issue.severity === "warning" ? "var(--warn)" : "var(--t3)";
    var icon = issue.severity === "critical" ? "&#10007;" : "&#9888;";
    h += '<div style="display:flex;gap:8px;padding:6px 0;font-size:12px;border-bottom:1px solid var(--s2)">';
    h += '<span style="color:' + color + '">' + icon + '</span>';
    h += '<div>';
    h += '<div style="color:var(--t1)">' + esc(issue.message) + '</div>';
    h += '<div style="font-size:11px;color:var(--t3)">' + issue.category + (issue.file ? ' &middot; ' + esc(issue.file) : '') + '</div>';
    h += '</div></div>';
  });
  pane.innerHTML = h;
}

/* ── Tab: Debt ── */
function renderDebt(pane, data) {
  var dims = data.dimensions || [];
  var score = data.score || 0;
  var grade = data.grade || "?";
  var gradeColor = score <= 20 ? "var(--ok)" : score <= 35 ? "var(--warn)" : "var(--err)";

  var h = '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:16px">';
  h += '<span style="font-size:24px;font-weight:700;color:' + gradeColor + '">' + score + '/100</span>';
  h += '<span style="font-size:14px;color:' + gradeColor + '">(' + grade + ')</span>';
  h += '</div>';

  dims.forEach(function(d) {
    var pct = Math.min(100, d.score);
    var color = d.score <= 15 ? "var(--ok)" : d.score <= 35 ? "var(--warn)" : d.score >= 60 ? "var(--err)" : "var(--info)";
    h += '<div style="margin-bottom:10px">';
    h += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--t1)">' + esc(d.name) + '</span><span style="color:' + color + '">' + d.score + '/100</span></div>';
    h += '<div class="hs-bar"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div></div>';
    h += '<div style="font-size:11px;color:var(--t3)">' + esc(d.details) + '</div>';
    h += '</div>';
  });

  var contribs = data.topContributors || [];
  if (contribs.length > 0) {
    h += '<div style="margin-top:16px;font-size:12px;color:var(--t1);font-weight:600;margin-bottom:8px">Top contributors</div>';
    contribs.slice(0, 10).forEach(function(c) {
      h += '<div style="padding:4px 0;border-bottom:1px solid var(--s2);font-size:12px">';
      h += '<span class="hs-file" style="color:var(--ac)">' + esc(c.file) + '</span>';
      h += ' <span style="color:var(--t3)">debt ' + c.debt + '</span>';
      h += '<div style="font-size:11px;color:var(--t3)">' + c.reasons.slice(0, 2).map(esc).join(", ") + '</div>';
      h += '</div>';
    });
  }

  if (data.trend && data.trend.snapshots && data.trend.snapshots.length > 1) {
    var dir = data.trend.direction;
    var arrow = dir === "improving" ? "\\u2193" : dir === "worsening" ? "\\u2191" : "\\u2192";
    var trendColor = dir === "improving" ? "var(--ok)" : dir === "worsening" ? "var(--err)" : "var(--t3)";
    h += '<div style="margin-top:12px;font-size:12px;color:' + trendColor + '">' + arrow + ' ' + dir + ' (' + (data.trend.delta > 0 ? "+" : "") + data.trend.delta + ' since previous)</div>';
  }

  pane.innerHTML = h;
  addFileClickHandlers(pane);
}

/* ── Tab: Deps ── */
function renderDeps(pane, data) {
  var deps = data.dependencies || [];
  if (deps.length === 0) { pane.innerHTML = '<div class="pane-empty">No external dependencies</div>'; return; }

  var d = data.riskDistribution || {};
  var h = '<div style="display:flex;gap:12px;margin-bottom:4px;font-size:12px">';
  h += '<span style="color:var(--err)">' + (d.critical||0) + ' critical</span>';
  h += '<span style="color:var(--warn)">' + (d.high||0) + ' high</span>';
  h += '<span style="color:var(--info)">' + (d.medium||0) + ' medium</span>';
  h += '<span style="color:var(--t3)">' + (d.low||0) + ' low</span>';
  h += '</div>';
  h += '<div style="font-size:11px;color:var(--t3);margin-bottom:12px">' + data.totalPackages + ' packages, ' + deps.length + ' total deps</div>';

  var phantoms = data.phantoms || [];
  if (phantoms.length > 0) {
    h += '<div style="font-size:12px;color:var(--warn);margin-bottom:12px">' + phantoms.length + ' phantom dep(s) declared but not imported</div>';
  }

  var maxCount = deps.length > 0 ? deps[0].usageCount : 1;
  deps.slice(0, 25).forEach(function(dep) {
    var pct = Math.min(100, Math.round((dep.usageCount / maxCount) * 100));
    var color = dep.risk === "critical" ? "var(--err)" : dep.risk === "high" ? "var(--warn)" : dep.risk === "medium" ? "var(--info)" : "var(--t4)";
    var cat = dep.category === "builtin" ? ' <span style="color:var(--t4)">[builtin]</span>' : dep.category === "system" ? ' <span style="color:var(--t4)">[system]</span>' : "";
    h += '<div style="margin-bottom:6px">';
    h += '<div style="font-size:12px"><span style="color:var(--t1)">' + esc(dep.name) + '</span>' + cat + ' <span style="color:var(--t3)">' + dep.usageCount + ' file(s), ' + dep.penetration + '%</span></div>';
    h += '<div class="hs-bar"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div></div>';
    h += '</div>';
  });

  pane.innerHTML = h;
}

/* ── Review badge ── */
function updateReviewBadge() {
  fetch(API + "/review").then(function(r) { return r.json(); }).then(function(data) {
    var badge = q("#review-badge");
    var label = q("#review-label");
    if (!data.verdict) return;
    var level = data.verdict.level;
    var colors = { ship: "var(--ok)", review: "var(--warn)", hold: "var(--err)" };
    var bgColors = { ship: "var(--okbg)", review: "var(--warnbg)", hold: "var(--errbg)" };
    var icons = { ship: "\\u2713", review: "\\u26A0", hold: "\\u2717" };
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.gap = "4px";
    badge.style.background = bgColors[level] || "var(--s2)";
    badge.style.color = colors[level] || "var(--t2)";
    var text = (icons[level] || "") + " " + level.toUpperCase();
    if (data.changedFiles && data.changedFiles.length > 0) {
      text += " \\u00B7 " + data.changedFiles.length + " changed";
    }
    label.textContent = text;
    badge.title = data.verdict.reasons ? data.verdict.reasons.join("\\n") : "";
  }).catch(function() {});
}

function addFileClickHandlers(container) {
  container.querySelectorAll(".hs-file").forEach(function(el) {
    el.style.cursor = "pointer";
    el.addEventListener("click", function() {
      var text = el.textContent.trim();
      var node = null;
      state.nodes.forEach(function(n) {
        if (n.file === text || n.file.indexOf(text) >= 0) node = n;
      });
      if (node) selectFile(node.file);
    });
  });
}

/* ── Search ── */
function initSearch() {
  var input = q("#search");
  var drop = q("#search-drop");
  var activeIdx = -1;

  input.addEventListener("input", function() {
    var val = input.value.toLowerCase().trim();
    if (!val) {
      drop.classList.remove("open");
      clearHighlight();
      return;
    }

    var matches = state.nodes.filter(function(n) { return n.file.toLowerCase().indexOf(val) >= 0; }).slice(0, 15);

    if (matches.length === 0) {
      drop.classList.remove("open");
      clearHighlight();
      return;
    }

    var h = '';
    matches.forEach(function(n, i) {
      var color = nodeColor(n);
      h += '<div class="search-item' + (i === activeIdx ? ' active' : '') + '" data-file="' + esc(n.file) + '">';
      h += '<div class="search-item-dot" style="background:' + color + '"></div>';
      h += '<span class="search-item-path">' + esc(baseName(n.file)) + '</span>';
      h += '<span class="search-item-dir">' + esc(dirOf(n.file)) + '</span>';
      h += '</div>';
    });
    drop.innerHTML = h;
    drop.classList.add("open");
    activeIdx = -1;

    var matchedIds = {};
    matches.forEach(function(n) { matchedIds[n.id] = true; });
    d3.select("#graph").classed("dimmed", true);
    state.gNode.classed("hl", function(n) { return matchedIds[n.id]; });
    state.gLink.classed("hl", function(l) { return matchedIds[l.source.id] || matchedIds[l.target.id]; });
  });

  input.addEventListener("keydown", function(e) {
    var items = drop.querySelectorAll(".search-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      items.forEach(function(el, i) { el.classList.toggle("active", i === activeIdx); });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      items.forEach(function(el, i) { el.classList.toggle("active", i === activeIdx); });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && items[activeIdx]) {
        var file = items[activeIdx].getAttribute("data-file");
        input.value = "";
        drop.classList.remove("open");
        clearHighlight();
        selectFile(file);
        centerOnFile(file);
      }
    } else if (e.key === "Escape") {
      input.value = "";
      drop.classList.remove("open");
      clearHighlight();
      input.blur();
    }
  });

  drop.addEventListener("click", function(e) {
    var item = e.target.closest(".search-item");
    if (item) {
      var file = item.getAttribute("data-file");
      input.value = "";
      drop.classList.remove("open");
      clearHighlight();
      selectFile(file);
      centerOnFile(file);
    }
  });

  input.addEventListener("blur", function() {
    setTimeout(function() { drop.classList.remove("open"); }, 200);
  });
}

function centerOnFile(file) {
  var nd = null;
  state.nodes.forEach(function(n) { if (n.file === file) nd = n; });
  if (!nd || nd.x === undefined) return;
  var svg = d3.select("#graph");
  var w = q("#canvas").clientWidth;
  var h = q("#canvas").clientHeight;
  var scale = 1.5;
  var tx = w/2 - nd.x * scale;
  var ty = h/2 - nd.y * scale;
  svg.transition().duration(600)
    .call(state.zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

/* ── Zoom Controls ── */
function initZoom() {
  var svg = d3.select("#graph");

  q("#z-in").addEventListener("click", function() {
    svg.transition().duration(300).call(state.zoomBehavior.scaleBy, 1.4);
  });
  q("#z-out").addEventListener("click", function() {
    svg.transition().duration(300).call(state.zoomBehavior.scaleBy, 0.7);
  });
  q("#z-fit").addEventListener("click", fitToScreen);
}

function fitToScreen() {
  if (!state.nodes.length) return;
  var w = q("#canvas").clientWidth;
  var h = q("#canvas").clientHeight;
  var xs = state.nodes.map(function(n){return n.x||0;});
  var ys = state.nodes.map(function(n){return n.y||0;});
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  var gw = (maxX - minX) || 1;
  var gh = (maxY - minY) || 1;
  var pad = 60;
  var scale = Math.min((w - pad*2) / gw, (h - pad*2) / gh, 3);
  var tx = w/2 - ((minX + maxX) / 2) * scale;
  var ty = h/2 - ((minY + maxY) / 2) * scale;
  d3.select("#graph").transition().duration(500)
    .call(state.zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

/* ── Keyboard Shortcuts ── */
function initKeyboard() {
  document.addEventListener("keydown", function(e) {
    if (e.target.tagName === "INPUT") return;

    if (e.key === "/") {
      e.preventDefault();
      q("#search").focus();
    } else if (e.key === "Escape") {
      clearHighlight();
      hideDetail();
      q("#search").value = "";
      q("#search-drop").classList.remove("open");
    } else if (e.key === "0") {
      fitToScreen();
    } else if (e.key === "+" || e.key === "=") {
      d3.select("#graph").transition().duration(200).call(state.zoomBehavior.scaleBy, 1.3);
    } else if (e.key === "-") {
      d3.select("#graph").transition().duration(200).call(state.zoomBehavior.scaleBy, 0.7);
    } else if (e.key === "[") {
      q("#sidebar").classList.toggle("collapsed");
    } else if (e.key === "]") {
      var det = q("#detail");
      if (det.classList.contains("open")) hideDetail();
    }
  });
}

/* ── Sidebar Toggle ── */
function initSidebarToggle() {
  q("#sidebar-toggle").addEventListener("click", function() {
    q("#sidebar").classList.toggle("collapsed");
  });
  q("#detail-close").addEventListener("click", function() {
    clearHighlight();
    hideDetail();
  });
}

/* ── Boot ── */
async function main() {
  await loadCore();

  q("#splash").classList.add("hidden");
  setTimeout(function() { q("#splash").style.display = "none"; }, 400);

  processGraphData();
  renderHeader();
  renderSidebar();
  initGraph();
  initBottom();
  initSearch();
  initZoom();
  initKeyboard();
  initSidebarToggle();

  loadTabIfNeeded("overview");

  setTimeout(fitToScreen, 800);
  startLivePolling();
}

/* ── Live Polling ── */
var liveState = { lastChangeAt: 0, polling: true, timer: null };

function startLivePolling() {
  liveState.timer = setInterval(pollForChanges, 3000);
}

function pollForChanges() {
  if (!liveState.polling) return;
  fetchJSON("/status").then(function(status) {
    if (!status || !status.lastChangeAt) return;
    if (liveState.lastChangeAt === 0) {
      liveState.lastChangeAt = status.lastChangeAt;
      return;
    }
    if (status.lastChangeAt > liveState.lastChangeAt) {
      liveState.lastChangeAt = status.lastChangeAt;
      onFileChanged(status.lastChangeFile);
    }
  });
}

function onFileChanged(file) {
  var label = file ? baseName(file) : "project";
  showToast("Updated: " + label);
  refreshData();
}

function refreshData() {
  loadCore().then(function() {
    renderHeader();

    var oldNodeCount = state.nodes.length;
    processGraphData();

    if (state.nodes.length !== oldNodeCount) {
      renderSidebar();
      rebuildGraph();
    }

    q("#canvas-info").textContent = state.nodes.length + " files, " + state.links.length + " edges";

    state.tabLoaded = {};
    var activeTab = q(".tab.active");
    if (activeTab) {
      var name = activeTab.getAttribute("data-tab");
      if (name) loadTabIfNeeded(name);
    }

    if (state.selectedFile) {
      showDetail(state.selectedFile);
    }

    updateReviewBadge();
  });
}

function rebuildGraph() {
  if (state.sim) state.sim.stop();
  initGraph();
}

function showToast(msg) {
  var t = q("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(function() { t.classList.remove("show"); }, 2500);
}

main().catch(function(err) {
  document.body.innerHTML =
    '<div style="padding:60px;text-align:center">' +
    '<div style="font-size:20px;font-weight:700;letter-spacing:4px;color:#eaecf3;margin-bottom:12px">I M P U L S E</div>' +
    '<div style="color:#f87171;font-size:14px">Failed to connect to daemon at port ${port}</div>' +
    '<div style="color:#626780;font-size:13px;margin-top:8px">Start with: <code style="color:#6c8aff">impulse daemon .</code></div>' +
    '</div>';
});
<\/script>
</body>
</html>`;
}
