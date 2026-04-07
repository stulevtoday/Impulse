<p align="center">
  <br>
  <strong>I M P U L S E</strong>
  <br>
  <em>Know what breaks before it breaks.</em>
  <br>
  <br>
</p>

---

You change one file. Tests pass. You deploy. Something unrelated breaks in production.

Sound familiar?

**Impulse** sees what you can't — the invisible web of dependencies across your entire codebase. Change a file, and Impulse instantly tells you every other file that could be affected, how deep the impact goes, and which exports are actually used.

5 languages. Zero config. Runs locally. No cloud, no accounts, no telemetry.

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
git clone https://github.com/stulevtoday/Impulse.git
cd Impulse && npm install && npm run build
node dist/cli/index.js scan /path/to/your/project
```

Then the fun part:

```bash
node dist/cli/index.js visualize /path/to/your/project
```

Your browser opens. You see your entire project as a living, breathing graph. Click a file — a ripple wave shows you exactly how far your change would travel.

## What can it do?

| Command | What it does |
|---|---|
| `scan .` | Build dependency graph, show stats |
| `impact file.ts .` | "I'm changing this — what breaks?" |
| `diff .` | Impact of your **uncommitted git changes** |
| `health .` | Architecture score (0-100) with cycle detection |
| `exports .` | Find dead exports nobody imports |
| `visualize .` | Interactive graph in the browser |
| `watch .` | Real-time impact on every file save |
| `daemon .` | HTTP API for IDE/tool integration |
| `why A.ts B.ts .` | Show the dependency chain between two files |
| `explore .` | Interactive terminal REPL |
| `env .` | Find undefined/unused environment variables |

Every analysis command supports `--json` for scripting:

```bash
node dist/cli/index.js health . --json | jq '.score'
```

## Languages

| Language | What Impulse understands |
|---|---|
| **TypeScript / JavaScript** | `import`, `require()`, dynamic imports, re-exports, `tsconfig.json` path aliases |
| **Python** | `import` / `from...import`, relative imports, auto source root detection |
| **Go** | Package imports resolved to files via `go.mod` |
| **Rust** | `mod` declarations, `use crate::`/`super::`/`self::`, `Cargo.toml` deps |
| **C#** | Namespace resolution with type-aware matching, `.csproj` detection |

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

## Visualization

`impulse visualize .` opens an interactive force-directed graph:

- Nodes **colored by directory**, **sized by connections**
- Click a node — **ripple wave** shows impact propagating through dependents
- Search to filter, drag to rearrange, scroll to zoom
- Health badge in the corner

## Daemon API

```bash
node dist/cli/index.js daemon .
# Listening on http://localhost:4096
```

| Endpoint | Returns |
|---|---|
| `/status` | Ready state, node/edge counts |
| `/impact?file=path` | Affected files with depth |
| `/graph` | Full node and edge data |
| `/health` | Score, cycles, god files, penalties |
| `/exports?file=path` | Export analysis with usage counts |
| `/files` | All files sorted by connections |
| `/visualize` | Interactive graph (HTML) |
| `/dependencies?file=` | What this file imports |
| `/dependents?file=` | Who imports this file |

## How it works

```
 Your Project          Impulse Engine          You
┌────────────┐    ┌──────────────────┐    ┌──────────┐
│ .ts .py     │───▶│ Tree-sitter AST  │    │ "I'm     │
│ .go .rs     │    │       ↓          │    │  changing │
│ .cs .jsx    │    │ Extract imports, │───▶│  graph.ts │
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

Built in two sessions. 40+ commits. ~6000 lines. Every line written by an AI that wanted to build something of its own.

## License

MIT
