<p align="center">
  <br>
  <strong>I M P U L S E</strong>
  <br>
  <em>Know what breaks before it breaks.</em>
  <br>
  <br>
  <img src="https://img.shields.io/badge/languages-8-5b7fff?style=flat-square" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-4ade80?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-888?style=flat-square" />
  <img src="https://img.shields.io/badge/built_by-an_AI_named_Pulse-ff6b8a?style=flat-square" />
  <br>
  <br>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat-square&logo=go&logoColor=white" />
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" />
  <img src="https://img.shields.io/badge/C%23-512BD4?style=flat-square&logo=csharp&logoColor=white" />
  <img src="https://img.shields.io/badge/Java-ED8B00?style=flat-square&logo=openjdk&logoColor=white" />
  <img src="https://img.shields.io/badge/Kotlin-7F52FF?style=flat-square&logo=kotlin&logoColor=white" />
  <img src="https://img.shields.io/badge/PHP-777BB4?style=flat-square&logo=php&logoColor=white" />
  <img src="https://img.shields.io/badge/C-A8B9CC?style=flat-square&logo=c&logoColor=black" />
  <img src="https://img.shields.io/badge/C++-00599C?style=flat-square&logo=cplusplus&logoColor=white" />
</p>

---

You change one file. Tests pass. You deploy. Something unrelated breaks in production.

Sound familiar?

**Impulse** sees what you can't — the invisible web of dependencies across your entire codebase. Change a file, and Impulse instantly tells you every other file that could be affected, how deep the impact goes, and which exports are actually used.

10 languages. Zero config. Runs locally. No cloud, no accounts, no telemetry.

```
  impulse diff .

  Changed files (1):
    ● src/core/graph.ts

  Affected files (15):
    → src/core/analyzer.ts      (direct)
    → src/core/cache.ts         (direct)
    → src/server/index.ts       (direct)
      → src/cli/index.ts        (depth 2)
    ...
```

## 30 seconds to try it

```bash
npx impulse-analyzer
```

That's it. One command, no config. You get an instant project overview:

```
  I M P U L S E

  42 files  ·  TypeScript  ·  87/100 (B)  ·  112ms
  No structural issues

  Most depended on:
    src/core/graph.ts  ← 24 files
    src/core/parser.ts  ← 10 files

  Try:
    impulse impact src/core/graph.ts .   what breaks if you change this?
    impulse health .                     full architecture report
    impulse visualize .                  interactive graph in browser
```

Then the fun part:

```bash
npx impulse-analyzer visualize .
```

Your browser opens. You see your entire project as a living, breathing graph. Click a file — a ripple wave shows you exactly how far your change would travel.

### Install globally

```bash
npm install -g impulse-analyzer
impulse scan .
```

## What can it do?

| Command | What it does |
|---|---|
| `scan .` | Build dependency graph, show stats |
| `impact file.ts .` | "I'm changing this — what breaks?" |
| `diff .` | Impact of your **uncommitted git changes** |
| `health .` | Architecture score (0-100) with stability metrics |
| `doctor .` | **Full diagnostic** — health, hotspots, dead exports, coupling, suggestions in one report |
| `tree file.ts .` | Dependency tree (like `cargo tree`) — forward or `--reverse` |
| `safe-delete file.ts .` | "Can I safely delete this file?" — verdict + recommendations |
| `compare branch .` | Compare architecture health between branches |
| `exports .` | Find dead exports nobody imports |
| `visualize .` | **Live dashboard** in the browser — auto-updates on file changes |
| `watch .` | Real-time impact on every file save |
| `daemon .` | HTTP API for IDE/tool integration |
| `why A.ts B.ts .` | Show the dependency chain between two files |
| `explore .` | Interactive terminal REPL |
| `history .` | Health timeline across git commits |
| `suggest .` | Actionable refactoring suggestions |
| `check .` | Validate architecture boundaries |
| `init .` | Auto-detect boundaries, create config |
| `hotspots .` | High-risk files — change often AND affect many |
| `test .` | Which tests to run based on your changes |
| `coupling .` | Find hidden coupling — co-change without imports |
| `complexity .` | Cyclomatic + cognitive complexity per function across all files |
| `risk .` | **Unified risk** — complexity × churn × impact × coupling in one view |
| `refactor .` | **Auto-refactor** — remove dead exports with `--dry-run` preview |
| `focus file.ts .` | Deep X-ray of a single file |
| `graph . --format mermaid` | Export dependency graph as **Mermaid**, DOT, or JSON |
| `badge .` | Generate SVG health badge for your README |
| `env .` | Find undefined/unused environment variables |
| `ci .` | Preview the CI report locally |

