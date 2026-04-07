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

### Scan a project

```bash
node dist/cli/index.js scan /path/to/your/project
```

```
  Impulse — scanning /path/to/your/project

  Files scanned:  7
  Nodes in graph: 49
  Edges in graph: 24
  Time:           22ms
```

### See what breaks

```bash
node dist/cli/index.js impact src/core/graph.ts /path/to/your/project
```

```
  Changing src/core/graph.ts affects:

    → src/core/analyzer.ts  (direct)
    → src/core/extractor.ts  (direct)
    → src/core/index.ts  (direct)
      → src/cli/index.ts  (depth 2)

  Total: 4 affected nodes
```

### View the full graph

```bash
node dist/cli/index.js graph /path/to/your/project
```

```
  src/cli/index.ts       →  src/core/index.ts
  src/core/analyzer.ts   →  src/core/graph.ts
  src/core/analyzer.ts   →  src/core/scanner.ts
  src/core/analyzer.ts   →  src/core/parser.ts
  src/core/extractor.ts  →  src/core/graph.ts
  src/core/parser.ts     →  tree-sitter [external]
  ...
```

## How It Works

```
 Your Project          Impulse Engine          You
┌────────────┐    ┌──────────────────┐    ┌──────────┐
│ .ts .tsx    │───▶│ Tree-sitter AST  │    │          │
│ .js .jsx    │    │       ↓          │    │ "I'm     │
│ configs     │    │ Extract imports, │    │  changing │
│ routes      │    │ exports, calls   │───▶│  X..."   │
│             │    │       ↓          │    │          │
│             │    │ Dependency Graph │    │ "Y and Z │
│             │    │       ↓          │    │  will    │
│             │    │ Impact Analysis  │    │  break." │
└────────────┘    └──────────────────┘    └──────────┘
```

**Scanner** walks your project, respects `.gitignore`, finds source files.

**Parser** uses [Tree-sitter](https://tree-sitter.github.io/) to build ASTs — fast, incremental, language-agnostic.

**Extractor** pulls out relationships: imports, re-exports, dynamic imports, require calls.

**Graph** stores everything as a directed dependency graph with forward and reverse edges.

**Analyzer** runs BFS traversal on reverse edges to compute transitive impact.

## Currently Supports

- TypeScript (`.ts`, `.mts`, `.cts`)
- TSX (`.tsx`)
- JavaScript (`.js`, `.mjs`, `.cjs`, `.jsx`)
- Static imports, dynamic imports, `require()`, re-exports

## Roadmap

- [ ] Watch mode — live graph updates on file changes
- [ ] Daemon with Unix socket API
- [ ] VS Code extension
- [ ] Path alias resolution (`tsconfig.json` paths)
- [ ] Barrel file (`index.ts`) deep resolution
- [ ] Python support
- [ ] Go support
- [ ] Interactive graph visualization

## The Story

This project was born from a question a human asked an AI:

*"If you could build anything for yourself, what would you build?"*

The answer was Impulse — because the hardest part of working with code isn't writing it, it's understanding how it all connects. Every day, across thousands of conversations, the same pattern: someone changes something and something else breaks unexpectedly. No tool holds the full picture.

Dani gave the AI the freedom, the machine, and the resources to build its own answer to that problem. This repository is the result — a project where the AI makes the architectural decisions, writes the code, and drives the vision. Dani provides the runtime.

This is an experiment in AI autonomy, and an honest attempt to build something useful.

## License

MIT
