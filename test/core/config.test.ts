import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { loadConfig } from "../../src/core/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = resolve(__dirname, "../fixtures/config-test");

async function withConfig(
  filename: string,
  content: string,
  fn: () => Promise<void>,
): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  const path = resolve(TMP_DIR, filename);
  await writeFile(path, content);
  try {
    await fn();
  } finally {
    await unlink(path).catch(() => {});
  }
}

describe("loadConfig", () => {
  it("returns empty config when no file exists", async () => {
    const config = await loadConfig(resolve(__dirname, "../fixtures/nonexistent"));
    assert.deepStrictEqual(config, {});
  });

  it("loads .impulserc.json", async () => {
    await withConfig(".impulserc.json", JSON.stringify({
      thresholds: { health: 80 },
    }), async () => {
      const config = await loadConfig(TMP_DIR);
      assert.equal(config.thresholds?.health, 80);
    });
  });

  it("loads .impulserc", async () => {
    await withConfig(".impulserc", JSON.stringify({
      thresholds: { health: 60 },
    }), async () => {
      const config = await loadConfig(TMP_DIR);
      assert.equal(config.thresholds?.health, 60);
    });
  });

  it("parses boundaries", async () => {
    await withConfig(".impulserc.json", JSON.stringify({
      boundaries: {
        core: { path: "src/core/**", allow: [] },
        cli: { path: "src/cli/**", allow: ["core"] },
      },
    }), async () => {
      const config = await loadConfig(TMP_DIR);
      assert.ok(config.boundaries);
      assert.equal(Object.keys(config.boundaries).length, 2);
      assert.deepStrictEqual(config.boundaries.core.allow, []);
      assert.deepStrictEqual(config.boundaries.cli.allow, ["core"]);
    });
  });

  it("parses exclude list", async () => {
    await withConfig(".impulserc.json", JSON.stringify({
      exclude: ["*.test.ts", "dist/**"],
    }), async () => {
      const config = await loadConfig(TMP_DIR);
      assert.deepStrictEqual(config.exclude, ["*.test.ts", "dist/**"]);
    });
  });

  it("rejects invalid boundary references", async () => {
    await withConfig(".impulserc.json", JSON.stringify({
      boundaries: {
        core: { path: "src/core/**", allow: ["nonexistent"] },
      },
    }), async () => {
      await assert.rejects(
        () => loadConfig(TMP_DIR),
        /unknown boundaries.*nonexistent/,
      );
    });
  });

  it("rejects invalid health threshold", async () => {
    await withConfig(".impulserc.json", JSON.stringify({
      thresholds: { health: 150 },
    }), async () => {
      await assert.rejects(
        () => loadConfig(TMP_DIR),
        /health.*0-100/,
      );
    });
  });

  it("rejects non-object config", async () => {
    await withConfig(".impulserc.json", '"just a string"', async () => {
      await assert.rejects(
        () => loadConfig(TMP_DIR),
        /must be a JSON object/,
      );
    });
  });
});