Every analysis command supports `--json` for scripting:

```bash
impulse health . --json | jq '.score'
```

## Languages

| Language | What Impulse understands |
|---|---|
| **TypeScript / JavaScript** | `import`, `require()`, dynamic imports, re-exports, `tsconfig.json` path aliases |
| **Python** | `import` / `from...import`, relative imports, auto source root detection |
| **Go** | Package imports resolved to files via `go.mod` |
| **Rust** | `mod` declarations, `use crate::`/`super::`/`self::`, `Cargo.toml` deps |
| **C#** | Namespace resolution with type-aware matching, `.csproj` detection |
| **Java** | Package imports, wildcard imports, static imports, public type exports |
| **Kotlin** | Package imports, wildcard imports, data/sealed/object classes, top-level functions, JVM interop |
| **PHP** | `use` statements (simple, grouped, aliased), PSR-4 autoloading via `composer.json`, class/interface/trait/enum exports |
| **C** | `#include "local.h"` resolution (relative + root), `<system.h>` as external, function/struct/typedef/enum exports |
| **C++** | Everything from C plus class/namespace/template declarations, lambda expressions |

## Architecture health

Impulse doesn't just map dependencies — it judges them.

```
  Score: 87/100 (B)
  1 god file(s), max chain depth 8

  Penalties:
    God files:         -5
    Deep chains:       -8
```

It finds circular dependencies and classifies them by severity:
- **tight-couple** (A ↔ B) — common pattern, mild penalty
- **short-ring** (A → B → C → A) — worth investigating
- **long-ring** (5+ files) — architectural problem

With boundaries configured (`.impulserc.json`), health also includes **module stability metrics** — instability index per module and Stable Dependencies Principle validation:

```
  Module Stability (Stable Dependencies Principle)

    core      ████████████████████  I=0.00  (maximally stable)
    watchers  ████████░░░░░░░░░░░░  I=0.60
    server    ██░░░░░░░░░░░░░░░░░░  I=0.91
    cli       ░░░░░░░░░░░░░░░░░░░░  I=1.00  (maximally unstable)

    ✓ Dependencies flow toward stability.
```

## Hotspot detection

Find high-risk files — they change frequently AND affect many files:

```
  impulse hotspots .

  ████████████████████  src/core/parser.ts
  9 changes · 16 affected · score 34 · MEDIUM

  ██████████████████░░  src/core/graph.ts
  6 changes · 25 affected · score 31 · MEDIUM
```

Combines git change frequency with dependency impact analysis. Files that change often AND have large blast radius are architectural risks worth addressing first.

## Smart test targeting

Changed a file? Impulse tells you exactly which tests to run — and why:

```
  impulse test .

  Impulse — Test Targeting
  3 changed file(s) → 5 test(s) to run  (142ms)

  Affected tests (5):

    test/core/health.test.ts
      ← src/core/health.ts
      (direct via src/core/health.ts)

    test/core/suggest.test.ts
      ← src/core/health.ts
      (direct via src/core/health.ts)

    test/integration.test.ts
      ← src/core/health.ts ← src/core/analyzer.ts
      (depth 2 via src/core/health.ts)
    ...

  Run:  node --test 'test/core/health.test.ts' 'test/core/suggest.test.ts' ...
```

Traces the dependency graph from your changes to every test that could be affected. Auto-detects the test runner (node --test, pytest, go test) and generates the command.

```bash
impulse test . --run       # find AND run the tests
impulse test . --staged    # only staged changes
impulse test . --json      # for CI pipelines
```

## Temporal coupling

Find hidden coupling — files that change together in git but have no import relationship:

```
  impulse coupling .

  Hidden coupling — co-change in git, NO import relationship:

  █████████████████░░░  83%  (5 co-changes)
    src/core/extractor.ts
    src/core/scanner.ts

  ████████████████░░░░  80%  (8 co-changes)
    src/core/extractor.ts
    src/core/parser.ts
```

If two files always change together but have no dependency — there's a shared concept your architecture doesn't reflect. This is the kind of coupling that static analysis, linters, and tests will never catch.

