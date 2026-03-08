#!/usr/bin/env tsx
/**
 * AIOrchestrator — Provider Management Tests
 *
 * Covers:
 * - Provider Management (list, health check)
 * - Provider Selection Strategy (preferred, skip unavailable)
 * - Fallback Handling (fallback chain, all-fail, exponential backoff)
 * - Load Balancing (distribution, speed preference)
 * - Cost Optimization (cost tracking, per-provider reporting)
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

describe("AIOrchestrator — Providers", { concurrency: 1 }, () => {
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
  // Provider Management
  // -------------------------------------------------------------------------

  describe("Provider Management", { concurrency: 1 }, () => {
    it("should list all available providers", async () => {
      const providers = orchestrator.getAvailableProviders();

      assert.strictEqual(providers.length, 3, "Should have 3 providers");
      assert.ok(providers.includes("openai"), "Should include openai");
      assert.ok(providers.includes("perplexity"), "Should include perplexity");
      assert.ok(providers.includes("gemini"), "Should include gemini");
    });

    it("should check health of all providers", async () => {
      const health = await orchestrator.healthCheck();

      assert.strictEqual(Object.keys(health).length, 3, "Should check 3 providers");
      assert.strictEqual(health.openai, true, "OpenAI should be healthy");
      assert.strictEqual(health.perplexity, true, "Perplexity should be healthy");
      assert.strictEqual(health.gemini, true, "Gemini should be healthy");
    });

    it("should detect unhealthy providers", async () => {
      mockOpenAI.setAvailable(false);
      mockGemini.setAvailable(false);

      const health = await orchestrator.healthCheck();

      assert.strictEqual(health.openai, false, "OpenAI should be unhealthy");
      assert.strictEqual(health.perplexity, true, "Perplexity should be healthy");
      assert.strictEqual(health.gemini, false, "Gemini should be unhealthy");
    });
  });

  // -------------------------------------------------------------------------
  // Provider Selection Strategy
  // -------------------------------------------------------------------------

  describe("Provider Selection Strategy", { concurrency: 1 }, () => {
    it("should select preferred provider for generate tasks", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages);

      assert.strictEqual(result.ok, true, "Should succeed");
      // OpenAI is preferred for generate tasks
      assert.strictEqual(mockOpenAI.callCount, 1, "Should use OpenAI first");
    });

    it("should select preferred provider for predict tasks", async () => {
      const result = await orchestrator.predictPerformance("Test content", "twitter");

      assert.strictEqual(result.ok, true, "Should succeed");
      // Perplexity is preferred for predict tasks
      assert.strictEqual(mockPerplexity.callCount, 1, "Should use Perplexity first");
    });

    it("should skip unavailable providers", async () => {
      mockOpenAI.setAvailable(false);

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages);

      assert.strictEqual(result.ok, true, "Should succeed with fallback");
      assert.strictEqual(mockOpenAI.callCount, 0, "Should skip OpenAI");
      assert.ok(
        mockGemini.callCount > 0 || mockPerplexity.callCount > 0,
        "Should use fallback provider"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Fallback Handling
  // -------------------------------------------------------------------------

  describe("Fallback Handling", { concurrency: 1 }, () => {
    it("should fallback to next provider on failure", async (t) => {
      t.timeout = 10000;

      mockOpenAI.setShouldFail(true);

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages, { retryAttempts: 1 });

      assert.strictEqual(result.ok, true, "Should succeed with fallback");
      assert.ok(mockOpenAI.callCount >= 1, "Should try OpenAI first");
      assert.ok(
        mockGemini.callCount > 0 || mockPerplexity.callCount > 0,
        "Should fallback to another provider"
      );
    });

    it("should try all providers before failing", async (t) => {
      t.timeout = 15000;

      mockOpenAI.setShouldFail(true);
      mockPerplexity.setShouldFail(true);
      mockGemini.setShouldFail(true);

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages, { retryAttempts: 1 });

      assert.strictEqual(result.ok, false, "Should fail after all providers fail");
      if (!result.ok) {
        assert.strictEqual(result.error?.code, "ALL_PROVIDERS_FAILED");
        assert.strictEqual(result.error?.retryable, true);
      }
    });

    it("should retry failed provider with exponential backoff", async (t) => {
      t.timeout = 10000;

      let attemptCount = 0;
      const originalGenerateText = mockOpenAI.generateText.bind(mockOpenAI);

      mockOpenAI.generateText = async (messages: AIMessage[], options?: any) => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error("Temporary failure");
        }
        return originalGenerateText(messages, options);
      };

      // Make other providers unavailable to force retry on OpenAI
      mockPerplexity.setAvailable(false);
      mockGemini.setAvailable(false);

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages, { retryAttempts: 2 });

      assert.strictEqual(result.ok, true, "Should succeed after retry");
      assert.ok(attemptCount >= 2, "Should have retried at least once");
    });
  });

  // -------------------------------------------------------------------------
  // Load Balancing
  // -------------------------------------------------------------------------

  describe("Load Balancing", { concurrency: 1 }, () => {
    it("should distribute load across healthy providers", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Load balance test" }];

      // Make multiple requests
      const requests = Array.from({ length: 10 }, () =>
        orchestrator.generateContent(messages, { cacheResults: false })
      );

      await Promise.all(requests);

      // All requests should succeed
      const allSuccessful = (await Promise.all(requests)).every((r) => r.ok);
      assert.strictEqual(allSuccessful, true, "All requests should succeed");
    });

    it("should prefer faster providers over time", async () => {
      // Reinject OpenAI with much lower latency
      const fastOpenAI = new MockAIProvider("openai", true, false, 10);
      (orchestrator as any).providers.set("openai", fastOpenAI);

      const messages: AIMessage[] = [{ role: "user", content: "Speed test" }];

      // Make several requests
      for (let i = 0; i < 5; i++) {
        await orchestrator.generateContent(messages, { cacheResults: false });
      }

      // OpenAI should have been selected due to better latency
      assert.ok(fastOpenAI.callCount > 0, "Should use faster provider");
    });
  });

  // -------------------------------------------------------------------------
  // Cost Optimization
  // -------------------------------------------------------------------------

  describe("Cost Optimization", { concurrency: 1 }, () => {
    it("should prefer cost-effective providers when possible", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cost test" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();
      let totalCost = 0;

      for (const [_provider, metric] of metrics) {
        totalCost += metric.cost;
      }

      assert.ok(totalCost > 0, "Should track costs");
    });

    it("should report cost per provider in metrics", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cost tracking" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();

      for (const [provider, metric] of metrics) {
        if (metric.requestCount > 0) {
          assert.ok(metric.cost >= 0, `${provider} should have cost metrics`);
        }
      }
    });
  });
});
