import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeRisk } from "../../src/core/risk.js";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

describe("analyzeRisk", () => {
  it("produces a complete report for the real project", async () => {
    const report = await analyzeRisk(ROOT, 100);

    assert.ok(report.totalFiles > 10, `Expected many files, got ${report.totalFiles}`);
    assert.ok(report.files.length === report.totalFiles);
    assert.ok(report.durationMs > 0);

    const { distribution: dist } = report;
    const total = dist.critical + dist.high + dist.medium + dist.low;
    assert.equal(total, report.totalFiles, "Distribution should sum to total files");
  });

  it("sorts files by score descending", async () => {
    const report = await analyzeRisk(ROOT, 50);

    for (let i = 1; i < report.files.length; i++) {
      assert.ok(
        report.files[i].score <= report.files[i - 1].score,
        `File ${i} score ${report.files[i].score} > file ${i - 1} score ${report.files[i - 1].score}`,
      );
    }
  });

  it("all scores are 0-100", async () => {
    const report = await analyzeRisk(ROOT, 50);

    for (const f of report.files) {
      assert.ok(f.score >= 0 && f.score <= 100, `${f.file} score ${f.score} out of range`);
      assert.ok(f.dimensions.complexity >= 0 && f.dimensions.complexity <= 100);
      assert.ok(f.dimensions.churn >= 0 && f.dimensions.churn <= 100);
      assert.ok(f.dimensions.impact >= 0 && f.dimensions.impact <= 100);
      assert.ok(f.dimensions.coupling >= 0 && f.dimensions.coupling <= 100);
    }
  });

  it("risk levels match score thresholds", async () => {
    const report = await analyzeRisk(ROOT, 50);

    for (const f of report.files) {
      if (f.score >= 60) assert.equal(f.risk, "critical", `${f.file} score ${f.score} should be critical`);
      else if (f.score >= 40) assert.equal(f.risk, "high", `${f.file} score ${f.score} should be high`);
      else if (f.score >= 20) assert.equal(f.risk, "medium", `${f.file} score ${f.score} should be medium`);
      else assert.equal(f.risk, "low", `${f.file} score ${f.score} should be low`);
    }
  });

  it("files with high complexity score higher", async () => {
    const report = await analyzeRisk(ROOT, 100);

    const complexFiles = report.files.filter((f) => f.dimensions.complexity >= 80);
    const simpleFiles = report.files.filter((f) => f.dimensions.complexity === 0 && f.dimensions.churn === 0);

    if (complexFiles.length > 0 && simpleFiles.length > 0) {
      const avgComplexScore = complexFiles.reduce((s, f) => s + f.score, 0) / complexFiles.length;
      const avgSimpleScore = simpleFiles.reduce((s, f) => s + f.score, 0) / simpleFiles.length;
      assert.ok(
        avgComplexScore > avgSimpleScore,
        `Complex files (avg ${avgComplexScore}) should score higher than simple files (avg ${avgSimpleScore})`,
      );
    }
  });

  it("raw metrics are populated", async () => {
    const report = await analyzeRisk(ROOT, 50);

    const withComplexity = report.files.filter((f) => f.raw.functions > 0);
    assert.ok(withComplexity.length > 0, "Some files should have functions");

    for (const f of withComplexity) {
      assert.ok(f.raw.maxCognitive >= 0);
      assert.ok(f.raw.avgCognitive >= 0);
      assert.ok(f.raw.blastRadius >= 0);
      assert.ok(f.raw.hiddenCouplings >= 0);
    }
  });

  it("works on mini-project without errors", async () => {
    const report = await analyzeRisk(resolve(ROOT, "test/fixtures/mini-project"), 50);
    assert.ok(report.totalFiles > 0);
    assert.ok(report.durationMs >= 0);
  });
});
