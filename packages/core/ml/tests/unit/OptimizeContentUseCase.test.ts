/**
 * @file OptimizeContentUseCase.test.ts
 * @description Unit tests for OptimizeContentUseCase.
 *   Tier 3 — mocks AIServicePort; verifies Result contract for optimization scenarios.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { OptimizeContentUseCase } from "../../src/OptimizeContentUseCase.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAIService(overrides?: Partial<AIServicePort>): AIServicePort {
  return {
    optimizeContent: vi.fn(async () => ({
      optimization: {
        optimizedText: "Optimized content here #launch",
        changes: [{ reason: "Added hashtag for reach" }],
        hashtags: ["#launch", "#product"],
      },
    })),
    analyzeContent: vi.fn(async () => ({
      analysis: { tone: { detected: "enthusiastic", suggestions: ["conversational"] } },
    })),
    generateVariations: vi.fn(async () => ({
      variations: ["Variation A", "Variation B"],
    })),
    ...overrides,
  } as unknown as AIServicePort;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OptimizeContentUseCase", () => {
  let aiService: ReturnType<typeof makeAIService>;

  beforeEach(() => {
    vi.clearAllMocks();
    aiService = makeAIService();
  });

  describe("happy path — AI optimization succeeds", () => {
    it("returns ok with optimizedContent and recommendations when AI service responds", async () => {
      const useCase = new OptimizeContentUseCase(aiService);

      const result = await useCase.execute({
        content: "Check out our new product today!",
        provider: "INSTAGRAM",
        optimizationGoal: "engagement",
      });

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(typeof result.value.optimizedContent, "string");
      assert.ok(result.value.optimizedContent.length > 0);
      assert.ok(Array.isArray(result.value.recommendations));
    });
  });

  describe("validation failed — empty content", () => {
    it("returns VALIDATION_FAILED error when content is an empty string", async () => {
      const useCase = new OptimizeContentUseCase(aiService);

      const result = await useCase.execute({
        content: "   ",
        provider: "X",
        optimizationGoal: "reach",
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });
  });

  describe("heuristic fallback — AI unavailable", () => {
    it("returns ok with heuristic recommendations when AI service throws", async () => {
      const failingAI = makeAIService({
        optimizeContent: vi.fn(async () => {
          throw new Error("AI service down");
        }),
      });
      const useCase = new OptimizeContentUseCase(failingAI);

      const result = await useCase.execute({
        content: "Check out our new product today!",
        provider: "LINKEDIN",
        optimizationGoal: "clicks",
      });

      assert.ok(result.ok);
      assert.ok(Array.isArray(result.value.recommendations));
      assert.ok(result.value.recommendations.length > 0);
    });
  });

  describe("content truncation — exceeds platform limit", () => {
    it("returns ok with truncated content when input exceeds X 280-char limit", async () => {
      const longContent = "a".repeat(350);
      const useCase = new OptimizeContentUseCase(aiService);

      const result = await useCase.execute({
        content: longContent,
        provider: "X",
        optimizationGoal: "reach",
      });

      assert.ok(result.ok);
      assert.ok(result.value.optimizedContent.length <= 280);
    });
  });
});
