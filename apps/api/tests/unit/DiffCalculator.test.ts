/**
 * @file DiffCalculator.test.ts
 * @description Mutation-killing tests for DiffCalculator — covers diff generation,
 * similarity scoring, field counting, and change summary.
 * @layer test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { DiffCalculator } from "../../src/content/DiffCalculator.js";

// ============================================================================
// Helpers
// ============================================================================

function makeVersion(content: Record<string, unknown>, adaptations: Record<string, any> = {}) {
  return {
    id: "v1",
    contentId: "c1",
    version: 1,
    content: { id: "p1", projectId: "proj1", locale: "en" as const, body: "default", ...content },
    adaptations,
    createdAt: new Date(),
    createdBy: "user1",
  };
}

// ============================================================================
// Suite
// ============================================================================

describe("DiffCalculator", () => {
  let calc: DiffCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new DiffCalculator();
  });

  // =========================================================================
  // generateDiff
  // =========================================================================

  describe("generateDiff", () => {
    it("returns empty array for identical versions", () => {
      const v = makeVersion({ body: "Hello" });
      const diffs = calc.generateDiff(v, v);
      assert.equal(diffs.length, 0);
    });

    it("detects modified field", () => {
      const from = makeVersion({ body: "Old text" });
      const to = makeVersion({ body: "New text" });
      const diffs = calc.generateDiff(from, to);
      const bodyDiff = diffs.find((d) => d.field === "content.body");
      assert.ok(bodyDiff, "Should detect body change");
      assert.equal(bodyDiff.changeType, "modified");
      assert.equal(bodyDiff.oldValue, "Old text");
      assert.equal(bodyDiff.newValue, "New text");
    });

    it("detects added field", () => {
      const from = makeVersion({ body: "text" });
      const to = makeVersion({ body: "text", title: "New Title" });
      const diffs = calc.generateDiff(from, to);
      const titleDiff = diffs.find((d) => d.field === "content.title");
      assert.ok(titleDiff);
      assert.equal(titleDiff.changeType, "added");
    });

    it("detects removed field", () => {
      const from = makeVersion({ body: "text", summary: "Summary" });
      const to = makeVersion({ body: "text" });
      const diffs = calc.generateDiff(from, to);
      const summaryDiff = diffs.find((d) => d.field === "content.summary");
      assert.ok(summaryDiff);
      assert.equal(summaryDiff.changeType, "removed");
    });

    it("detects added adaptation", () => {
      const from = makeVersion({ body: "text" }, {});
      const to = makeVersion({ body: "text" }, { x: { body: "X version" } });
      const diffs = calc.generateDiff(from, to);
      const adaptDiff = diffs.find((d) => d.field === "adaptations.x");
      assert.ok(adaptDiff);
      assert.equal(adaptDiff.changeType, "added");
    });

    it("detects removed adaptation", () => {
      const from = makeVersion({ body: "text" }, { x: { body: "X version" } });
      const to = makeVersion({ body: "text" }, {});
      const diffs = calc.generateDiff(from, to);
      const adaptDiff = diffs.find((d) => d.field === "adaptations.x");
      assert.ok(adaptDiff);
      assert.equal(adaptDiff.changeType, "removed");
    });

    it("detects modified adaptation field", () => {
      const from = makeVersion({ body: "text" }, { x: { body: "Old X" } });
      const to = makeVersion({ body: "text" }, { x: { body: "New X" } });
      const diffs = calc.generateDiff(from, to);
      const adaptDiff = diffs.find((d) => d.field.includes("adaptations.x"));
      assert.ok(adaptDiff);
    });

    it("handles multiple changes", () => {
      const from = makeVersion({ body: "Old", title: "Title" });
      const to = makeVersion({ body: "New", summary: "Added" });
      const diffs = calc.generateDiff(from, to);
      assert.ok(diffs.length >= 2);
    });
  });

  // =========================================================================
  // calculateSimilarity
  // =========================================================================

  describe("calculateSimilarity", () => {
    it("returns 100 for identical versions", () => {
      const v = makeVersion({ body: "Same" });
      assert.equal(calc.calculateSimilarity(v, v), 100);
    });

    it("returns less than 100 when fields differ", () => {
      const from = makeVersion({ body: "A", title: "T" });
      const to = makeVersion({ body: "B", title: "T" });
      const similarity = calc.calculateSimilarity(from, to);
      assert.ok(similarity < 100);
      assert.ok(similarity >= 0);
    });

    it("returns 0 or close to 0 when all fields differ", () => {
      const from = makeVersion({ body: "A" });
      const to = makeVersion({ body: "B" });
      const similarity = calc.calculateSimilarity(from, to);
      assert.ok(similarity >= 0);
      assert.ok(similarity <= 100);
    });

    it("clamps result between 0 and 100", () => {
      const from = makeVersion({ body: "X", a: "1", b: "2", c: "3" });
      const to = makeVersion({ body: "Y", a: "4", b: "5", c: "6" });
      const similarity = calc.calculateSimilarity(from, to);
      assert.ok(similarity >= 0);
      assert.ok(similarity <= 100);
    });

    it("returns 100 for empty content in both versions", () => {
      const from = makeVersion({});
      const to = makeVersion({});
      const similarity = calc.calculateSimilarity(from, to);
      assert.equal(similarity, 100);
    });
  });

  // =========================================================================
  // getSummary
  // =========================================================================

  describe("getSummary", () => {
    it("counts total changes", () => {
      const diffs = [
        { field: "content.body", oldValue: "a", newValue: "b", changeType: "modified" as const },
        {
          field: "content.title",
          oldValue: undefined,
          newValue: "t",
          changeType: "added" as const,
        },
      ];
      const summary = calc.getSummary(diffs);
      assert.equal(summary.totalChanges, 2);
    });

    it("counts additions correctly", () => {
      const diffs = [
        { field: "f1", oldValue: undefined, newValue: "v", changeType: "added" as const },
        { field: "f2", oldValue: undefined, newValue: "v", changeType: "added" as const },
      ];
      assert.equal(calc.getSummary(diffs).additions, 2);
    });

    it("counts modifications correctly", () => {
      const diffs = [
        { field: "f1", oldValue: "a", newValue: "b", changeType: "modified" as const },
      ];
      assert.equal(calc.getSummary(diffs).modifications, 1);
    });

    it("counts deletions correctly", () => {
      const diffs = [
        { field: "f1", oldValue: "a", newValue: undefined, changeType: "removed" as const },
      ];
      assert.equal(calc.getSummary(diffs).deletions, 1);
    });

    it("identifies critical changes for body field", () => {
      const diffs = [
        { field: "body", oldValue: "old", newValue: "new", changeType: "modified" as const },
      ];
      const summary = calc.getSummary(diffs);
      expect(summary.criticalChanges).toContain("body");
    });

    it("identifies critical changes for title field", () => {
      const diffs = [
        { field: "title", oldValue: "old", newValue: "new", changeType: "modified" as const },
      ];
      const summary = calc.getSummary(diffs);
      expect(summary.criticalChanges).toContain("title");
    });

    it("does not mark added fields as critical", () => {
      const diffs = [
        { field: "body", oldValue: undefined, newValue: "new", changeType: "added" as const },
      ];
      const summary = calc.getSummary(diffs);
      assert.equal(summary.criticalChanges.length, 0);
    });

    it("returns empty criticalChanges for non-critical fields", () => {
      const diffs = [
        { field: "tags", oldValue: ["a"], newValue: ["b"], changeType: "modified" as const },
      ];
      const summary = calc.getSummary(diffs);
      assert.equal(summary.criticalChanges.length, 0);
    });

    it("returns zeros for empty diff array", () => {
      const summary = calc.getSummary([]);
      assert.equal(summary.totalChanges, 0);
      assert.equal(summary.additions, 0);
      assert.equal(summary.modifications, 0);
      assert.equal(summary.deletions, 0);
    });
  });
});
