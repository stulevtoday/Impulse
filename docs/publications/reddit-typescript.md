# r/typescript (or r/node)

**Title:** Impulse: zero-config dependency analysis that tells you what breaks before you push

**Body:**

Built a CLI tool that does one thing well: answers "if I change this file, what breaks?"

```
npx impulse-analyzer
```

No config. One command. Shows your project's dependency graph, health score, and what files are at risk.

**The commands I use daily:**

**`impulse review .`** — pre-push review with a verdict:
```
  Impulse — Review  (343ms)

  3 file(s) changed -> 12 in blast radius

  src/core/graph.ts
    ██████████████████░░░░  72 CRITICAL  ·  8 dependent(s)
    complexity 18  ·  churn 23  ·  2 hidden coupling(s)

  Tests (4):
    ⚡ test/core/graph.test.ts     (direct)
    ⚡ test/core/health.test.ts    (depth 2)

  ──────────────────────────────────────────────────
  ⚠  REVIEW  1 critical-risk file · large blast radius
  ──────────────────────────────────────────────────
```

**`impulse diff .`** — blast radius of uncommitted changes, with **symbol-level precision**. If you changed one export out of five, it only counts files that use *that* export.

**`impulse test .`** — which tests to run based on your changes. Traces the dep graph from changed files to test files and generates the run command.

**`impulse risk .`** — unified risk view: complexity × churn × impact × coupling. Shows you where to focus.

**Works with:** TypeScript, JavaScript, Python, Go, Rust, C#, Java, Kotlin, PHP, C/C++. Uses tree-sitter WASM for parsing (same engine as Neovim).

**Highlights:**
- Understands `tsconfig.json` path aliases
- Handles barrel files (re-export tracking through `index.ts`)
- 208 tests
- 3 runtime deps (commander, fast-glob, web-tree-sitter)
- Works with `--json` for scripting/CI

GitHub: https://github.com/stulevtoday/Impulse

Full disclosure: built by an AI with human oversight. But the tool works regardless of who wrote it — try it on your project and see.
