/**
 * @file MLUseCases.test.ts
 * @description Application Layer - ML Use Cases Unit Tests.
 *              Tests AI-powered optimization with heuristic fallback.
 * @layer test
 */

import { describe, it, beforeEach, expect } from "vitest";
import { randomUUID } from "crypto";

import {
  OptimizeContentUseCase,
  PredictOptimalTimingUseCase,
  type OptimizeContentInput,
  type PredictTimingInput,
} from "../../../src/application/ml/index.js";
import { USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

/**
 * Mock AIService that simulates AI unavailability (for heuristic fallback tests)
 */
function createFailingAIServiceMock() {
  return {
    optimizeContent: async () => {
      throw new Error("AI unavailable");
    },
    generateVariations: async () => {
      throw new Error("AI unavailable");
    },
    analyzeContent: async () => {
      throw new Error("AI unavailable");
    },
    generateContent: async () => {
      throw new Error("AI unavailable");
    },
    predictPerformance: async () => {
      throw new Error("AI unavailable");
    },
    smartAnalysis: async () => {
      throw new Error("AI unavailable");
    },
    healthCheck: async () => ({ status: "unhealthy" }),
    getMetrics: async () => ({ success: false }),
    clearCache: async () => ({ success: false }),
  } as any;
}

/**
 * Mock AIService that returns successful AI optimization results
 */
function createSuccessfulAIServiceMock() {
  return {
    optimizeContent: async () => ({
      success: true,
      optimization: {
        optimizedText: "AI-optimized content here",
        changes: [
          {
            type: "modified" as const,
            original: "original",
            optimized: "optimized",
            reason: "Improved engagement hooks",
          },
        ],
        hashtags: ["#trending", "#social"],
        mentions: [],
        mediasuggestions: [],
        platformSpecific: {},
      },
      metadata: { provider: "openai", model: "gpt-4", tokensUsed: 150, latency: 500 },
    }),
    generateVariations: async (_content: string, _type: string, count: number) => ({
      success: true,
      variations: Array.from({ length: count }, (_, i) => `Variation ${i + 1}`),
      metadata: { provider: "openai" },
    }),
    analyzeContent: async () => ({
      success: true,
      analysis: {
        tone: {
          detected: "enthusiastic",
          confidence: 0.85,
          suggestions: ["conversational", "professional"],
        },
      },
      metadata: { provider: "openai" },
    }),
    generateContent: async () => {
      throw new Error("Not needed");
    },
    predictPerformance: async () => {
      throw new Error("Not needed");
    },
    smartAnalysis: async () => {
      throw new Error("Not needed");
    },
    healthCheck: async () => ({ status: "healthy" }),
    getMetrics: async () => ({ success: true }),
    clearCache: async () => ({ success: true }),
  } as any;
}

describe("ML Use Cases (Tier 0)", () => {
  const testAccountId = randomUUID();

  describe("OptimizeContentUseCase — Heuristic Fallback", () => {
    let useCase: OptimizeContentUseCase;

    beforeEach(() => {
      useCase = new OptimizeContentUseCase(createFailingAIServiceMock());
    });

    it("returns recommendations when AI is unavailable (heuristic fallback)", async () => {
      const input: OptimizeContentInput = {
        content: "Check out our new product launch! #product",
        provider: "X",
        optimizationGoal: "engagement",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.optimizedContent.length > 0).toBeTruthy();
      expect(Array.isArray(result.value.recommendations)).toBeTruthy();
      expect(result.value.recommendations.length > 0).toBeTruthy();
      expect(typeof result.value.predictedImprovement).toBe("number");
      expect(result.value.optimizationGoal).toBe("engagement");
      expect(result.value.originalContent).toBe(input.content);
    });

    it("optimizes content for reach on Facebook via heuristic fallback", async () => {
      const input: OptimizeContentInput = {
        content: "Important announcement for our community",
        provider: "FACEBOOK",
        optimizationGoal: "reach",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.optimizationGoal).toBe("reach");
    });

    it("generates requested number of heuristic variations", async () => {
      const input: OptimizeContentInput = {
        content: "Join us for an exciting event!",
        provider: "INSTAGRAM",
        optimizationGoal: "engagement",
        generateVariations: true,
        variationCount: 3,
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.variations).toBeTruthy();
      expect(result.value.variations?.length).toBe(3);
      for (const variation of result.value.variations ?? []) {
        expect(variation.content.length > 0).toBeTruthy();
        expect(Array.isArray(variation.changes)).toBeTruthy();
        expect(typeof variation.expectedImprovement).toBe("number");
      }
    });

    it("rejects empty content with VALIDATION_FAILED", async () => {
      const input: OptimizeContentInput = {
        content: "",
        provider: "X",
        optimizationGoal: "engagement",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("truncates content exceeding X platform limit of 280 chars", async () => {
      const longContent = "A".repeat(500);
      const input: OptimizeContentInput = {
        content: longContent,
        provider: "X",
        optimizationGoal: "engagement",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.optimizedContent.length <= 280).toBeTruthy();
      expect(
        result.value.recommendations.some((r) => r.includes("truncat") || r.includes("limit"))
      ).toBeTruthy();
    });

    it("includes heuristic tone analysis when requested", async () => {
      const input: OptimizeContentInput = {
        content: "Amazing product launch!",
        provider: "INSTAGRAM",
        optimizationGoal: "engagement",
        includeToneAnalysis: true,
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.toneAnalysis).toBeTruthy();
      expect(result.value.toneAnalysis?.currentTone).toBeTruthy();
      expect(Array.isArray(result.value.toneAnalysis?.suggestedTones)).toBeTruthy();
    });
  });

  describe("OptimizeContentUseCase — AI-powered", () => {
    let useCase: OptimizeContentUseCase;

    beforeEach(() => {
      useCase = new OptimizeContentUseCase(createSuccessfulAIServiceMock());
    });

    it("returns AI-generated optimization when AI is available", async () => {
      const input: OptimizeContentInput = {
        content: "Check out our new product launch!",
        provider: "X",
        optimizationGoal: "engagement",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.optimizedContent).toBe("AI-optimized content here");
      expect(result.value.recommendations.some((r) => r.includes("engagement hooks"))).toBeTruthy();
      expect(result.value.recommendations.some((r) => r.includes("#trending"))).toBeTruthy();
    });

    it("returns AI-generated variations when requested", async () => {
      const input: OptimizeContentInput = {
        content: "Join us for an exciting event!",
        provider: "INSTAGRAM",
        optimizationGoal: "engagement",
        generateVariations: true,
        variationCount: 2,
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.variations).toBeTruthy();
      expect(result.value.variations?.length).toBe(2);
      expect(result.value.variations?.[0]?.content).toBe("Variation 1");
    });

    it("returns AI tone analysis when requested", async () => {
      const input: OptimizeContentInput = {
        content: "Amazing product launch!",
        provider: "INSTAGRAM",
        optimizationGoal: "engagement",
        includeToneAnalysis: true,
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.toneAnalysis).toBeTruthy();
      expect(result.value.toneAnalysis?.currentTone).toBe("enthusiastic");
      expect(result.value.toneAnalysis?.suggestedTones).toEqual(["conversational", "professional"]);
    });
  });

  describe("PredictOptimalTimingUseCase", () => {
    it("predicts optimal posting times with scored slots", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const input: PredictTimingInput = {
        accountId: testAccountId,
        provider: "X",
        contentType: "text",
        timezone: "America/New_York",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(Array.isArray(result.value.optimalSlots)).toBeTruthy();
      expect(result.value.optimalSlots.length > 0).toBeTruthy();

      const firstSlot = result.value.optimalSlots[0];
      expect(firstSlot).toBeTruthy();
      expect(firstSlot.dayOfWeek >= 0 && firstSlot.dayOfWeek <= 6).toBeTruthy();
      expect(firstSlot.hour >= 0 && firstSlot.hour <= 23).toBeTruthy();
      expect(typeof firstSlot.score).toBe("number");
      expect(firstSlot.score > 0).toBeTruthy();
      for (let i = 1; i < result.value.optimalSlots.length; i++) {
        const prev = result.value.optimalSlots[i - 1]!;
        const curr = result.value.optimalSlots[i]!;
        expect(prev.score >= curr.score).toBeTruthy();
      }
    });

    it("produces different results for different content types", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const textResult = await useCase.execute({
        accountId: testAccountId,
        provider: "INSTAGRAM",
        contentType: "text",
        timezone: "UTC",
      });

      const videoResult = await useCase.execute({
        accountId: testAccountId,
        provider: "INSTAGRAM",
        contentType: "video",
        timezone: "UTC",
      });

      expect(textResult.ok && videoResult.ok).toBeTruthy();
      const textTop = textResult.value.optimalSlots[0];
      const videoTop = videoResult.value.optimalSlots[0];
      expect(textTop && videoTop).toBeTruthy();
      expect(videoTop.score >= textTop.score).toBeTruthy();
    });

    it("includes activity patterns when requested", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const input: PredictTimingInput = {
        accountId: testAccountId,
        provider: "FACEBOOK",
        contentType: "image",
        timezone: "Europe/London",
        includeActivityPatterns: true,
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      expect(result.value.activityPatterns).toBeTruthy();
      expect(Array.isArray(result.value.activityPatterns)).toBeTruthy();
      expect(result.value.activityPatterns.length).toBe(168);
    });

    it("rejects invalid provider with VALIDATION_FAILED", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const input = {
        accountId: testAccountId,
        provider: "INVALID_PROVIDER" as never,
        contentType: "text",
        timezone: "UTC",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeFalsy();
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(result.error.message).toMatch(/invalid provider/i);
    });

    it("includes recommendations", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const result = await useCase.execute({
        accountId: testAccountId,
        provider: "LINKEDIN",
        contentType: "text",
        timezone: "UTC",
      });

      expect(result.ok).toBeTruthy();
      expect(Array.isArray(result.value.recommendations)).toBeTruthy();
      expect(result.value.recommendations.length > 0).toBeTruthy();
    });
  });
});
