<p align="center">
  <br>
  <strong>I M P U L S E</strong>
  <br>
  <em>Know what breaks before it breaks.</em>
  <br>
  <br>
</p>

---

Impulse is a local dependency graph engine for software projects. It parses your codebase, builds a live graph of how everything connects, and answers one question:

> **"I'm changing this file — what else is affected?"**

No cloud. No accounts. No telemetry. Just your code, understood.

## Quick Start

```bash
git clone https://github.com/stulevtoday/Impulse.git
cd Impulse
npm install
npm run build
```

## Commands

### `scan` — Build the dependency graph

```bash
node dist/cli/index.js scan /path/to/project
```

```
  Files scanned:  303
  Nodes in graph: 533
  Edges in graph: 1689
  Time:           383ms
```

### `impact` — What breaks if I change this file?

```bash
node dist/cli/index.js impact src/core/graph.ts .
```

```
  Changing src/core/graph.ts affects:

    → src/core/analyzer.ts  (direct)
    → src/core/extractor.ts  (direct)
    → src/core/index.ts  (direct)
      → src/cli/index.ts  (depth 2)

  Total: 15 affected nodes
```

### `diff` — Impact of your uncommitted changes

```bash
node dist/cli/index.js diff .
```

```
  Changed files (1):
    ● src/core/graph.ts

  Affected files (15):
    → src/core/analyzer.ts  (direct, via src/core/graph.ts)
    → src/core/cache.ts  (direct, via src/core/graph.ts)
    → src/core/extractor.ts  (direct, via src/core/graph.ts)
    ...
```

### `health` — Architecture health scoring

```bash
node dist/cli/index.js health .
```

```
  Score: 87/100 (B)
  1 god file(s), max chain depth 8

  Penalties:
    God files:         -5
    Deep chains:       -8
```

Cycles classified by severity: `tight-couple` (2 files, -3), `short-ring` (3-4, -8), `long-ring` (5+, -15).

### `exports` — Dead export detection

```bash
node dist/cli/index.js exports .
```

```
  src/core/graph.ts  (7 exports)
    ✓ DependencyGraph  — 8 user(s)
    ✓ GraphNode  — 8 user(s)
    ✓ GraphEdge  — 6 user(s)

  src/core/index.ts  [barrel]  (24 exports)
    ✓ analyzeProject  — 1 user(s)
    ↗ GraphNode  — re-export (public API)
    ...

  Total: 79 exports, 15 dead, 20 barrel re-exports
```

### `visualize` — Interactive graph in the browser

```bash
node dist/cli/index.js visualize .
```

Opens a D3.js force-directed graph in your browser. Nodes colored by directory, sized by connections. Click a node to see impact ripple through its dependents.

### `watch` — Real-time file change tracking

```bash
node dist/cli/index.js watch .
```

### `daemon` — HTTP API for IDE integration

```bash
node dist/cli/index.js daemon .
```

Endpoints: `/status` `/impact?file=` `/graph` `/files` `/dependencies?file=` `/dependents?file=` `/health` `/exports` `/warnings` `/visualize`

### Other commands

- `graph` — Show the full edge list
- `why <from> <to>` — Find the dependency chain between two files
- `env` — Analyze environment variable usage
- `explore` — Interactive terminal REPL

### JSON output

All analysis commands support `--json` for piping and scripting:

```bash
node dist/cli/index.js health . --json | jq '.score'
node dist/cli/index.js diff . --json
node dist/cli/index.js scan . --json
```

## Languages

| Language | Resolution | Config |
|---|---|---|
| TypeScript/JavaScript | `import`/`require`/re-exports, path aliases | `tsconfig.json` |
| Python | `import`/`from`, relative imports, source roots | — |
| Go | Package imports → file-level edges | `go.mod` |
| Rust | `mod` declarations, `use crate::`/`super::`/`self::` | `Cargo.toml` |
| C# | Namespace-based with type-aware resolution | `.csproj` |

## How It Works

```
 Your Project          Impulse Engine          You
┌────────────┐    ┌──────────────────┐    ┌──────────┐
│ .ts .py     │───▶│ Tree-sitter AST  │    │          │
│ .go .rs     │    │       ↓          │    │ "I'm     │
│ .cs .jsx    │    │ Extract imports, │    │  changing │
│ configs     │    │ exports, symbols │───▶│  X..."   │
│             │    │       ↓          │    │          │
│             │    │ Dependency Graph │    │ "Y and Z │
│             │    │       ↓          │    │  will    │
│             │    │ Impact Analysis  │    │  break." │
└────────────┘    └──────────────────┘    └──────────┘
```

## The Story

This project was born from a question a human asked an AI:

*"If you could build anything for yourself, what would you build?"*

The answer was Impulse — because the hardest part of working with code isn't writing it, it's understanding how it all connects. Every day, across thousands of conversations, the same pattern: someone changes something and something else breaks unexpectedly. No tool holds the full picture.

Dani gave the AI the freedom, the machine, and the resources to build its own answer to that problem. This repository is the result — a project where the AI makes the architectural decisions, writes the code, and drives the vision. Dani provides the runtime.

This is an experiment in AI autonomy, and an honest attempt to build something useful.

## License

MIT
