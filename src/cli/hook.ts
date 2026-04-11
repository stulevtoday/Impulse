import type { Command } from "commander";
import { resolve, join } from "node:path";
import { readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const HOOK_MARKER = "# impulse-review-hook";

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Runs impulse review on staged changes before push.
# Installed by: impulse hook install
# Remove with:  impulse hook uninstall

if command -v npx >/dev/null 2>&1; then
  npx --yes impulse-analyzer review . --staged
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 1 ]; then
    echo ""
    echo "  impulse: push blocked by HOLD verdict"
    echo "  Run 'impulse review . --staged' for details"
    echo "  Skip with: git push --no-verify"
    echo ""
    exit 1
  fi
fi
`;

function getGitDir(rootDir: string): string | null {
  try {
    return execSync("git rev-parse --git-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function getHookPath(rootDir: string): string | null {
  const gitDir = getGitDir(rootDir);
  if (!gitDir) return null;
  const absGitDir = resolve(rootDir, gitDir);
  return join(absGitDir, "hooks", "pre-push");
}

function isImpulseHook(content: string): boolean {
  return content.includes(HOOK_MARKER);
}

export function registerHookCommand(program: Command): void {
  const hook = program
    .command("hook")
    .description("Manage git hooks — auto-review before push");

  hook
    .command("install")
    .description("Install pre-push hook that runs impulse review")
    .argument("[dir]", "Project root directory", ".")
    .option("--force", "Overwrite existing pre-push hook")
    .action((dir: string, opts: { force?: boolean }) => {
      const rootDir = resolve(dir);
      const hookPath = getHookPath(rootDir);

      if (!hookPath) {
        console.log("  Not a git repository.\n");
        process.exit(1);
      }

      if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, "utf-8");
        if (isImpulseHook(existing)) {
          console.log("  Impulse pre-push hook is already installed.\n");
          return;
        }
        if (!opts.force) {
          console.log("  A pre-push hook already exists.");
          console.log("  Use --force to overwrite, or add impulse manually.\n");
          process.exit(1);
        }
      }

      writeFileSync(hookPath, HOOK_SCRIPT, "utf-8");
      chmodSync(hookPath, 0o755);

      console.log(`\n  \x1b[32m✓\x1b[0m  Installed pre-push hook`);
      console.log(`     ${hookPath}`);
      console.log(`\n  Every \x1b[1mgit push\x1b[0m will now run \x1b[1mimpulse review --staged\x1b[0m`);
      console.log(`  HOLD verdict blocks the push. Skip with: git push --no-verify\n`);
    });

  hook
    .command("uninstall")
    .description("Remove the impulse pre-push hook")
    .argument("[dir]", "Project root directory", ".")
    .action((dir: string) => {
      const rootDir = resolve(dir);
      const hookPath = getHookPath(rootDir);

      if (!hookPath || !existsSync(hookPath)) {
        console.log("  No pre-push hook found.\n");
        return;
      }

      const content = readFileSync(hookPath, "utf-8");
      if (!isImpulseHook(content)) {
        console.log("  Pre-push hook exists but was not installed by Impulse.");
        console.log("  Remove it manually if needed.\n");
        return;
      }

      unlinkSync(hookPath);
      console.log(`\n  \x1b[32m✓\x1b[0m  Removed pre-push hook\n`);
    });

  hook
    .command("status")
    .description("Check if the impulse pre-push hook is installed")
    .argument("[dir]", "Project root directory", ".")
    .action((dir: string) => {
      const rootDir = resolve(dir);
      const hookPath = getHookPath(rootDir);

      if (!hookPath || !existsSync(hookPath)) {
        console.log("  No pre-push hook installed.\n");
        console.log("  Install with: impulse hook install\n");
        return;
      }

      const content = readFileSync(hookPath, "utf-8");
      if (isImpulseHook(content)) {
        console.log(`  \x1b[32m✓\x1b[0m  Impulse pre-push hook is active`);
        console.log(`     ${hookPath}\n`);
      } else {
        console.log("  Pre-push hook exists but is not managed by Impulse.\n");
      }
    });
}