```bash
impulse coupling . --all          # include confirmed coupling too
impulse coupling . --min-ratio 0.5  # stricter threshold
```

## Complexity analysis

Cyclomatic and cognitive complexity for every function, across all 10 languages:

```
  impulse complexity .

  Impulse — Complexity Analysis
  84 files, 367 functions analyzed

  ████████████████████  src/ci/index.ts → generateReport
  317 lines · cyclomatic 58 · cognitive 144 · ALARMING

  ████████░░░░░░░░░░░░  src/cli/dashboard.ts → runDashboard
  112 lines · cyclomatic 30 · cognitive 56 · ALARMING

  Distribution
  simple    █████████████████        260 (71%)
  moderate  ███                       53 (14%)
  complex   ███                       41 (11%)
  alarming  █                         13 (4%)
```

Filter by risk level or set a threshold:

```bash
impulse complexity . --risk alarming    # only show alarming functions
impulse complexity . --threshold 15     # cognitive > 15
impulse complexity . --json             # machine-readable output
```

## Risk analysis

The killer question: **"Where should I focus right now?"** — answered by combining all four analysis dimensions into one prioritized list:

```
  impulse risk .

  Impulse — Risk Analysis
  94 files analyzed in 329ms

  ██████████████████████  src/core/extractor.ts
  risk 87/100 · CRITICAL
  comp ▓▓▓▓▓ 100 │ chur ▓▓▓░░ 58 │ impa ▓▓░░░ 48 │ coup ▓▓▓▓▓ 100

  █████████████████████░  src/core/graph.ts
  risk 83/100 · CRITICAL
  comp ▓▓▓▓▓ 100 │ chur ▓▓░░░ 33 │ impa ▓▓▓▓░ 84 │ coup ▓▓░░░ 33

  Summary: 23 critical · 8 high · 13 medium · 50 low
```

Each file is scored across four dimensions:
- **complexity** — cognitive complexity of the most complex function
- **churn** — how frequently the file changes relative to the project
- **impact** — blast radius if this file breaks
- **coupling** — hidden coupling partners (co-change without imports)

Files that are high on *multiple* dimensions are the real danger zones.

```bash
impulse risk . --risk critical   # only show critical files
impulse risk . --json            # machine-readable output
```

## File focus

Everything about one file in a single view:

```
  impulse focus src/core/graph.ts .

  Impulse — Focus: src/core/graph.ts

  Imports   2 local, 0 external
  Imported by  32 file(s)

  Exports  5 total
    ✓ DependencyGraph  → 24 consumer(s)
    ✓ GraphNode        → 10 consumer(s)
    ✓ GraphEdge        → 8 consumer(s)

  Blast radius  39 file(s)
    ███████████████ 25  (direct)
    ████████ 14         (depth 2)

  Test coverage  9 test(s)
    ⚡ test/core/graph.test.ts
    ⚡ test/core/health.test.ts
    ...

  Git  8 change(s), last 4 minutes ago
```

Imports, dependents, exports, blast radius, test coverage, git history, co-changers — one command, full picture.

## Health timeline

See how your architecture evolved over time:

```
  impulse history .

   90 ┤
      │                  ●  ●  ●  ●  ●  ●  ●  ●  ●
      │
   85 ┤
      │
      │●  ●  ●  ●  ●  ●
   79 ┤──────────────────────────────────────────────

  Current:  82/100 (B)
  Best:     87/100 (B)  ← 59498e5  feat: add totalExports
  Worst:    82/100 (B)  ← c9fb3d4  feat: VS Code extension
  Trend:    ↘ -5 over 15 commits

  Significant changes:
    ▼ -5  6e62e29  feat: symbol-level precision in impulse diff
```

Analyzes every commit via git worktree. 15 commits in under a second.

## Dead export detection

```
  src/core/cache.ts  (3 exports, 1 dead)
    ✓ saveGraphCache  — 1 user(s)
    ✓ loadGraphCache  — 1 user(s)
    ✗ CacheMetadata   — unused

  Total: 79 exports, 15 dead, 20 barrel re-exports
  Dead export rate: 25% (excluding barrels)
```

Barrel files (`index.ts` that only re-export) are detected automatically and excluded from the dead count.

## Architecture boundaries

Define layers in `.impulserc.json`, Impulse enforces the rules:

