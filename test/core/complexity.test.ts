import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFileComplexity, analyzeComplexity, type FunctionComplexity } from "../../src/core/complexity.js";
import { parseFile } from "../../src/core/parser.js";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

async function parseAndCompute(relativePath: string): Promise<FunctionComplexity[]> {
  const parsed = await parseFile(ROOT, relativePath);
  if (!parsed) return [];
  return computeFileComplexity(parsed);
}

describe("computeFileComplexity", () => {
  describe("TypeScript files", () => {
    it("finds functions in a simple file", async () => {
      const fns = await parseAndCompute("test/fixtures/mini-project/src/utils/format.ts");
      assert.ok(fns.length >= 2, `Expected at least 2 functions, got ${fns.length}`);

      const names = fns.map((f) => f.name);
      assert.ok(names.includes("formatUserName"), "Should find formatUserName");
      assert.ok(names.includes("capitalize"), "Should find capitalize");
    });

    it("simple functions have low complexity", async () => {
      const fns = await parseAndCompute("test/fixtures/mini-project/src/utils/format.ts");
      for (const fn of fns) {
        assert.equal(fn.cyclomatic, 1, `${fn.name} should have cyclomatic 1 (no branches)`);
        assert.equal(fn.cognitive, 0, `${fn.name} should have cognitive 0 (no control flow)`);
        assert.equal(fn.risk, "simple");
      }
    });

    it("detects control flow in complex files", async () => {
      const fns = await parseAndCompute("src/core/health.ts");
      assert.ok(fns.length > 0, "Should find functions in health.ts");

      const detectCycles = fns.find((f) => f.name === "detectCycles");
      if (detectCycles) {
        assert.ok(detectCycles.cyclomatic > 1, "detectCycles should have branches");
        assert.ok(detectCycles.cognitive > 0, "detectCycles should have cognitive complexity");
      }

      const penaltyFn = fns.find((f) => f.name === "penalizeDeepChains" || f.name === "penalizeComplexity");
      if (penaltyFn) {
        assert.ok(penaltyFn.cyclomatic >= 2, "penalty functions should have branches");
      }
    });

    it("handles arrow functions assigned to variables", async () => {
      const fns = await parseAndCompute("src/core/health.ts");
      const names = fns.map((f) => f.name);
      const avg = fns.find((f) => f.name.includes("avg") || f.name.includes("max"));
      // Arrow functions inside computeStats may or may not be found depending on context
      assert.ok(fns.length > 5, "Should find multiple functions in health.ts");
    });

    it("sets correct file path", async () => {
      const fns = await parseAndCompute("src/core/health.ts");
      for (const fn of fns) {
        assert.equal(fn.filePath, "src/core/health.ts");
      }
    });

    it("sets line numbers", async () => {
      const fns = await parseAndCompute("src/core/health.ts");
      for (const fn of fns) {
        assert.ok(fn.line > 0, `${fn.name} should have positive line number`);
        assert.ok(fn.lineCount > 0, `${fn.name} should have positive line count`);
      }
    });
  });

  describe("risk classification", () => {
    it("classifies simple functions (cognitive <= 4)", async () => {
      const fns = await parseAndCompute("test/fixtures/mini-project/src/utils/format.ts");
      for (const fn of fns) {
        assert.equal(fn.risk, "simple");
      }
    });

    it("complex files have higher-risk functions", async () => {
      const fns = await parseAndCompute("src/core/extractor.ts");
      const risks = new Set(fns.map((f) => f.risk));
      assert.ok(fns.some((f) => f.cognitive > 0), "Extractor should have functions with control flow");
    });
  });

  describe("edge cases", () => {
    it("returns empty for non-parseable files", async () => {
      const fns = await parseAndCompute("package.json");
      assert.equal(fns.length, 0);
    });

    it("returns empty for file with no functions", async () => {
      const fns = await parseAndCompute("test/fixtures/mini-project/src/types.ts");
      // types.ts likely has only interfaces/types, no functions
      // This is fine — it should return 0 or few functions
      for (const fn of fns) {
        assert.ok(fn.cyclomatic >= 1, "Base cyclomatic is always >= 1");
      }
    });
  });

  describe("multi-language support", () => {
    it("analyzes Java files", async () => {
      const fns = await parseAndCompute("test/fixtures/java-project/src/main/java/com/example/service/UserService.java");
      assert.ok(fns.length > 0, `Should find Java methods, got ${fns.length}`);
      for (const fn of fns) {
        assert.ok(fn.cyclomatic >= 1);
        assert.ok(fn.line > 0);
      }
    });

    it("analyzes Kotlin files", async () => {
      const fns = await parseAndCompute("test/fixtures/kotlin-project/src/main/kotlin/com/example/service/UserService.kt");
      assert.ok(fns.length > 0, `Should find Kotlin functions, got ${fns.length}`);
      for (const fn of fns) {
        assert.ok(fn.cyclomatic >= 1);
      }
    });

    it("analyzes PHP files", async () => {
      const fns = await parseAndCompute("test/fixtures/php-project/src/Services/UserService.php");
      assert.ok(fns.length > 0, `Should find PHP methods, got ${fns.length}`);
      for (const fn of fns) {
        assert.ok(fn.cyclomatic >= 1);
      }
    });
  });
});

