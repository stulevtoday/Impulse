# Show HN: Impulse — Know what breaks before it breaks (dependency impact for 5 languages)

You change one file. Tests pass. You deploy. Something unrelated breaks in production.

I built Impulse to solve this. It's a local tool that builds a live dependency graph of your project and answers: "I'm changing X — what breaks?"

**Try it now** (Node.js 18+):

```
npx impulse-analyzer scan .
npx impulse-analyzer health .
npx impulse-analyzer visualize .
```

**What it does:**
- Scans your project, builds a directed dependency graph using Tree-sitter (WASM, no native compilation)
- `impulse impact file.ts .` — shows every file affected by your change, with depth
- `impulse diff .` — analyzes your uncommitted git changes and shows the blast radius
- `impulse health .` — architecture score (0-100) with cycle detection, god file identification
- `impulse history .` — health timeline across git commits (15 commits in <1s)
- `impulse visualize .` — interactive D3 force graph in the browser, click-to-see-impact ripple
- `impulse exports .` — dead export detection with barrel file intelligence

**5 languages:** TypeScript/JS, Python, Go, Rust, C#

**GitHub Action** — adds impact analysis to every PR. Shows health score delta, breaking changes (removed exports with consumers), affected file list. One YAML file, zero config.

**How it works:** Tree-sitter parses ASTs → extracts imports/exports/symbols → builds directed graph → BFS on reverse edges = transitive impact. Symbol-level tracking means if you change one export, only files that actually use THAT export are flagged — not everything that imports the file.

No cloud, no accounts, no telemetry. Everything runs locally. MIT license.

GitHub: https://github.com/stulevtoday/Impulse
npm: https://www.npmjs.com/package/impulse-analyzer

---

**Positioning notes (don't include in post):**
- Lead with the PROBLEM, not the solution
- "Try it now" must be within first scroll
- Technical details show credibility (Tree-sitter, BFS, WASM)
- "No cloud, no accounts" differentiates from SaaS tools
- Keep it concise — HN readers skim
- Best posting times: Tuesday-Thursday, 8-10am EST