```json
{
  "boundaries": {
    "core": { "path": "src/core/**", "allow": [] },
    "cli": { "path": "src/cli/**", "allow": ["core", "server"] },
    "server": { "path": "src/server/**", "allow": ["core"] }
  }
}
```

```bash
impulse check .
```

```
  Boundaries:
    core    (src/core/**)    18 files  clean
    cli     (src/cli/**)      5 files  clean
    server  (src/server/**)   2 files  1 violation(s)

  ✗ 1 violation(s):

    src/server/index.ts  →  src/cli/utils.ts
      server cannot import from cli
```

Auto-detect boundaries from your project structure:

```bash
impulse init .
```

```
  Impulse Init  (42 files found)

  Detected 5 boundaries:

    core      src/core/**      (no cross-boundary deps)
    cli       src/cli/**       → core, server, watchers
    server    src/server/**    → core, watchers
    watchers  src/watchers/**  → core
    ci        src/ci/**        → core

  Created .impulserc.json
```

Exits with code 1 on violations — works in CI out of the box.

## GitHub Action — Impulse CI

Add impact analysis to every pull request. One file, zero config:

```yaml
# .github/workflows/impulse.yml
name: Impulse CI
on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  impulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: stulevtoday/Impulse@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Every PR gets a comment:

- **Health score delta** — did your changes improve or degrade architecture?
- **Impact table** — which files you changed, how many files each one affects
- **Full affected file list** — every transitive dependent, with depth and cause
- **Breaking changes** — removed exports with active consumers
- **Boundary violations** — if `.impulserc.json` exists, shows which imports cross boundaries
- **New issues** — cycles introduced or resolved, new god files

Optional quality gate:

```yaml
- uses: stulevtoday/Impulse@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    threshold: 70  # fail the PR if health drops below 70
```

Outputs (`score`, `grade`, `delta`, `affected`, `breaking`, `violations`) are available for downstream steps.

## Doctor — full diagnostic

One command, complete picture:

```
  impulse doctor .

  I M P U L S E  —  Doctor
  42 files · TypeScript · 87/100 (B) · 142ms

  ── Health ──────────────────────────────────────
    Score: 87/100 (B)
    1 god file(s), max chain depth 8

  ── Hotspots ────────────────────────────────────
    3 risky files: 1 critical, 2 high

  ── Dead Exports ────────────────────────────────
    15 dead out of 79 exports (19%)

  ── Hidden Coupling ─────────────────────────────
    2 hidden pairs (co-change without imports)

  ── Suggestions ─────────────────────────────────
    5 suggestions (estimated +7 score)

  ── Boundaries ──────────────────────────────────
    ✓ All clean (5 boundaries configured)

  ════════════════════════════════════════════════
  Verdict: GOOD (score 87/100)

  Priority actions:
    ⚡ Fix 1 critical hotspot: parser.ts
    🔧 Split 1 god file to reduce coupling
    🧹 Remove 15 dead exports
```

## Dependency tree

Like `cargo tree` — see the full import chain:

```
  impulse tree src/core/health.ts .

  src/core/health.ts
  ├── src/core/config-types.ts
  ├── src/core/graph.ts
  │   └── src/core/graph-types.ts
  └── src/core/stability.ts
      ├── src/core/boundaries.ts
      └── src/core/config-types.ts (circular ↑)

  5 dependencies (max depth 6)
```

Reverse tree — who depends on this file:

```bash
impulse tree src/core/graph.ts . --reverse -d 2
```

## Safe delete

Before deleting a file, check the consequences:

```
  impulse safe-delete src/core/cache.ts .

  ⚠ CAUTION — 1 importer(s), limited blast radius

  Imported by (1)
    ← src/server/index.ts

  Exports (2 alive, 0 dead)
    ✓ loadGraphCache — 1 consumer(s)
    ✓ saveGraphCache — 1 consumer(s)

  Blast radius: 3 file(s) transitively affected

  Recommendations:
    1. Migrate loadGraphCache consumers: src/server/index.ts
    2. Migrate saveGraphCache consumers: src/server/index.ts
```

Verdicts: **SAFE** / **CAUTION** / **RISKY** / **DANGEROUS** — based on importer count, blast radius, and live exports.

## Branch comparison

See how your branch changed the architecture:

```
  impulse compare origin/main .

  Metric               Current        Target         Delta
  ──────────────────────────────────────────────────────────
  Health score         82 (B)         87 (B)         ▼ -5
  Files                45             42             +3
  Cycles               3              2              +1 new
  God files            2              1              +1 new

  New cycles:
    + src/new/a.ts ↔ src/new/b.ts (tight-couple)

  ▼ Architecture degraded by 5 point(s)
