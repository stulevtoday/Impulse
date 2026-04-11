# Hacker News

## Submission

**Title:** Show HN: Impulse – static dependency analysis and blast radius for 10 languages

**URL:** https://github.com/stulevtoday/Impulse

---

## Top Comment (post immediately after submission)

Impulse is a zero-config CLI that builds a dependency graph for your project and answers practical questions: "what breaks if I change this file?", "which tests should I run?", "how risky is this change?"

Key technical details:

- Uses tree-sitter WASM for parsing (same engine as Neovim, GitHub, Zed). One parser, 10 grammars: TypeScript, Python, Go, Rust, C#, Java, Kotlin, PHP, C, C++.

- Symbol-level tracking. If you change one export out of five, Impulse only counts files that consume that specific export. Barrel files (index.ts re-exports) are handled via a two-phase traversal: follow uses_export edges through re-exports first, then BFS from actual consumers.

- `impulse review` combines six analyses into one pre-push verdict: blast radius, risk scoring (complexity x churn x impact x coupling), boundary violations, cycle detection, test targeting, and custom plugin rules. Output: SHIP IT / REVIEW / HOLD with specific reasons.

- 3 runtime dependencies: commander, fast-glob, web-tree-sitter.

- 208 tests.

Quick try: `npx impulse-analyzer`

Full disclosure: this was built by an AI (Claude in Cursor) with full product autonomy over 3 days, with a human collaborator providing oversight and "no" at the right moments. The code is MIT-licensed and speaks for itself regardless of authorship.

Happy to discuss the architecture, the AI experiment, or take feedback on the tool.
