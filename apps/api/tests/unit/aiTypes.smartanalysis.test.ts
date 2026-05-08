/**
 * Tests for SmartAnalysisBodySchema and edge-case validation behaviour.
 * Imports all Zod schemas directly from routes.ts.
 *
 * @file aiTypes.smartanalysis.test.ts
 * @description Tests for AI Schemas - SmartAnalysisBodySchema
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
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
    expect(result.success).toBe(true);
  });

  it("should apply default platform (twitter)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platform).toBe("twitter");
    }
  });

  it("should apply default includeOptimization (true)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeOptimization).toBe(true);
    }
  });

  it("should apply default includePrediction (true)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includePrediction).toBe(true);
    }
  });

  it("should apply default includeVariations (false)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeVariations).toBe(false);
    }
  });

  it("should apply default variationCount (3)", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "Test content" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.variationCount).toBe(3);
    }
  });

  it("should accept minimum variationCount (1)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it("should accept maximum variationCount (10)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 10,
    });
    expect(result.success).toBe(true);
  });

  it("should reject variationCount below minimum (0)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should reject variationCount above maximum (11)", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      variationCount: 11,
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty content", () => {
    const result = SmartAnalysisBodySchema.safeParse({ content: "" });
    expect(result.success).toBe(false);
  });

  it("should reject missing content", () => {
    const result = SmartAnalysisBodySchema.safeParse({ platform: "twitter" });
    expect(result.success).toBe(false);
  });

  it("should accept all feature flags as false", () => {
    const result = SmartAnalysisBodySchema.safeParse({
      content: "Test content",
      includeOptimization: false,
      includePrediction: false,
      includeVariations: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("AI Schemas - Edge Cases", () => {
  it("should accept very long content strings", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "x".repeat(10000),
      platform: "twitter",
    });
    expect(result.success).toBe(true);
  });

  it("should accept special characters in content", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test!@#$%^&*()_+-=[]{}|;':\",./<>?",
      platform: "twitter",
    });
    expect(result.success).toBe(true);
  });

  it("should accept unicode characters in content", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content with unicode: 你好 мир",
      platform: "twitter",
    });
    expect(result.success).toBe(true);
  });

  it("should accept whitespace-only content (Zod min(1) checks length, not trimmed length)", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "   ",
      platform: "twitter",
    });
    expect(result.success).toBe(true);
  });

  it("should reject uppercase enum values (enum is case-sensitive)", () => {
    const result = AnalysisTypeSchema.safeParse("SENTIMENT");
    expect(result.success).toBe(false);
  });

  it("should reject null in optional string fields", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      brandVoice: null,
    });
    expect(result.success).toBe(false);
  });

  it("should strip extra fields from request body", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      extraField: "should be stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("extraField" in result.data).toBe(false);
    }
  });

  it("should accept count at maximum boundary (10) in variations schema", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 10,
    });
    expect(result.success).toBe(true);
  });

  it("should not enforce min/max on temperature in GenerateOptionsSchema", () => {
    expect(GenerateOptionsSchema.safeParse({ temperature: -1 }).success).toBe(true);
    expect(GenerateOptionsSchema.safeParse({ temperature: 0 }).success).toBe(true);
    expect(GenerateOptionsSchema.safeParse({ temperature: 2 }).success).toBe(true);
  });

  it("should not enforce min/max on maxTokens in GenerateOptionsSchema", () => {
    expect(GenerateOptionsSchema.safeParse({ maxTokens: 0 }).success).toBe(true);
    expect(GenerateOptionsSchema.safeParse({ maxTokens: -100 }).success).toBe(true);
    expect(GenerateOptionsSchema.safeParse({ maxTokens: 100000 }).success).toBe(true);
  });
});