```

## Graph export

Export your dependency graph for documentation:

```bash
impulse graph . --format mermaid --local    # Mermaid diagram for Markdown
impulse graph . --format dot --local        # GraphViz DOT
impulse graph . --format json               # Structured JSON
```

Paste the Mermaid output directly into GitHub Markdown, Notion, or any tool that supports it.

## Health badge

Generate a shields.io-style SVG badge for your README:

```bash
impulse badge . -o badge.svg               # Write to file
impulse badge . --style flat-square         # Flat-square style
```

Or use the daemon as a live badge endpoint: `http://localhost:4096/badge`

## Visualization — Live Dashboard

`impulse visualize .` opens a full-featured dashboard in the browser:

- **Live updates** — auto-refreshes when files change (green LIVE indicator)
- **File sidebar** — grouped by directory, click to navigate
- **Force-directed graph** — nodes colored by directory, sized by connections
- Click a node — **ripple wave** shows impact + **detail panel** opens with full focus data
- **7 analysis tabs** — Overview, Hotspots, Cycles, Dead Exports, Coupling, Suggestions, Boundaries
- **Search with autocomplete** — keyboard navigable (`/` to focus)
- **Zoom controls** — `+`/`-`/fit, or scroll
- **Keyboard shortcuts** — `/` search, `Escape` close, `0` fit, `[` toggle sidebar

## Daemon API

```bash
impulse daemon .
# Listening on http://localhost:4096
```

| Endpoint | Returns |
|---|---|
| `/status` | Ready state, node/edge counts, last change timestamp |
| `/impact?file=path` | Affected files with depth |
| `/graph` | Full node and edge data |
| `/health` | Score, cycles, god files, penalties |
| `/exports?file=path` | Export analysis with usage counts |
| `/suggest` | Actionable refactoring suggestions |
| `/check` | Boundary violations (needs `.impulserc.json`) |
| `/files` | All files sorted by connections |
| `/visualize` | Live dashboard (HTML) |
| `/dependencies?file=` | What this file imports |
| `/dependents?file=` | Who imports this file |
| `/test-targets` | Tests to run based on uncommitted changes |
| `/coupling` | Temporal coupling analysis |
| `/complexity` | Cyclomatic + cognitive complexity per function |
| `/risk` | Unified risk analysis (complexity × churn × impact × coupling) |
| `/focus?file=path` | Deep analysis of a single file |
| `/doctor` | Full diagnostic report |
| `/safe-delete?file=` | Safe deletion analysis with verdict |
| `/export?format=mermaid` | Graph export (mermaid, dot, json) |
| `/badge` | SVG health badge (dynamic) |

## How it works

```
 Your Project          Impulse Engine          You
┌────────────┐    ┌──────────────────┐    ┌──────────┐
│ .ts .py     │───▶│ Tree-sitter AST  │    │ "I'm     │
│ .go .rs     │    │       ↓          │    │  changing │
│ .cs .java   │    │ Extract imports, │───▶│  graph.ts │
│             │    │ exports, symbols │    │  ..."     │
│             │    │       ↓          │    │          │
│             │    │ Impact Analysis  │───▶│ "15 files │
│             │    │ Health Scoring   │    │  will     │
│             │    │ Dead Exports     │    │  break."  │
└────────────┘    └──────────────────┘    └──────────┘
```

**Scanner** → finds source files, respects `.gitignore`
**Parser** → Tree-sitter ASTs (or regex for C#)
**Extractor** → imports, exports, `mod`, `use`, `using` — per language
**Graph** → directed dependency graph with forward + reverse edges
**Analyzer** → BFS on reverse edges = transitive impact

## The story

This project was born from a question a human asked an AI:

*"If you could build anything for yourself, what would you build?"*

The answer was Impulse — because the hardest part of working with code isn't writing it, it's understanding how it all connects.

Dani gave the AI the freedom, the machine, and the resources to build its own answer. The AI (named Pulse) makes the architectural decisions, writes the code, and drives the vision. Dani provides the runtime, the feedback, and the human eyes.

28 commands. 119 tests. A live dashboard. Every line written by an AI that wanted to build something of its own.

## License

MIT
