import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateBadgeSVG } from "../../src/core/badge.js";

describe("generateBadgeSVG", () => {
  it("produces valid SVG with correct structure", () => {
    const svg = generateBadgeSVG({ score: 87, grade: "B" });

    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("xmlns="));
    assert.ok(svg.includes("</svg>"));
    assert.ok(svg.includes("87/100 B"));
  });

  it("uses correct color for each grade", () => {
    const grades: Record<string, string> = {
      A: "#4ade80", B: "#86efac", C: "#fbbf24", D: "#fb923c", F: "#f87171",
    };

    for (const [grade, color] of Object.entries(grades)) {
      const svg = generateBadgeSVG({ score: 50, grade });
      assert.ok(svg.includes(color), `grade ${grade} should use color ${color}`);
    }
  });

  it("includes the label text", () => {
    const svg = generateBadgeSVG({ score: 90, grade: "A", label: "health" });
    assert.ok(svg.includes("health"));
  });

  it("defaults label to 'impulse'", () => {
    const svg = generateBadgeSVG({ score: 90, grade: "A" });
    assert.ok(svg.includes("impulse"));
  });

  it("supports flat-square style (no border radius)", () => {
    const flat = generateBadgeSVG({ score: 80, grade: "B", style: "flat" });
    const square = generateBadgeSVG({ score: 80, grade: "B", style: "flat-square" });

    assert.ok(flat.includes("rx=\"3\""), "flat style should have rounded corners");
    assert.ok(square.includes("rx=\"0\""), "flat-square style should have no rounding");
  });

  it("escapes special characters to prevent XSS", () => {
    const svg = generateBadgeSVG({ score: 80, grade: "B", label: '<script>alert("xss")</script>' });

    assert.ok(!svg.includes("<script>"));
    assert.ok(svg.includes("&lt;script&gt;"));
  });

  it("includes aria-label for accessibility", () => {
    const svg = generateBadgeSVG({ score: 95, grade: "A" });
    assert.ok(svg.includes("aria-label="));
    assert.ok(svg.includes("role=\"img\""));
  });
});
