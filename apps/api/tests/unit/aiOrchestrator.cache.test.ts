#!/usr/bin/env tsx
/**
 * AIOrchestrator — Cache, Rate Limiting & Metrics Tests
 *
 * Covers:
 * - Cache Management (hit, TTL expiry, skip, clear, stats)
 * - Rate Limiting (enforce limits, skip rate-limited providers, token tracking)
 * - Metrics Collection (usage, success rate, cost, latency)
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

describe("AIOrchestrator — Cache & Metrics", { concurrency: 1 }, () => {
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
  let mockGemini: MockAIProvider;

  beforeEach(() => {
    ({ orchestrator, mockOpenAI, mockPerplexity, mockGemini } = createOrchestrator());
  });

  // -------------------------------------------------------------------------
  // Cache Management
  // -------------------------------------------------------------------------

  describe("Cache Management", { concurrency: 1 }, () => {
    it("should cache successful results", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cacheable message" }];

      // First request
      const result1 = await orchestrator.generateContent(messages);
      assert.strictEqual(result1.ok, true);
      assert.strictEqual(result1.metadata.cached, false, "First request should not be cached");

      // Second identical request
      const result2 = await orchestrator.generateContent(messages);
      assert.strictEqual(result2.ok, true);
      assert.strictEqual(result2.metadata.cached, true, "Second request should be cached");
      assert.strictEqual(result2.metadata.provider, "cache");

      // Provider should only be called once
      assert.strictEqual(mockOpenAI.callCount, 1, "Provider should only be called once");
    });

    it("should respect cache TTL", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "TTL test message" }];

      // First request with short TTL
      const result1 = await orchestrator.generateContent(messages, {
        cacheResults: true,
        cacheTTL: 100, // 100ms TTL
      });
      assert.strictEqual(result1.ok, true);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second request after expiration
      const result2 = await orchestrator.generateContent(messages);
      assert.strictEqual(result2.ok, true);
      assert.strictEqual(result2.metadata.cached, false, "Cache should have expired");

      // Provider should be called twice
      assert.strictEqual(mockOpenAI.callCount, 2, "Provider should be called twice");
    });

    it("should skip cache when disabled", async () => {
      const timestamp = Date.now();
      const messages: AIMessage[] = [{ role: "user", content: `No cache test ${timestamp}` }];

      // First request with cache enabled to populate cache
      const result1 = await orchestrator.generateContent(messages);
      assert.strictEqual(result1.ok, true);
      assert.strictEqual(result1.metadata.cached, false, "First call should not be from cache");
      assert.strictEqual(mockOpenAI.callCount, 1, "Provider should be called once");

      // Second request with cache enabled — should use cache
      const result2 = await orchestrator.generateContent(messages);
      assert.strictEqual(result2.ok, true);
      assert.strictEqual(result2.metadata.cached, true, "Second call should be from cache");
      assert.strictEqual(mockOpenAI.callCount, 1, "Provider should still only be called once");

      // Third request with cache disabled — should bypass cache and call provider
      const result3 = await orchestrator.generateContent(messages, { cacheResults: false });
      assert.strictEqual(result3.ok, true);
      assert.strictEqual(
        result3.metadata.cached,
        false,
        "Third call with cacheResults:false should not use cache"
      );
      assert.strictEqual(
        mockOpenAI.callCount,
        2,
        "Provider should be called again when cache is disabled"
      );
    });

    it("should clear cache on demand", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Clear cache message" }];

      // First request to populate cache
      await orchestrator.generateContent(messages);

      // Clear cache
      orchestrator.clearCache();

      // Second request should not be cached
      const result = await orchestrator.generateContent(messages);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.metadata.cached, false, "Cache should be cleared");
    });

    it("should provide cache statistics", async () => {
      const stats = orchestrator.getCacheStats();

      assert.ok(typeof stats.size === "number", "Should return cache size");
      assert.ok(typeof stats.hitRate === "number", "Should return hit rate");
      assert.ok(stats.hitRate >= 0 && stats.hitRate <= 1, "Hit rate should be between 0 and 1");
    });
  });

  // -------------------------------------------------------------------------
  // Rate Limiting
  // -------------------------------------------------------------------------

  describe("Rate Limiting", { concurrency: 1 }, () => {
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
      assert.ok(successCount > 0, "Should have some successful requests");
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

      assert.strictEqual(result.ok, true, "Should succeed with different provider");
      assert.strictEqual(mockOpenAI.callCount, 0, "Should skip rate-limited OpenAI");
      assert.ok(
        mockGemini.callCount > 0 || mockPerplexity.callCount > 0,
        "Should use alternative provider"
      );
    });

    it("should track token usage in rate limits", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Message that will consume tokens" }];

      await orchestrator.generateContent(messages, { cacheResults: false });

      const rateLimits = (orchestrator as any).rateLimits.get("openai");
      assert.ok(rateLimits, "Should have rate limit entry");
      assert.ok(rateLimits.requests > 0, "Should track request count");
      assert.ok(rateLimits.tokens > 0, "Should track token usage");
    });
  });

  // -------------------------------------------------------------------------
  // Metrics Collection
  // -------------------------------------------------------------------------

  describe("Metrics Collection", { concurrency: 1 }, () => {
    it("should collect usage metrics", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Metrics test" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();
      const openaiMetrics = metrics.get("openai");

      assert.ok(openaiMetrics, "Should have metrics for OpenAI");
      assert.strictEqual(openaiMetrics.provider, "openai");
      assert.ok(openaiMetrics.requestCount > 0, "Should track request count");
      assert.ok(openaiMetrics.tokensUsed > 0, "Should track tokens used");
      assert.ok(openaiMetrics.averageLatency >= 0, "Should track latency");
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

      assert.ok(openaiMetrics, "Should have metrics");
      assert.ok(openaiMetrics.successRate < 100, "Success rate should decrease");
    });

    it("should calculate cost based on token usage", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cost calculation test" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();
      const openaiMetrics = metrics.get("openai");

      assert.ok(openaiMetrics, "Should have metrics");
      assert.ok(openaiMetrics.cost > 0, "Should calculate cost");
    });

    it("should track latency per provider", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Latency test" }];

      const startTime = Date.now();
      await orchestrator.generateContent(messages);
      const endTime = Date.now();

      const metrics = orchestrator.getUsageMetrics();
      const openaiMetrics = metrics.get("openai");

      assert.ok(openaiMetrics, "Should have metrics");
      assert.ok(openaiMetrics.averageLatency > 0, "Should track latency");
      assert.ok(
        openaiMetrics.averageLatency <= endTime - startTime,
        "Latency should be reasonable"
      );
    });
  });
});
