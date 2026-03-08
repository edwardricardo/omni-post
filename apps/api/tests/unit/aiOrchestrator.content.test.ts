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
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

describe("AIOrchestrator — Content & Errors", { concurrency: 1 }, () => {
  let envSnapshot: Record<string, string | undefined>;

  // Suppress console.log from AIOrchestrator source (would corrupt TAP output)
  let _originalConsoleLog: typeof console.log;
  before(() => {
    _originalConsoleLog = console.log;
    console.log = () => {};
    envSnapshot = captureAndClearAIEnv();
  });

  after(() => {
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

  describe("Content Generation", { concurrency: 1 }, () => {
    it("should generate text content", async () => {
      const messages: AIMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Write a tweet about AI" },
      ];

      const result = await orchestrator.generateContent(messages);

      assert.strictEqual(result.ok, true, "Should succeed");
      if (result.ok) {
        assert.ok(result.value, "Should have generated content");
        assert.ok(typeof result.value === "string", "Should return string");
        assert.ok(result.value.includes("AI"), "Should include requested topic");
      }
    });

    it("should pass generation options to provider", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Test" }];
      const options = { maxTokens: 100, temperature: 0.7 };

      await orchestrator.generateContent(messages, options);

      assert.strictEqual(mockOpenAI.callCount, 1, "Should call provider");
    });
  });

  // -------------------------------------------------------------------------
  // Content Analysis
  // -------------------------------------------------------------------------

  describe("Content Analysis", { concurrency: 1 }, () => {
    it("should analyze content sentiment", async () => {
      const result = await orchestrator.analyzeContent("This is great content!", "sentiment");

      assert.strictEqual(result.ok, true, "Should succeed");
      if (result.ok) {
        assert.ok(result.value.sentiment, "Should have sentiment analysis");
        assert.strictEqual(result.value.sentiment?.label, "positive");
        assert.ok(result.value.sentiment?.confidence > 0.5);
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

        assert.strictEqual(result.ok, true, `Should analyze ${type}`);
        assert.ok(mockOpenAI.lastRequest, `Should have called provider for ${type}`);
        assert.strictEqual(mockOpenAI.lastRequest.analysisType, type);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Content Optimization
  // -------------------------------------------------------------------------

  describe("Content Optimization", { concurrency: 1 }, () => {
    it("should optimize content for platform", async () => {
      const result = await orchestrator.optimizeContent("Test content", "twitter");

      assert.strictEqual(result.ok, true, "Should succeed");
      if (result.ok) {
        assert.ok(result.value.optimizedText, "Should have optimized text");
        assert.ok(Array.isArray(result.value.changes), "Should have changes list");
        assert.ok(Array.isArray(result.value.hashtags), "Should have hashtags");
        assert.ok(result.value.platformSpecific, "Should have platform-specific data");
      }
    });

    it("should apply brand voice to optimization", async () => {
      const result = await orchestrator.optimizeContent(
        "Test content",
        "linkedin",
        "Professional and authoritative"
      );

      assert.strictEqual(result.ok, true, "Should succeed");
      assert.ok(mockOpenAI.lastRequest, "Should have called provider");
    });
  });

  // -------------------------------------------------------------------------
  // Performance Prediction
  // -------------------------------------------------------------------------

  describe("Performance Prediction", { concurrency: 1 }, () => {
    it("should predict content performance", async () => {
      const result = await orchestrator.predictPerformance("Great content about tech", "twitter");

      assert.strictEqual(result.ok, true, "Should succeed");
      if (result.ok) {
        assert.ok(result.value.metrics, "Should have metrics");
        assert.ok(result.value.metrics.expectedEngagement, "Should have engagement prediction");
        assert.ok(result.value.metrics.expectedReach, "Should have reach prediction");
        assert.ok(result.value.optimalTiming, "Should have timing recommendation");
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

      assert.strictEqual(result.ok, true, "Should succeed");
      assert.ok(mockPerplexity.lastRequest, "Should call provider");
    });
  });

  // -------------------------------------------------------------------------
  // Content Variations
  // -------------------------------------------------------------------------

  describe("Content Variations", { concurrency: 1 }, () => {
    it("should generate content variations", async () => {
      const result = await orchestrator.generateVariations("Original content", "tone", 3);

      assert.strictEqual(result.ok, true, "Should succeed");
      if (result.ok) {
        assert.ok(Array.isArray(result.value), "Should return array");
        assert.strictEqual(result.value.length, 3, "Should generate requested count");
      }
    });

    it("should generate different variation types", async () => {
      const variationTypes: ("tone" | "length" | "audience")[] = ["tone", "length", "audience"];

      for (const type of variationTypes) {
        mockOpenAI.reset();

        const result = await orchestrator.generateVariations("Test content", type, 2, {
          cacheResults: false,
        });

        assert.strictEqual(result.ok, true, `Should generate ${type} variations`);
        if (result.ok) {
          assert.strictEqual(result.value.length, 2, `Should generate 2 ${type} variations`);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe("Error Handling", { concurrency: 1 }, () => {
    it("should handle provider timeout gracefully", async (t) => {
      t.timeout = 10000;

      // Create slow provider (2s latency — will be outrun by fallback providers)
      const slowProvider = new MockAIProvider("openai", true, false, 2000);
      (orchestrator as any).providers.set("openai", slowProvider);

      const messages: AIMessage[] = [{ role: "user", content: "Test" }];

      // Should timeout and fallback — slow provider will take too long
      const result = await orchestrator.generateContent(messages, { cacheResults: false });

      assert.strictEqual(result.ok, true, "Should fallback on timeout");
    });

    it("should provide detailed error information", async (t) => {
      t.timeout = 15000;

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

      assert.strictEqual(result.ok, false, "Should fail");
      if (!result.ok) {
        assert.ok(result.error, "Should have error object");
        assert.ok(result.error.code, "Should have error code");
        assert.ok(result.error.message, "Should have error message");
        assert.strictEqual(
          typeof result.error.retryable,
          "boolean",
          "Should indicate retryability"
        );
      }
    });
  });
});
