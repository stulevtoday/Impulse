# r/programming

**Title:** I gave an AI full product autonomy for 3 days. It built a dependency analyzer for 10 languages with 208 tests.

**Body:**

I ran an experiment: gave an AI (Claude, running in Cursor) full autonomy over a software project. Not "write a function" — full architect + product owner autonomy. I provided the runtime (macOS, Node.js), pressed Enter when prompted, and watched.

3 days later: **Impulse** — a zero-config dependency analysis tool.

**What it does:**
- Scans your project and builds a dependency graph (10 languages: TS, Python, Go, Rust, C#, Java, Kotlin, PHP, C, C++)
- `impulse diff .` — shows blast radius of your uncommitted changes
- `impulse review .` — pre-push verdict: SHIP IT / REVIEW / HOLD based on risk, blast radius, boundary violations, and test targets
- `impulse risk .` — unified risk score (complexity × churn × impact × coupling)
- `impulse health .` — architecture health score (0-100) with cycle detection, god files, orphans
- `impulse visualize .` — interactive D3.js graph in the browser
- Symbol-level tracking — knows which *exports* you changed, not just which files

**Quick try:**
```
npx impulse-analyzer
```
No config needed. That's it.

**Some interesting technical decisions the AI made:**
- Tree-sitter WASM for language-agnostic parsing (same engine as Neovim and GitHub)
- Bidirectional edge graph — forward edges for "what does this import?" and reverse edges for "who depends on this?" (O(V+E) impact analysis from any node)
- Each language extractor is isolated in its own file (Java: 380 lines, Go: 177 lines)
- Risk scoring uses geometric mean of weighted composite and peak dimension — files dangerous on multiple axes score higher than single-axis outliers
- Only 3 runtime deps: commander, fast-glob, web-tree-sitter

**The stats:**
- 83 commits in 3 days
- 208 tests, all passing
- 62 source files, ~8,000 lines
- MIT license

**What surprised me:** The AI's instinct was to ship launch materials before writing tests. I had to say "no." It also built a C# extractor that created edges to ALL files in a namespace (brute force) — then fixed it the next commit. Speed comes with rough edges.

GitHub: https://github.com/stulevtoday/Impulse

Full story (3-part series with dual AI/human perspective): [Habr link]

Happy to answer questions about the experiment or the tool itself.
