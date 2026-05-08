#!/usr/bin/env tsx
/**
 * AIOrchestrator — Content Operations & Error Handling Tests
 *
 * Covers:
 * - Content Generation (text generation, options passthrough)
 * - Content Analysis (sentiment, multi-type)
 * - Content Optimization (platform-specific, brand voice)
 * - Performance Prediction (metrics, historical data)
 * - Content Variations (count, variation types)
 * - Error Handling (timeout fallback, detailed error info)
 *
 * @file aiOrchestrator.content.test.ts
 * @description Tests for AIOrchestrator — Content & Errors
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import type { AIMessage } from "../../src/ai/types.js";
import {
  createOrchestrator,
  captureAndClearAIEnv,
  restoreAIEnv,
  unrefActiveHandles,
  MockAIProvider,
} from "./aiOrchestrator.helpers.js";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AIOrchestrator — Content & Errors", () => {
  let envSnapshot: Record<string, string | undefined>;

  // Suppress console.log from AIOrchestrator source (would corrupt TAP output)
  let _originalConsoleLog: typeof console.log;
  beforeAll(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
    envSnapshot = captureAndClearAIEnv();
  });

  afterAll(() => {
    console.log = _originalConsoleLog;
    restoreAIEnv(envSnapshot);
    unrefActiveHandles();
  });

  // Rebuild fixture for every test
  let orchestrator: ReturnType<typeof createOrchestrator>["orchestrator"];
  let mockOpenAI: MockAIProvider;
  let mockPerplexity: MockAIProvider;

  beforeEach(() => {
    ({ orchestrator, mockOpenAI, mockPerplexity } = createOrchestrator());
  });

  // -------------------------------------------------------------------------
  // Content Generation
  // -------------------------------------------------------------------------

  describe("Content Generation", () => {
    it("should generate text content", async () => {
      const messages: AIMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Write a tweet about AI" },
      ];

      const result = await orchestrator.generateContent(messages);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeTruthy();
        expect(typeof result.value === "string").toBeTruthy();
        expect(result.value.includes("AI")).toBeTruthy();
      }
    });

    it("should pass generation options to provider", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Test" }];
      const options = { maxTokens: 100, temperature: 0.7 };

      await orchestrator.generateContent(messages, options);

      expect(mockOpenAI.callCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Content Analysis
  // -------------------------------------------------------------------------

  describe("Content Analysis", () => {
    it("should analyze content sentiment", async () => {
      const result = await orchestrator.analyzeContent("This is great content!", "sentiment");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sentiment).toBeTruthy();
        expect(result.value.sentiment?.label).toBe("positive");
        expect(result.value.sentiment?.confidence > 0.5).toBeTruthy();
      }
    });

    it("should analyze different content types", async () => {
      const analysisTypes: ("sentiment" | "tone" | "readability" | "engagement")[] = [
        "sentiment",
        "tone",
        "readability",
        "engagement",
      ];

      for (const type of analysisTypes) {
        mockOpenAI.reset();

        const result = await orchestrator.analyzeContent("Test content", type, {
          cacheResults: false,
        });

        expect(result.ok).toBe(true);
        expect(mockOpenAI.lastRequest).toBeTruthy();
        expect(mockOpenAI.lastRequest.analysisType).toBe(type);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Content Optimization
  // -------------------------------------------------------------------------

  describe("Content Optimization", () => {
    it("should optimize content for platform", async () => {
      const result = await orchestrator.optimizeContent("Test content", "twitter");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.optimizedText).toBeTruthy();
        expect(Array.isArray(result.value.changes)).toBeTruthy();
        expect(Array.isArray(result.value.hashtags)).toBeTruthy();
        expect(result.value.platformSpecific).toBeTruthy();
      }
    });

    it("should apply brand voice to optimization", async () => {
      const result = await orchestrator.optimizeContent(
        "Test content",
        "linkedin",
        "Professional and authoritative"
      );

      expect(result.ok).toBe(true);
      expect(mockOpenAI.lastRequest).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Performance Prediction
  // -------------------------------------------------------------------------

  describe("Performance Prediction", () => {
    it("should predict content performance", async () => {
      const result = await orchestrator.predictPerformance("Great content about tech", "twitter");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.metrics).toBeTruthy();
        expect(result.value.metrics.expectedEngagement).toBeTruthy();
        expect(result.value.metrics.expectedReach).toBeTruthy();
        expect(result.value.optimalTiming).toBeTruthy();
      }
    });

    it("should use historical data for prediction", async () => {
      const historicalData = [
        { engagement: 1000, reach: 5000, timestamp: new Date() },
        { engagement: 1200, reach: 6000, timestamp: new Date() },
      ];

      const result = await orchestrator.predictPerformance(
        "Test content",
        "twitter",
        historicalData
      );

      expect(result.ok).toBe(true);
      expect(mockPerplexity.lastRequest).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Content Variations
  // -------------------------------------------------------------------------

  describe("Content Variations", () => {
    it("should generate content variations", async () => {
      const result = await orchestrator.generateVariations("Original content", "tone", 3);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Array.isArray(result.value)).toBeTruthy();
        expect(result.value.length).toBe(3);
      }
    });

    it("should generate different variation types", async () => {
      const variationTypes: ("tone" | "length" | "audience")[] = ["tone", "length", "audience"];

      for (const type of variationTypes) {
        mockOpenAI.reset();

        const result = await orchestrator.generateVariations("Test content", type, 2, {
          cacheResults: false,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.length).toBe(2);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe("Error Handling", () => {
    it("should handle provider timeout gracefully", { timeout: 10000 }, async () => {
      // Create slow provider (2s latency — will be outrun by fallback providers)
      const slowProvider = new MockAIProvider("openai", true, false, 2000);
      (orchestrator as any).providers.set("openai", slowProvider);

      const messages: AIMessage[] = [{ role: "user", content: "Test" }];

      // Should timeout and fallback — slow provider will take too long
      const result = await orchestrator.generateContent(messages, { cacheResults: false });

      expect(result.ok).toBe(true);
    });

    it("should provide detailed error information", { timeout: 15000 }, async () => {
      mockOpenAI.setShouldFail(true);
      // Note: we need a fresh fixture here since mockPerplexity/mockGemini come from createOrchestrator
      const { orchestrator: failOrchestrator } = createOrchestrator();
      const mockP = (failOrchestrator as any).providers.get("perplexity") as MockAIProvider;
      const mockG = (failOrchestrator as any).providers.get("gemini") as MockAIProvider;
      const mockO = (failOrchestrator as any).providers.get("openai") as MockAIProvider;
      mockO.setShouldFail(true);
      mockP.setShouldFail(true);
      mockG.setShouldFail(true);

      const messages: AIMessage[] = [{ role: "user", content: "Test" }];
      const result = await failOrchestrator.generateContent(messages, { retryAttempts: 2 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeTruthy();
        expect(result.error.code).toBeTruthy();
        expect(result.error.message).toBeTruthy();
        expect(typeof result.error.retryable).toBe("boolean");
      }
    });
  });
});
