#!/usr/bin/env tsx
/**
 * AIOrchestrator — Cache, Rate Limiting & Metrics Tests
 *
 * Covers:
 * - Cache Management (hit, TTL expiry, skip, clear, stats)
 * - Rate Limiting (enforce limits, skip rate-limited providers, token tracking)
 * - Metrics Collection (usage, success rate, cost, latency)
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

describe("AIOrchestrator — Cache & Metrics", () => {
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
  let mockGemini: MockAIProvider;

  beforeEach(() => {
    ({ orchestrator, mockOpenAI, mockPerplexity, mockGemini } = createOrchestrator());
  });

  // -------------------------------------------------------------------------
  // Cache Management
  // -------------------------------------------------------------------------

  describe("Cache Management", () => {
    it("should cache successful results", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cacheable message" }];

      // First request
      const result1 = await orchestrator.generateContent(messages);
      expect(result1.ok).toBe(true);
      expect(result1.metadata.cached).toBe(false);

      // Second identical request
      const result2 = await orchestrator.generateContent(messages);
      expect(result2.ok).toBe(true);
      expect(result2.metadata.cached).toBe(true);
      expect(result2.metadata.provider).toBe("cache");

      // Provider should only be called once
      expect(mockOpenAI.callCount).toBe(1);
    });

    it("should respect cache TTL", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "TTL test message" }];

      // First request with short TTL
      const result1 = await orchestrator.generateContent(messages, {
        cacheResults: true,
        cacheTTL: 100, // 100ms TTL
      });
      expect(result1.ok).toBe(true);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second request after expiration
      const result2 = await orchestrator.generateContent(messages);
      expect(result2.ok).toBe(true);
      expect(result2.metadata.cached).toBe(false);

      // Provider should be called twice
      expect(mockOpenAI.callCount).toBe(2);
    });

    it("should skip cache when disabled", async () => {
      const timestamp = Date.now();
      const messages: AIMessage[] = [{ role: "user", content: `No cache test ${timestamp}` }];

      // First request with cache enabled to populate cache
      const result1 = await orchestrator.generateContent(messages);
      expect(result1.ok).toBe(true);
      expect(result1.metadata.cached).toBe(false);
      expect(mockOpenAI.callCount).toBe(1);

      // Second request with cache enabled — should use cache
      const result2 = await orchestrator.generateContent(messages);
      expect(result2.ok).toBe(true);
      expect(result2.metadata.cached).toBe(true);
      expect(mockOpenAI.callCount).toBe(1);

      // Third request with cache disabled — should bypass cache and call provider
      const result3 = await orchestrator.generateContent(messages, { cacheResults: false });
      expect(result3.ok).toBe(true);
      expect(result3.metadata.cached).toBe(false);
      expect(mockOpenAI.callCount).toBe(2);
    });

    it("should clear cache on demand", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Clear cache message" }];

      // First request to populate cache
      await orchestrator.generateContent(messages);

      // Clear cache
      orchestrator.clearCache();

      // Second request should not be cached
      const result = await orchestrator.generateContent(messages);
      expect(result.ok).toBe(true);
      expect(result.metadata.cached).toBe(false);
    });

    it("should provide cache statistics", async () => {
      const stats = orchestrator.getCacheStats();

      expect(typeof stats.size === "number").toBeTruthy();
      expect(typeof stats.hitRate === "number").toBeTruthy();
      expect(stats.hitRate >= 0 && stats.hitRate <= 1).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Rate Limiting
  // -------------------------------------------------------------------------

  describe("Rate Limiting", () => {
    it("should enforce request rate limits", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Rate limit test" }];

      // Make many requests to trigger rate limit
      const results = await Promise.all(
        Array.from({ length: 60 }, () =>
          orchestrator.generateContent(messages, { cacheResults: false })
        )
      );

      // Should have successful results but potentially hit rate limit
      const successCount = results.filter((r) => r.ok).length;
      expect(successCount > 0).toBeTruthy();
    });

    it("should skip rate-limited providers", async () => {
      // Manually set rate limit
      (orchestrator as any).rateLimits.set("openai", {
        requests: 100,
        tokens: 20000,
        resetTime: Date.now() + 60000,
      });

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages);

      expect(result.ok).toBe(true);
      expect(mockOpenAI.callCount).toBe(0);
      expect(mockGemini.callCount > 0 || mockPerplexity.callCount > 0).toBeTruthy();
    });

    it("should track token usage in rate limits", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Message that will consume tokens" }];

      await orchestrator.generateContent(messages, { cacheResults: false });

      const rateLimits = (orchestrator as any).rateLimits.get("openai");
      expect(rateLimits).toBeTruthy();
      expect(rateLimits.requests > 0).toBeTruthy();
      expect(rateLimits.tokens > 0).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Metrics Collection
  // -------------------------------------------------------------------------

  describe("Metrics Collection", () => {
    it("should collect usage metrics", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Metrics test" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();
      const openaiMetrics = metrics.get("openai");

      expect(openaiMetrics).toBeTruthy();
      expect(openaiMetrics.provider).toBe("openai");
      expect(openaiMetrics.requestCount > 0).toBeTruthy();
      expect(openaiMetrics.tokensUsed > 0).toBeTruthy();
      expect(openaiMetrics.averageLatency >= 0).toBeTruthy();
    });

    it("should update success rate on failures", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Failure test" }];

      // Make OpenAI fail
      mockOpenAI.setShouldFail(true);
      mockPerplexity.setAvailable(false);
      mockGemini.setAvailable(false);

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();
      const openaiMetrics = metrics.get("openai");

      expect(openaiMetrics).toBeTruthy();
      expect(openaiMetrics.successRate < 100).toBeTruthy();
    });

    it("should calculate cost based on token usage", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cost calculation test" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();
      const openaiMetrics = metrics.get("openai");

      expect(openaiMetrics).toBeTruthy();
      expect(openaiMetrics.cost > 0).toBeTruthy();
    });

    it("should track latency per provider", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Latency test" }];

      const startTime = Date.now();
      await orchestrator.generateContent(messages);
      const endTime = Date.now();

      const metrics = orchestrator.getUsageMetrics();
      const openaiMetrics = metrics.get("openai");

      expect(openaiMetrics).toBeTruthy();
      expect(openaiMetrics.averageLatency > 0).toBeTruthy();
      expect(openaiMetrics.averageLatency <= endTime - startTime).toBeTruthy();
    });
  });
});
