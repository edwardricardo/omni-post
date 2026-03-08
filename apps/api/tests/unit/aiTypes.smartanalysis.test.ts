/**
 * Tests for SmartAnalysisBodySchema and edge-case validation behaviour.
 * Imports all Zod schemas directly from routes.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SmartAnalysisBodySchema,
  GenerateOptionsSchema,
  GenerateVariationsBodySchema,
  AnalysisTypeSchema,
  OptimizeContentBodySchema,
} from "../../src/ai/routes.js";

describe("AI Schemas - SmartAnalysisBodySchema", () => {
  it("should validate a complete smart analysis request", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      platform: "instagram",
      brandVoice: "professional",
      includeOptimization: true,
      includePrediction: true,
      includeVariations: true,
      variationCount: 5,
    });
    assert.strictEqual(result.success, true);
  });

  it("should apply default platform (twitter)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.platform, "twitter");
    }
  });

  it("should apply default includeOptimization (true)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.includeOptimization, true);
    }
  });

  it("should apply default includePrediction (true)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.includePrediction, true);
    }
  });

  it("should apply default includeVariations (false)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.includeVariations, false);
    }
  });

  it("should apply default variationCount (3)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.variationCount, 3);
    }
  });

  it("should accept minimum variationCount (1)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 1,
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept maximum variationCount (10)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 10,
    });
    assert.strictEqual(result.success, true);
  });

  it("should reject variationCount below minimum (0)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 0,
    });
    assert.strictEqual(result.success, false);
  });

  it("should reject variationCount above maximum (11)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 11,
    });
    assert.strictEqual(result.success, false);
  });

  it("should reject empty content", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "" });
    assert.strictEqual(result.success, false);
  });

  it("should reject missing content", () => {
    const result = SmartAnalysisBodySchema.safeParse({ platform: "twitter" });
    assert.strictEqual(result.success, false);
  });

  it("should accept all feature flags as false", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      includeOptimization: false,
      includePrediction: false,
      includeVariations: false,
    });
    assert.strictEqual(result.success, true);
  });
});

describe("AI Schemas - Edge Cases", () => {
  it("should accept very long content strings", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "x".repeat(10000),
      platform: "twitter",
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept special characters in content", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test!@#$%^&*()_+-=[]{}|;':\",./<>?",
      platform: "twitter",
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept unicode characters in content", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content with unicode: 你好 мир",
      platform: "twitter",
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept whitespace-only content (Zod min(1) checks length, not trimmed length)", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "   ",
      platform: "twitter",
    });
    assert.strictEqual(result.success, true);
  });

  it("should reject uppercase enum values (enum is case-sensitive)", () => {
    const result = AnalysisTypeSchema.safeParse("SENTIMENT");
    assert.strictEqual(result.success, false);
  });

  it("should reject null in optional string fields", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      brandVoice: null,
    });
    assert.strictEqual(result.success, false);
  });

  it("should strip extra fields from request body", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      extraField: "should be stripped",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual("extraField" in result.data, false);
    }
  });

  it("should accept count at maximum boundary (10) in variations schema", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 10,
    });
    assert.strictEqual(result.success, true);
  });

  it("should not enforce min/max on temperature in GenerateOptionsSchema", () => {
    assert.strictEqual(GenerateOptionsSchema.safeParse({ temperature: -1 }).success, true);
    assert.strictEqual(GenerateOptionsSchema.safeParse({ temperature: 0 }).success, true);
    assert.strictEqual(GenerateOptionsSchema.safeParse({ temperature: 2 }).success, true);
  });

  it("should not enforce min/max on maxTokens in GenerateOptionsSchema", () => {
    assert.strictEqual(GenerateOptionsSchema.safeParse({ maxTokens: 0 }).success, true);
    assert.strictEqual(GenerateOptionsSchema.safeParse({ maxTokens: -100 }).success, true);
    assert.strictEqual(GenerateOptionsSchema.safeParse({ maxTokens: 100000 }).success, true);
  });
});
