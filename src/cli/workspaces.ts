import type { Command } from "commander";
import { resolve } from "node:path";
import { detectWorkspaces } from "../core/workspaces.js";

export function registerWorkspacesCommand(program: Command): void {
  program
    .command("workspaces")
    .description("Detect monorepo workspaces — packages, tools, entry points")
    .argument("[dir]", "Project root directory", ".")
    .option("--json", "Output as JSON")
    .action(async (dir: string, opts: { json?: boolean }) => {
      const rootDir = resolve(dir);

      const info = await detectWorkspaces(rootDir);

      if (opts.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const bold = "\x1b[1m";
      const green = "\x1b[32m";
      const yellow = "\x1b[33m";
      const cyan = "\x1b[36m";

      if (info.packages.length === 0) {
        console.log(`\n  ${bold}Impulse — Workspace Detection${reset}`);
        console.log(`\n  ${dim}No monorepo workspaces detected.${reset}`);
        console.log(`  ${dim}Impulse will analyze all files under the root directory.${reset}\n`);
        return;
      }

      console.log(`\n  ${bold}Impulse — Workspace Detection${reset}`);
      console.log(`  ${cyan}${info.tool}${reset} monorepo with ${bold}${info.packages.length}${reset} package(s)\n`);

      const maxName = Math.max(...info.packages.map((p) => p.name.length));

      for (const pkg of info.packages) {
        const name = pkg.name.padEnd(maxName);
        const entry = pkg.main ? `→ ${pkg.main}` : `${yellow}no entry point${reset}`;
        console.log(`    ${bold}${name}${reset}  ${dim}${pkg.dir}${reset}  ${dim}${entry}${reset}`);
      }

      console.log(`\n  ${green}✓${reset} Cross-package imports will resolve to local files instead of external.`);
      console.log(`  ${dim}Run impulse scan . or impulse health . to analyze the full monorepo.${reset}\n`);
    });
}
