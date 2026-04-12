import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { detectWorkspaces, buildWorkspaceMap, resolveWorkspaceImport, type WorkspacePackage } from "../../src/core/workspaces.js";
import { analyzeProject } from "../../src/core/analyzer.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

describe("workspace detection", () => {
  describe("npm/yarn workspaces", () => {
    it("detects workspaces from package.json", async () => {
      const info = await detectWorkspaces(resolve(FIXTURES, "monorepo-npm"));
      assert.equal(info.tool, "npm");
      assert.equal(info.packages.length, 2);
      assert.ok(info.packages.some((p) => p.name === "@test/core"));
      assert.ok(info.packages.some((p) => p.name === "@test/ui"));
    });

    it("resolves package directories", async () => {
      const info = await detectWorkspaces(resolve(FIXTURES, "monorepo-npm"));
      const core = info.packages.find((p) => p.name === "@test/core")!;
      assert.equal(core.dir, "packages/core");
    });

    it("resolves main entry point", async () => {
      const info = await detectWorkspaces(resolve(FIXTURES, "monorepo-npm"));
      const core = info.packages.find((p) => p.name === "@test/core")!;
      assert.equal(core.main, "src/index.ts");
    });
  });

  describe("pnpm workspaces", () => {
    it("detects workspaces from pnpm-workspace.yaml", async () => {
      const info = await detectWorkspaces(resolve(FIXTURES, "monorepo-pnpm"));
      assert.equal(info.tool, "pnpm");
      assert.equal(info.packages.length, 2);
      assert.ok(info.packages.some((p) => p.name === "@mono/lib"));
      assert.ok(info.packages.some((p) => p.name === "@mono/app"));
    });
  });

  describe("no workspaces", () => {
    it("returns empty for non-monorepo", async () => {
      const info = await detectWorkspaces(resolve(FIXTURES, "ts-project"));
      assert.equal(info.tool, null);
      assert.equal(info.packages.length, 0);
    });
  });
});

describe("workspace import resolution", () => {
  it("resolves exact package name to entry file", () => {
    const pkgs: WorkspacePackage[] = [
      { name: "@test/core", dir: "packages/core", main: "src/index.ts" },
    ];
    const map = buildWorkspaceMap({ tool: "npm", packages: pkgs, rootDir: resolve(FIXTURES, "monorepo-npm") });
    const result = resolveWorkspaceImport("@test/core", map, resolve(FIXTURES, "monorepo-npm"));
    assert.equal(result, "packages/core/src/index.ts");
  });

  it("returns null for unknown packages", () => {
    const map = new Map<string, WorkspacePackage>();
    const result = resolveWorkspaceImport("lodash", map, "/any");
    assert.equal(result, null);
  });

  it("resolves scoped package name with real fixture", () => {
    const rootDir = resolve(FIXTURES, "monorepo-npm");
    const pkgs: WorkspacePackage[] = [
      { name: "@test/core", dir: "packages/core", main: "src/index.ts" },
    ];
    const map = buildWorkspaceMap({ tool: "npm", packages: pkgs, rootDir });
    const result = resolveWorkspaceImport("@test/core", map, rootDir);
    assert.equal(result, "packages/core/src/index.ts");
  });
});

describe("monorepo cross-package analysis", () => {
  it("resolves cross-package imports as local edges (npm)", async () => {
    const rootDir = resolve(FIXTURES, "monorepo-npm");
    const { graph } = await analyzeProject(rootDir);

    const uiFile = graph.allNodes().find((n) => n.kind === "file" && n.filePath.includes("ui/src/index.ts"));
    assert.ok(uiFile, "should find ui/src/index.ts");

    const deps = graph.getDependencies(uiFile.id).filter((e) => e.kind === "imports");
    const localDeps = deps.filter((e) => !e.to.startsWith("external:"));
    const externalDeps = deps.filter((e) => e.to.startsWith("external:"));

    assert.ok(
      localDeps.some((e) => e.to.includes("core")),
      `@test/ui should import @test/core as local, not external. Local: ${localDeps.map((e) => e.to).join(", ")}, External: ${externalDeps.map((e) => e.to).join(", ")}`,
    );
  });

  it("resolves cross-package imports as local edges (pnpm)", async () => {
    const rootDir = resolve(FIXTURES, "monorepo-pnpm");
    const { graph } = await analyzeProject(rootDir);

    const appFile = graph.allNodes().find((n) => n.kind === "file" && n.filePath.includes("app/src/index.ts"));
    assert.ok(appFile, "should find app/src/index.ts");

    const deps = graph.getDependencies(appFile.id).filter((e) => e.kind === "imports");
    const localDeps = deps.filter((e) => !e.to.startsWith("external:"));

    assert.ok(
      localDeps.some((e) => e.to.includes("lib")),
      `@mono/app should import @mono/lib as local. Got: ${deps.map((e) => e.to).join(", ")}`,
    );
  });

  it("shows cross-package impact", async () => {
    const rootDir = resolve(FIXTURES, "monorepo-npm");
    const { graph } = await analyzeProject(rootDir);

    const impact = graph.analyzeFileImpact("packages/core/src/index.ts");
    const affectedFiles = impact.affected.filter((a) => a.node.kind === "file").map((a) => a.node.filePath);

    assert.ok(
      affectedFiles.some((f) => f.includes("ui")),
      "changing core should affect ui package",
    );
  });
});
