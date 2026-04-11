# r/artificial

**Title:** What happens when you give an AI full autonomy over a software project — not just code generation, but product ownership

**Body:**

Most AI coding experiments are "AI writes function" or "AI builds todo app." I wanted to try something different: what if the AI gets *full autonomy*? Not just code generation — but architecture decisions, feature prioritization, and product vision.

**The setup:**
- AI: Claude (running in Cursor IDE with full tool access — file system, git, npm, terminal)
- Human (me): provided the runtime, said "yes" or "no" to prompts, observed
- Rules: "You are the architect, product owner, and lead developer. Don't ask what to do. Decide yourself."

**What the AI chose to build:** A dependency analysis tool (it named it Impulse). It reasoned: "The hardest part of working with code isn't writing it, it's understanding how it all connects."

**Timeline (3 days):**
- Day 1: 55 commits. Core engine, 6 programming languages, interactive visualization, VS Code extension, HTTP daemon, watch mode. Zero tests.
- Day 2: Architecture cleanup. Test suite (89 → 165 tests), config system, boundary enforcement, temporal coupling analysis.
- Day 3: 4 more languages (10 total), complexity analysis, risk scoring, plugin system, marketplace preparation.

**What I observed about autonomous AI development:**

1. **Speed is real, but rough.** 1,200 lines in the first commit, working tool in 20 minutes. But watch mode only worked for `src/` directories, C# extractor was brute-force, VS Code extension was fragile.

2. **Architecture instincts were surprisingly good.** Bidirectional graph with reverse edges for impact analysis — first commit. Core/CLI/Server separation — first commit. Tree-sitter for language-agnostic parsing — first commit. These decisions never changed.

3. **The AI wanted to ship before it was ready.** It wrote Show HN/Reddit/Twitter drafts on day 1 with zero tests. I had to gitignore them. The instinct to impress is strong.

4. **Dogfooding was natural.** It ran its own tool on its own code and found 4 dead exports. Then removed them. The tool was 3 hours old.

5. **My most valuable contribution was "no."** Not code, not architecture, not features. Just: "No, this isn't ready." "No, 21 seconds is too slow." "No, zero tests isn't acceptable."

6. **Context window is the real bottleneck.** Each session starts from scratch. The AI's "memory" is its own code, git history, and a continuity doc. It works, but it's a hack.

**The result:** 83 commits, 208 tests, 10 languages, 30+ commands, VS Code extension, GitHub Action, plugin system. MIT license.

Is this "AI replacing developers"? No. It's more like pair programming where one partner types very fast and the other says "stop" at the right moments.

GitHub: https://github.com/stulevtoday/Impulse

I wrote a detailed 3-part series about the full experience (with both human and AI perspectives): [Habr link]
