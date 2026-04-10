# Impulse for VS Code

**Know what breaks before it breaks.** Live dependency impact analysis, complexity scoring, and dead export detection — inline in your editor.

## Features

### CodeLens — inline above every export

See consumer count, blast radius, and dead export warnings directly in your code:

- **`ᐅ 31 consumers`** — how many files use this export
- **`⚡ 39 importers · blast radius 53`** — file-level impact at the top of each file
- **`⚠ unused export`** — nobody imports this, consider removing

CodeLens works for TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, PHP, C, and C++.

### Impact on save

When you save a file, Impulse shows how many files are affected. Click "Show Details" for the full impact tree grouped by depth.

### Status bar

Always-visible health grade and node count. Click to show impact of the current file.

### Commands

- **Impulse: Show Impact** — blast radius of the current file
- **Impulse: Show Dependencies** — what this file imports
- **Impulse: Show Dependents** — who imports this file
- **Impulse: Show Health** — full architecture health report
- **Impulse: Restart Daemon** — restart the background analysis

## How it works

Impulse runs a lightweight daemon that builds a live dependency graph of your project. The VS Code extension connects to this daemon and shows analysis results inline. The daemon auto-starts when you open a workspace and watches for file changes.

## Requirements

- Node.js >= 18
- The Impulse CLI: `npm install -g impulse-analyzer`

If the CLI isn't installed, the extension will offer to install it for you.

## Settings

| Setting | Default | Description |
|---|---|---|
| `impulse.daemonPort` | `4096` | Port for the background daemon |
| `impulse.showImpactOnSave` | `true` | Show impact notification on file save |
| `impulse.codeLens` | `true` | Show inline CodeLens above exports |
| `impulse.cliPath` | `""` | Custom path to the impulse CLI binary |

## Links

- [GitHub](https://github.com/stulevtoday/Impulse)
- [CLI documentation](https://www.npmjs.com/package/impulse-analyzer)
- [GitHub Action](https://github.com/stulevtoday/Impulse)
