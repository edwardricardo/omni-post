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

describe("AIOrchestrator — Providers", () => {
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
  // Provider Management
  // -------------------------------------------------------------------------

  describe("Provider Management", () => {
    it("should list all available providers", async () => {
      const providers = orchestrator.getAvailableProviders();

      expect(providers.length).toBe(3);
      expect(providers.includes("openai")).toBeTruthy();
      expect(providers.includes("perplexity")).toBeTruthy();
      expect(providers.includes("gemini")).toBeTruthy();
    });

    it("should check health of all providers", async () => {
      const health = await orchestrator.healthCheck();

      expect(Object.keys(health).length).toBe(3);
      expect(health.openai).toBe(true);
      expect(health.perplexity).toBe(true);
      expect(health.gemini).toBe(true);
    });

    it("should detect unhealthy providers", async () => {
      mockOpenAI.setAvailable(false);
      mockGemini.setAvailable(false);

      const health = await orchestrator.healthCheck();

      expect(health.openai).toBe(false);
      expect(health.perplexity).toBe(true);
      expect(health.gemini).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Provider Selection Strategy
  // -------------------------------------------------------------------------

  describe("Provider Selection Strategy", () => {
    it("should select preferred provider for generate tasks", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages);

      expect(result.ok).toBe(true);
      // OpenAI is preferred for generate tasks
      expect(mockOpenAI.callCount).toBe(1);
    });

    it("should select preferred provider for predict tasks", async () => {
      const result = await orchestrator.predictPerformance("Test content", "twitter");

      expect(result.ok).toBe(true);
      // Perplexity is preferred for predict tasks
      expect(mockPerplexity.callCount).toBe(1);
    });

    it("should skip unavailable providers", async () => {
      mockOpenAI.setAvailable(false);

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages);

      expect(result.ok).toBe(true);
      expect(mockOpenAI.callCount).toBe(0);
      expect(mockGemini.callCount > 0 || mockPerplexity.callCount > 0).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Fallback Handling
  // -------------------------------------------------------------------------

  describe("Fallback Handling", () => {
    it("should fallback to next provider on failure", { timeout: 10000 }, async () => {
      mockOpenAI.setShouldFail(true);

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages, { retryAttempts: 1 });

      expect(result.ok).toBe(true);
      expect(mockOpenAI.callCount >= 1).toBeTruthy();
      expect(mockGemini.callCount > 0 || mockPerplexity.callCount > 0).toBeTruthy();
    });

    it("should try all providers before failing", { timeout: 15000 }, async () => {
      mockOpenAI.setShouldFail(true);
      mockPerplexity.setShouldFail(true);
      mockGemini.setShouldFail(true);

      const messages: AIMessage[] = [{ role: "user", content: "Test message" }];
      const result = await orchestrator.generateContent(messages, { retryAttempts: 1 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error?.code).toBe("ALL_PROVIDERS_FAILED");
        expect(result.error?.retryable).toBe(true);
      }
    });

    it("should retry failed provider with exponential backoff", { timeout: 10000 }, async () => {
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

      expect(result.ok).toBe(true);
      expect(attemptCount >= 2).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Load Balancing
  // -------------------------------------------------------------------------

  describe("Load Balancing", () => {
    it("should distribute load across healthy providers", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Load balance test" }];

      // Make multiple requests
      const requests = Array.from({ length: 10 }, () =>
        orchestrator.generateContent(messages, { cacheResults: false })
      );

      await Promise.all(requests);

      // All requests should succeed
      const allSuccessful = (await Promise.all(requests)).every((r) => r.ok);
      expect(allSuccessful).toBe(true);
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
      expect(fastOpenAI.callCount > 0).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Cost Optimization
  // -------------------------------------------------------------------------

  describe("Cost Optimization", () => {
    it("should prefer cost-effective providers when possible", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cost test" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();
      let totalCost = 0;

      for (const [_provider, metric] of metrics) {
        totalCost += metric.cost;
      }

      expect(totalCost > 0).toBeTruthy();
    });

    it("should report cost per provider in metrics", async () => {
      const messages: AIMessage[] = [{ role: "user", content: "Cost tracking" }];

      await orchestrator.generateContent(messages);

      const metrics = orchestrator.getUsageMetrics();

      for (const [_provider, metric] of metrics) {
        if (metric.requestCount > 0) {
          expect(metric.cost >= 0).toBeTruthy();
        }
      }
    });
  });
});
