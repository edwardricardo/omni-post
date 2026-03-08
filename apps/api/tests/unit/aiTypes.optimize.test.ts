/**
 * Tests for AI route optimization and prediction schemas.
 * Imports the real Zod schemas from routes.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.strictEqual(result.success, true);
  });

  it("should accept body without brandVoice", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept body without provider", () => {
    const result = OptimizeContentBodySchema.safeParse({
      content: "Test content",
      platform: "instagram",
      brandVoice: "casual",
    });
    assert.strictEqual(result.success, true);
  });

  it("should reject empty content", () => {
    const result = OptimizeContentBodySchema.safeParse({ content: "", platform: "twitter" });
    assert.strictEqual(result.success, false);
  });

  it("should reject empty platform", () => {
    const result = OptimizeContentBodySchema.safeParse({ content: "Test content", platform: "" });
    assert.strictEqual(result.success, false);
  });

  it("should reject missing platform", () => {
    const result = OptimizeContentBodySchema.safeParse({ content: "Test content" });
    assert.strictEqual(result.success, false);
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
    assert.strictEqual(result.success, true);
  });

  it("should accept body without historicalData", () => {
    const result = PredictPerformanceBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept empty historicalData array", () => {
    const result = PredictPerformanceBodySchema.safeParse({
      content: "Test content",
      platform: "twitter",
      historicalData: [],
    });
    assert.strictEqual(result.success, true);
  });

  it("should reject empty content", () => {
    const result = PredictPerformanceBodySchema.safeParse({ content: "", platform: "twitter" });
    assert.strictEqual(result.success, false);
  });

  it("should reject empty platform", () => {
    const result = PredictPerformanceBodySchema.safeParse({
      content: "Test content",
      platform: "",
    });
    assert.strictEqual(result.success, false);
  });
});

describe("AI Schemas - VariationTypeSchema", () => {
  it("should accept tone", () => {
    assert.strictEqual(VariationTypeSchema.safeParse("tone").success, true);
  });

  it("should accept length", () => {
    assert.strictEqual(VariationTypeSchema.safeParse("length").success, true);
  });

  it("should accept audience", () => {
    assert.strictEqual(VariationTypeSchema.safeParse("audience").success, true);
  });

  it("should reject an unknown variation type", () => {
    assert.strictEqual(VariationTypeSchema.safeParse("style").success, false);
  });

  it("should reject empty string", () => {
    assert.strictEqual(VariationTypeSchema.safeParse("").success, false);
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
    assert.strictEqual(result.success, true);
  });

  it("should accept minimum count (1)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "length",
      count: 1,
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept maximum count (10)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "audience",
      count: 10,
    });
    assert.strictEqual(result.success, true);
  });

  it("should reject count below minimum (0)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 0,
    });
    assert.strictEqual(result.success, false);
  });

  it("should reject count above maximum (11)", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 11,
    });
    assert.strictEqual(result.success, false);
  });

  it("should reject non-integer count", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: 5.5,
    });
    assert.strictEqual(result.success, false);
  });

  it("should reject negative count", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "tone",
      count: -1,
    });
    assert.strictEqual(result.success, false);
  });

  it("should reject invalid variationType", () => {
    const result = GenerateVariationsBodySchema.safeParse({
      content: "Test content",
      variationType: "invalid",
      count: 3,
    });
    assert.strictEqual(result.success, false);
  });
});
