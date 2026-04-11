# Asset Creation Guide

Terminal screenshots and GIFs for publication. Run these commands and capture the output.

## Required Assets

### 1. Dashboard (hero image)

Run on a project with uncommitted changes:
```bash
impulse
```

Shows: project name, file count, languages, health score, uncommitted changes, hotspots, suggested commands.

### 2. Review command (key feature showcase)

```bash
impulse review .
```

Shows: changed files with risk bars, blast radius, test targets, verdict (SHIP/REVIEW/HOLD).

### 3. Risk analysis

```bash
impulse risk . --limit 5
```

Shows: risk bars with 4-dimension breakdown for top files.

### 4. Visualization (browser screenshot)

```bash
impulse visualize .
```

Take browser screenshot showing: force-directed graph, file sidebar, analysis tabs, live indicator.

### 5. Health report

```bash
impulse health .
```

Shows: score, grade, penalties breakdown, cycle classification, stability metrics.

### 6. Diff with symbol precision

Make a small change to one export in a file with multiple exports, then:
```bash
impulse diff .
```

Shows: symbol-level precision — "changed: addNode" with reduced blast radius vs file-level.

## GIF Recording

Use [vhs](https://github.com/charmbracelet/vhs) or [asciinema](https://asciinema.org/) for terminal GIFs.

### Recommended VHS tape for hero GIF:

```
# impulse-demo.tape
Output impulse-demo.gif
Set FontSize 14
Set Width 900
Set Height 500
Set Theme "Dracula"

Type "npx impulse-analyzer review ."
Enter
Sleep 3s

Type "npx impulse-analyzer visualize ."
Enter
Sleep 2s
```

### Recommended asciinema recording:

```bash
# Record
asciinema rec impulse-demo.cast --cols 100 --rows 30

# Inside recording:
impulse review .
# wait for output
impulse risk . --limit 3
# wait for output
# Ctrl+D to stop

# Convert to GIF
agg impulse-demo.cast impulse-demo.gif --theme dracula
```

## Platform-specific sizing

- **Habr**: max width 780px, use full-width terminal captures
- **Reddit**: preview image should be readable at 600px width
- **HN**: no images in comments — text-only terminal output
- **GitHub README**: use the existing ASCII art examples already in README.md

## Color scheme note

Terminal output uses ANSI colors. For screenshots, use a dark terminal theme (Dracula, One Dark, or similar) for best contrast. The red/yellow/green/cyan color scheme in Impulse output is designed for dark backgrounds.