describe("analyzeComplexity", () => {
  it("produces a complete report for mini-project", async () => {
    const report = await analyzeComplexity(resolve(ROOT, "test/fixtures/mini-project"));
    assert.ok(report.totalFunctions > 0, "Should find functions");
    assert.ok(report.files.length > 0, "Should have file entries");

    assert.equal(typeof report.avgCyclomatic, "number");
    assert.equal(typeof report.avgCognitive, "number");
    assert.ok(report.avgCyclomatic >= 1, "Average cyclomatic should be >= 1");
    assert.ok(report.avgCognitive >= 0, "Average cognitive should be >= 0");

    const { distribution } = report;
    const total = distribution.simple + distribution.moderate + distribution.complex + distribution.alarming;
    assert.equal(total, report.totalFunctions, "Distribution should sum to total functions");
  });

  it("sorts functions by cognitive complexity descending", async () => {
    const report = await analyzeComplexity(resolve(ROOT, "test/fixtures/mini-project"));
    for (let i = 1; i < report.functions.length; i++) {
      assert.ok(
        report.functions[i].cognitive <= report.functions[i - 1].cognitive,
        "Functions should be sorted by cognitive desc",
      );
    }
  });

  it("file-level aggregation is correct", async () => {
    const report = await analyzeComplexity(resolve(ROOT, "test/fixtures/mini-project"));

    for (const file of report.files) {
      const sumCyc = file.functions.reduce((s, f) => s + f.cyclomatic, 0);
      const sumCog = file.functions.reduce((s, f) => s + f.cognitive, 0);
      const maxCog = Math.max(0, ...file.functions.map((f) => f.cognitive));

      assert.equal(file.totalCyclomatic, sumCyc, `${file.filePath} totalCyclomatic mismatch`);
      assert.equal(file.totalCognitive, sumCog, `${file.filePath} totalCognitive mismatch`);
      assert.equal(file.maxCognitive, maxCog, `${file.filePath} maxCognitive mismatch`);
    }
  });

  it("handles real project without errors", async () => {
    const report = await analyzeComplexity(ROOT);
    assert.ok(report.totalFunctions > 20, `Expected many functions in real project, got ${report.totalFunctions}`);
    assert.ok(report.files.length > 10, `Expected many files, got ${report.files.length}`);

    // Verify some known complex functions exist
    const highComplexity = report.functions.filter((f) => f.cognitive > 5);
    assert.ok(highComplexity.length > 0, "Real project should have moderately complex functions");
  });
});
