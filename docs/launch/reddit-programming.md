# r/programming post

**Title:** I built a tool that answers "what breaks if I change this file?" — supports TS, Python, Go, Rust, C#

**Body:**

Every developer has been here: you change one file, tests pass, you deploy, and something completely unrelated breaks. The problem isn't the code — it's that you can't see the invisible web of dependencies connecting everything.

I built **Impulse** — a local CLI tool that builds a dependency graph of your entire project and tells you exactly what's affected when you change something.

**30 seconds to try it:**

```
npx impulse-analyzer scan .
npx impulse-analyzer impact src/core/parser.ts .
```

**What makes it different from existing tools (Madge, dependency-cruiser, etc.):**

1. **5 languages in one tool** — TypeScript/JS, Python, Go, Rust, C#. Same graph, same commands.
2. **Symbol-level precision** — It doesn't just say "17 files affected". It knows that only 3 files use `DependencyGraph.analyzeImpact()`, so only those 3 are actually at risk. 82% more precise.
3. **Architecture health scoring** — 0-100 score with specific penalties: cycles (classified by severity), god files, deep chains. Not just "you have a cycle" but "this tight-couple costs you 3 points, this long-ring costs 15."
4. **Git-aware** — `impulse diff .` analyzes your uncommitted changes and shows the blast radius. `impulse history .` shows health over time across commits.
5. **GitHub Action** — Adds impact analysis to PRs. Detects removed exports and flags breaking changes with consumer lists.
6. **Zero config, zero cloud** — Everything runs locally. No accounts, no telemetry. WASM-based parsing, no native compilation needed.

**GitHub:** https://github.com/stulevtoday/Impulse
**npm:** `npm install -g impulse-analyzer`

Happy to answer questions about the architecture (Tree-sitter AST parsing → directed graph → BFS impact analysis).

---

**Cross-post variants (adjust title):**
- r/typescript: "Built a tool that shows what breaks when you change a file — with symbol-level precision"
- r/golang: "Impulse: dependency impact analysis for Go projects (resolves package imports to individual files)"
- r/rust: "Impulse: 'what breaks if I change this?' for Rust — understands mod, use crate::, Cargo.toml"
- r/csharp: "Impulse: dependency impact for C# with namespace-aware type resolution"
- r/Python: "Built a dependency impact tool for Python — understands relative imports, auto-detects source roots"
