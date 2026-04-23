/**
 * Tests for AI route optimization and prediction schemas.
 * Imports the real Zod schemas from routes.ts.
 *
 * @file aiTypes.optimize.test.ts
 * @description Tests for AI Schemas - OptimizeContentBodySchema
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  OptimizeContentBodySchema,
  PredictPerformanceBodySchema,
  VariationTypeSchema,
  GenerateVariationsBodySchema,
} from "../../src/ai/routes.js";

describe("AI Schemas - OptimizeContentBodySchema", () => {
  it("should validate a complete optimize request", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      brandVoice: "professional",
      provider: "openai",
    });
    expect(result.success).toBe(true);
  });

  it("should accept body without brandVoice", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
    });
    expect(result.success).toBe(true);
  });

  it("should accept body without provider", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "instagram",
      brandVoice: "casual",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty content", () => {
    const result = OptimizeContentBodySchema.safeParse({ content: "", platform: "twitter" });
    expect(result.success).toBe(false);
  });

  it("should reject empty platform", () => {
    const result = OptimizeContentBodySchema.safeParse({ content: "Test content", platform: "" });
    expect(result.success).toBe(false);
  });

  it("should reject missing platform", () => {
    const result = OptimizeContentBodySchema.safeParse({ content: "Test content" });
    expect(result.success).toBe(false);
  });
});

describe("AI Schemas - PredictPerformanceBodySchema", () => {
  it("should validate a complete predict request", () => {
    const result = PredictPerformanceBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      historicalData: [{ date: "2024-01-01", engagement: 100 }],
      provider: "openai",
    });
    expect(result.success).toBe(true);
  });

  it("should accept body without historicalData", () => {
    const result = PredictPerformanceBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty historicalData array", () => {
    const result = PredictPerformanceBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      historicalData: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty content", () => {
    const result = PredictPerformanceBodySchema.safeParse({ content: "", platform: "twitter" });
    expect(result.success).toBe(false);
  });

  it("should reject empty platform", () => {
    const result = PredictPerformanceBodySchema.safeParse({
      content: "Test content",
      platform: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("AI Schemas - VariationTypeSchema", () => {
  it("should accept tone", () => {
    expect(VariationTypeSchema.safeParse("tone").success).toBe(true);
  });

  it("should accept length", () => {
    expect(VariationTypeSchema.safeParse("length").success).toBe(true);
  });

  it("should accept audience", () => {
    expect(VariationTypeSchema.safeParse("audience").success).toBe(true);
  });

  it("should reject an unknown variation type", () => {
    expect(VariationTypeSchema.safeParse("style").success).toBe(false);
  });

  it("should reject empty string", () => {
    expect(VariationTypeSchema.safeParse("").success).toBe(false);
  });
});

describe("AI Schemas - GenerateVariationsBodySchema", () => {
  it("should validate a correct variations request", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 5,
      provider: "openai",
    });
    expect(result.success).toBe(true);
  });

  it("should accept minimum count (1)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "length",
      count: 1,
    });
    expect(result.success).toBe(true);
  });

  it("should accept maximum count (10)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "audience",
      count: 10,
    });
    expect(result.success).toBe(true);
  });

  it("should reject count below minimum (0)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should reject count above maximum (11)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 11,
    });
    expect(result.success).toBe(false);
  });

  it("should reject non-integer count", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 5.5,
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative count", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: -1,
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid variationType", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "invalid",
      count: 3,
    });
    expect(result.success).toBe(false);
  });
});
