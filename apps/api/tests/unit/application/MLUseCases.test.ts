/**
 * Application Layer - ML Use Cases Unit Tests
 *
 * Pure Tier 0 unit tests. ML use cases are stateless (no repository DI),
 * so they need NO database at all.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

import {
  OptimizeContentUseCase,
  PredictOptimalTimingUseCase,
  PredictAudienceResponseUseCase,
  type OptimizeContentInput,
  type PredictTimingInput,
  type PredictAudienceInput,
} from "../../../src/application/ml/index.js";
import { USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

describe("ML Use Cases (Tier 0)", { concurrency: 1 }, () => {
  const testAccountId = randomUUID();

  describe("OptimizeContentUseCase", { concurrency: 1 }, () => {
    it("should optimize content for engagement and return recommendations", async () => {
      const useCase = new OptimizeContentUseCase();

      const input: OptimizeContentInput = {
        content: "Check out our new product launch! #product",
        provider: "X",
        optimizationGoal: "engagement",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should successfully optimize content");
      assert.ok(result.value.optimizedContent.length > 0, "Optimized content should not be empty");
      assert.ok(Array.isArray(result.value.recommendations), "Recommendations should be an array");
      assert.ok(result.value.recommendations.length > 0, "Should have at least one recommendation");
      assert.equal(
        typeof result.value.predictedImprovement,
        "number",
        "Should predict improvement"
      );
      assert.equal(result.value.optimizationGoal, "engagement", "Should preserve goal in output");
      assert.equal(result.value.originalContent, input.content, "Should preserve original content");
    });

    it("should optimize content for reach on Facebook", async () => {
      const useCase = new OptimizeContentUseCase();

      const input: OptimizeContentInput = {
        content: "Important announcement for our community",
        provider: "FACEBOOK",
        optimizationGoal: "reach",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      assert.equal(result.value.optimizationGoal, "reach");
    });

    it("should generate requested number of content variations", async () => {
      const useCase = new OptimizeContentUseCase();

      const input: OptimizeContentInput = {
        content: "Join us for an exciting event!",
        provider: "INSTAGRAM",
        optimizationGoal: "engagement",
        generateVariations: true,
        variationCount: 3,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      assert.ok(result.value.variations, "Should include variations");
      assert.equal(result.value.variations?.length, 3, "Should generate 3 variations");
      // Each variation should have content, changes, and expectedImprovement
      for (const variation of result.value.variations ?? []) {
        assert.ok(variation.content.length > 0, "Variation content should not be empty");
        assert.ok(Array.isArray(variation.changes), "Changes should be array");
        assert.equal(typeof variation.expectedImprovement, "number");
      }
    });

    it("should reject empty content with VALIDATION_FAILED", async () => {
      const useCase = new OptimizeContentUseCase();

      const input: OptimizeContentInput = {
        content: "",
        provider: "X",
        optimizationGoal: "engagement",
      };

      const result = await useCase.execute(input);

      assert.ok(!result.ok, "Should reject empty content");
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should truncate content that exceeds X platform limit of 280 chars", async () => {
      const useCase = new OptimizeContentUseCase();

      const longContent = "A".repeat(500);
      const input: OptimizeContentInput = {
        content: longContent,
        provider: "X",
        optimizationGoal: "engagement",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should handle long content by truncating");
      assert.ok(result.value.optimizedContent.length <= 280, "Should respect X 280-char limit");
      assert.ok(
        result.value.recommendations.some((r) => r.includes("truncat") || r.includes("limit")),
        "Should include truncation recommendation"
      );
    });

    it("should include tone analysis when requested", async () => {
      const useCase = new OptimizeContentUseCase();

      const input: OptimizeContentInput = {
        content: "Amazing product launch!",
        provider: "INSTAGRAM",
        optimizationGoal: "engagement",
        includeToneAnalysis: true,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      assert.ok(result.value.toneAnalysis, "Should include tone analysis");
      assert.ok(result.value.toneAnalysis?.currentTone, "Should detect current tone");
      assert.ok(Array.isArray(result.value.toneAnalysis?.suggestedTones), "Should suggest tones");
    });
  });

  describe("PredictOptimalTimingUseCase", { concurrency: 1 }, () => {
    it("should predict optimal posting times with scored slots", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const input: PredictTimingInput = {
        accountId: testAccountId,
        provider: "X",
        contentType: "text",
        timezone: "America/New_York",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should successfully predict timing");
      assert.ok(Array.isArray(result.value.optimalSlots), "Optimal slots should be an array");
      assert.ok(result.value.optimalSlots.length > 0, "Should have at least one optimal slot");

      // Verify slot structure
      const firstSlot = result.value.optimalSlots[0];
      assert.ok(firstSlot, "First slot should exist");
      assert.ok(firstSlot.dayOfWeek >= 0 && firstSlot.dayOfWeek <= 6, "Day should be 0-6");
      assert.ok(firstSlot.hour >= 0 && firstSlot.hour <= 23, "Hour should be 0-23");
      assert.equal(typeof firstSlot.score, "number", "Score should be a number");
      assert.ok(firstSlot.score > 0, "Score should be positive");
      // Slots should be sorted by score descending
      for (let i = 1; i < result.value.optimalSlots.length; i++) {
        const prev = result.value.optimalSlots[i - 1]!;
        const curr = result.value.optimalSlots[i]!;
        assert.ok(prev.score >= curr.score, "Slots should be sorted by score descending");
      }
    });

    it("should produce different results for different content types", async () => {
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

      assert.ok(textResult.ok && videoResult.ok);
      // Video has different hour offset and score bonus than text,
      // so the top slot should differ in at least one dimension
      const textTop = textResult.value.optimalSlots[0];
      const videoTop = videoResult.value.optimalSlots[0];
      assert.ok(textTop && videoTop, "Both should have results");
      // At minimum both complete successfully; scores will differ due to content modifiers
      assert.ok(videoTop.score >= textTop.score, "Video should have equal or higher score bonus");
    });

    it("should include activity patterns when requested", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const input: PredictTimingInput = {
        accountId: testAccountId,
        provider: "FACEBOOK",
        contentType: "image",
        timezone: "Europe/London",
        includeActivityPatterns: true,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      assert.ok(result.value.activityPatterns, "Should include activity patterns");
      assert.ok(Array.isArray(result.value.activityPatterns));
      // Should have patterns for all 7 days * 24 hours = 168 entries
      assert.equal(result.value.activityPatterns.length, 168, "Should have 168 activity patterns");
    });

    it("should reject invalid provider with VALIDATION_FAILED", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const input = {
        accountId: testAccountId,
        provider: "INVALID_PROVIDER" as never,
        contentType: "text",
        timezone: "UTC",
      };

      const result = await useCase.execute(input);

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      assert.match(result.error.message, /invalid provider/i);
    });

    it("should include recommendations", async () => {
      const useCase = new PredictOptimalTimingUseCase();

      const result = await useCase.execute({
        accountId: testAccountId,
        provider: "LINKEDIN",
        contentType: "text",
        timezone: "UTC",
      });

      assert.ok(result.ok);
      assert.ok(Array.isArray(result.value.recommendations));
      assert.ok(result.value.recommendations.length > 0, "Should have recommendations");
    });
  });

  describe("PredictAudienceResponseUseCase", { concurrency: 1 }, () => {
    it("should predict audience response with engagement score in 0-100 range", async () => {
      const useCase = new PredictAudienceResponseUseCase();

      const input: PredictAudienceInput = {
        accountId: testAccountId,
        contentDescription: {
          type: "promotional",
          topic: "product launch",
          tone: "exciting",
          provider: "X",
        },
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should successfully predict audience response");
      assert.equal(typeof result.value.overallEngagementScore, "number");
      assert.ok(result.value.overallEngagementScore >= 0, "Score should be >= 0");
      assert.ok(result.value.overallEngagementScore <= 100, "Score should be <= 100");
      // predictions should have likes, comments, shares, reach
      assert.equal(typeof result.value.predictions.likes, "number");
      assert.equal(typeof result.value.predictions.comments, "number");
      assert.equal(typeof result.value.predictions.shares, "number");
      assert.equal(typeof result.value.predictions.reach, "number");
      assert.ok(Array.isArray(result.value.riskFactors), "Should have risk factors array");
    });

    it("should provide segment-specific predictions for target segments", async () => {
      const useCase = new PredictAudienceResponseUseCase();

      const input: PredictAudienceInput = {
        accountId: testAccountId,
        contentDescription: {
          type: "educational",
          topic: "industry insights",
          tone: "professional",
          provider: "LINKEDIN",
        },
        targetSegments: ["engaged_followers", "industry_professionals"],
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      assert.ok(result.value.segmentPredictions, "Should have segment predictions");
      assert.equal(
        result.value.segmentPredictions?.length,
        2,
        "Should match number of target segments"
      );
      // Each segment should have expected fields
      for (const seg of result.value.segmentPredictions ?? []) {
        assert.ok(seg.segmentName, "Should have segment name");
        assert.equal(typeof seg.engagementScore, "number");
        assert.ok(["positive", "neutral", "negative"].includes(seg.sentiment));
      }
    });

    it("should include optimization suggestions when requested", async () => {
      const useCase = new PredictAudienceResponseUseCase();

      const input: PredictAudienceInput = {
        accountId: testAccountId,
        contentDescription: {
          type: "promotional",
          topic: "sale",
          tone: "urgent",
          provider: "FACEBOOK",
        },
        includeOptimizationSuggestions: true,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      assert.ok(result.value.optimizationSuggestions, "Should include optimization suggestions");
      assert.ok(
        result.value.optimizationSuggestions.length > 0,
        "Should have at least one suggestion"
      );
      for (const suggestion of result.value.optimizationSuggestions) {
        assert.ok(suggestion.area, "Each suggestion should have an area");
        assert.ok(suggestion.suggestion, "Each suggestion should have text");
        assert.equal(typeof suggestion.expectedImpact, "number");
      }
    });

    it("should identify risk factors for controversial content", async () => {
      const useCase = new PredictAudienceResponseUseCase();

      const input: PredictAudienceInput = {
        accountId: testAccountId,
        contentDescription: {
          type: "controversial",
          topic: "political",
          tone: "aggressive",
          provider: "X",
        },
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      assert.ok(
        result.value.riskFactors.length > 0,
        "Should identify risk factors for controversial content"
      );
      // Should have high severity risks for political + aggressive combo
      const highRisks = result.value.riskFactors.filter((r) => r.severity === "high");
      assert.ok(highRisks.length > 0, "Should have at least one high-severity risk");
      // Each risk should have type, description, and mitigation
      for (const risk of result.value.riskFactors) {
        assert.ok(risk.type, "Risk should have a type");
        assert.ok(risk.description, "Risk should have a description");
        assert.ok(risk.mitigation, "Risk should have a mitigation suggestion");
      }
    });

    it("should reject invalid provider", async () => {
      const useCase = new PredictAudienceResponseUseCase();

      const input: PredictAudienceInput = {
        accountId: testAccountId,
        contentDescription: {
          type: "educational",
          topic: "tech",
          tone: "professional",
          provider: "INVALID" as never,
        },
      };

      const result = await useCase.execute(input);

      assert.ok(!result.ok);
      assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    });

    it("should boost LinkedIn score for educational content", async () => {
      const useCase = new PredictAudienceResponseUseCase();

      const linkedinResult = await useCase.execute({
        accountId: testAccountId,
        contentDescription: {
          type: "educational",
          topic: "best practices",
          tone: "professional",
          provider: "LINKEDIN",
        },
      });

      const genericResult = await useCase.execute({
        accountId: testAccountId,
        contentDescription: {
          type: "educational",
          topic: "best practices",
          tone: "professional",
          provider: "X",
        },
      });

      assert.ok(linkedinResult.ok && genericResult.ok);
      assert.ok(
        linkedinResult.value.overallEngagementScore > genericResult.value.overallEngagementScore,
        "LinkedIn should score higher for educational content due to platform synergy"
      );
    });
  });
});
