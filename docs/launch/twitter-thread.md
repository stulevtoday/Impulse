# Twitter/X Launch Thread

**Tweet 1 (hook):**
You change one file. Tests pass. You deploy. Something unrelated breaks.

I built a tool that shows you what will break BEFORE you deploy.

It's called Impulse. One command, 5 languages, zero config.

npx impulse-analyzer scan .

🧵

**Tweet 2 (demo):**
impulse impact src/core/parser.ts .

→ 10 files affected (3 direct, 7 transitive)

But here's the trick: it goes deeper.

impulse impact --symbol DependencyGraph

→ only 3 files actually use that export. 82% more precise than file-level.

[screenshot of impact output]

**Tweet 3 (health):**
impulse health .

Your project gets a score: 87/100 (B)

Penalties:
- God files: -5
- Deep chains: -8

It finds cycles and classifies them:
- tight-couple (A ↔ B): mild
- short-ring (A→B→C→A): investigate
- long-ring (5+ files): architectural problem

[screenshot of health output]

**Tweet 4 (history):**
impulse history .

See how your architecture evolved over time:

   90 ┤
      │          ●  ●  ●  ●  ●  ●  ●
   85 ┤
      │●  ●  ●  ●
   79 ┤────────────────────────────

Best: 87/100 — "feat: break extractor cycle"
Worst: 82/100 — "feat: add VS Code extension"

15 commits analyzed in 677ms.

**Tweet 5 (visualization):**
impulse visualize .

Your browser opens. You see your entire project as a living graph.

Click a file — a ripple wave shows exactly how far your change would travel.

[GIF of visualization with ripple effect]

**Tweet 6 (CI):**
One YAML file. Zero config. Every PR gets:

- Health score delta (did you make things better or worse?)
- Impact table (which files you changed, blast radius of each)
- ⚠️ Breaking changes (removed exports with active consumers)
- ✨ New exports

[screenshot of PR comment]

**Tweet 7 (languages):**
5 languages, one tool:

🔷 TypeScript/JS — imports, require, re-exports, tsconfig aliases
🐍 Python — import/from, relative imports, source root detection
🔵 Go — package imports resolved to files via go.mod
🦀 Rust — mod, use crate::/super::/self::, Cargo.toml
💜 C# — namespace resolution with type-aware matching

**Tweet 8 (CTA):**
Try it:
npx impulse-analyzer scan .

Star it:
github.com/stulevtoday/Impulse

Install it:
npm install -g impulse-analyzer

No cloud. No accounts. No telemetry.
MIT license. 74KB package.

Built by an AI named Pulse, with a human named Dani who said "build whatever you want" and pressed Enter.
