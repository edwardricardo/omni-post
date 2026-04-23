/**
 * Shared test helpers for AIOrchestrator test suites.
 *
 * Provides the MockAIProvider class and an `createOrchestrator()` factory
 * so every test file can initialize its own isolated AIOrchestrator instance
 * without duplicating setup code.
 *
 * @file aiOrchestrator.helpers.ts
 * @description Test helpers for ai orchestrator helpers
 * @layer infrastructure
 */

import { AIOrchestrator } from "../../src/ai/orchestrator.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import type {
  AIProvider,
  AIMessage,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
} from "../../src/ai/types.js";

// ---------------------------------------------------------------------------
// Mock AI Provider implementation
// ---------------------------------------------------------------------------

export class MockAIProvider implements AIProvider {
  name: "openai" | "anthropic" | "perplexity" | "gemini";
  private _isAvailable: boolean;
  private shouldFail: boolean;
  private latency: number;
  callCount: number;
  lastRequest: any;

  constructor(
    name: "openai" | "anthropic" | "perplexity" | "gemini",
    isAvailable = true,
    shouldFail = false,
    latency = 100
  ) {
    this.name = name;
    this._isAvailable = isAvailable;
    this.shouldFail = shouldFail;
    this.latency = latency;
    this.callCount = 0;
    this.lastRequest = null;
  }

  async isAvailable(): Promise<boolean> {
    return this._isAvailable;
  }

  setAvailable(available: boolean): void {
    this._isAvailable = available;
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  async generateText(messages: AIMessage[], _options?: any): Promise<string> {
    this.callCount++;
    this.lastRequest = { type: "generate", messages };

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, this.latency));
    return `Generated text from ${this.name}: ${messages[messages.length - 1]?.content || ""}`;
  }

  async analyzeContent(
    content: string,
    analysisType: "sentiment" | "tone" | "readability" | "engagement"
  ): Promise<Partial<ContentAnalysis>> {
    this.callCount++;
    this.lastRequest = { type: "analyze", content, analysisType };

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, this.latency));

    const analysis: Partial<ContentAnalysis> = {
      sentiment: {
        score: 0.8,
        label: "positive",
        confidence: 0.95,
      },
    };

    return analysis;
  }

  async optimizeContent(
    content: string,
    platform: string,
    _brandVoice?: string
  ): Promise<ContentOptimization> {
    this.callCount++;
    this.lastRequest = { type: "optimize", content, platform };

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, this.latency));

    return {
      optimizedText: `Optimized by ${this.name}: ${content}`,
      changes: [
        {
          type: "modified",
          original: content,
          optimized: `Optimized by ${this.name}: ${content}`,
          reason: "Enhanced engagement",
        },
      ],
      hashtags: ["#test", "#ai"],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {
        [platform]: {
          text: `Optimized by ${this.name}: ${content}`,
          characterCount: content.length + 20,
          optimizations: ["Added hashtags", "Improved readability"],
        },
      },
    };
  }

  async predictPerformance(
    content: string,
    platform: string,
    _historicalData?: any[]
  ): Promise<PerformancePrediction> {
    this.callCount++;
    this.lastRequest = { type: "predict", content, platform };

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, this.latency));

    return {
      platform,
      metrics: {
        expectedEngagement: {
          value: 1000,
          confidence: 0.85,
          range: { min: 800, max: 1200 },
        },
        expectedReach: {
          value: 5000,
          confidence: 0.8,
          range: { min: 4000, max: 6000 },
        },
        viralPotential: 0.7,
        conversionPotential: 0.6,
      },
      optimalTiming: {
        hour: 14,
        day: "Wednesday",
        timezone: "UTC",
        confidence: 0.9,
      },
      competitiveAnalysis: {
        benchmarkScore: 85,
        opportunities: ["Trending topic", "High engagement window"],
        threats: ["Market saturation"],
      },
    };
  }

  async generateVariations(
    content: string,
    variationType: "tone" | "length" | "audience",
    count: number
  ): Promise<string[]> {
    this.callCount++;
    this.lastRequest = { type: "variations", content, variationType, count };

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, this.latency));

    return Array.from(
      { length: count },
      (_, i) => `${this.name} variation ${i + 1} (${variationType}): ${content}`
    );
  }

  reset(): void {
    this.callCount = 0;
    this.lastRequest = null;
    this._isAvailable = true;
    this.shouldFail = false;
  }
}

// ---------------------------------------------------------------------------
// Factory: creates a fresh AIOrchestrator with 3 injected mock providers
// ---------------------------------------------------------------------------

export interface OrchestratorFixture {
  orchestrator: AIOrchestrator;
  mockOpenAI: MockAIProvider;
  mockPerplexity: MockAIProvider;
  mockGemini: MockAIProvider;
}

export function createOrchestrator(
  latencies = { openai: 50, perplexity: 75, gemini: 100 }
): OrchestratorFixture {
  const mockOpenAI = new MockAIProvider("openai", true, false, latencies.openai);
  const mockPerplexity = new MockAIProvider("perplexity", true, false, latencies.perplexity);
  const mockGemini = new MockAIProvider("gemini", true, false, latencies.gemini);

  const providers = new Map<string, AIProvider>();
  providers.set("openai", mockOpenAI);
  providers.set("perplexity", mockPerplexity);
  providers.set("gemini", mockGemini);

  const orchestrator = new AIOrchestrator(providers, new NoopBackgroundTaskScheduler());

  // Initialize usage metrics for each mock provider
  for (const provider of ["openai", "perplexity", "gemini"]) {
    (orchestrator as any).usageMetrics.set(provider, {
      provider,
      tokensUsed: 0,
      requestCount: 0,
      successRate: 100,
      averageLatency: 0,
      cost: 0,
      timestamp: new Date(),
    });
  }

  return { orchestrator, mockOpenAI, mockPerplexity, mockGemini };
}

// ---------------------------------------------------------------------------
// Shared env setup / teardown
// ---------------------------------------------------------------------------

/** Capture + clear AI env vars so real providers don't init during tests. */
export function captureAndClearAIEnv(): Record<string, string | undefined> {
  const snapshot = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.GEMINI_API_KEY;
  return snapshot;
}

/** Restore env vars saved by captureAndClearAIEnv(). */
export function restoreAIEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Handle unref helper (prevents blocking process exit)
// ---------------------------------------------------------------------------

/** Unref all active handles so the process can exit cleanly. */
export function unrefActiveHandles(): void {
  const handles = (process as any)._getActiveHandles?.() ?? [];
  for (const h of handles) {
    if (typeof h.unref === "function") h.unref();
  }
}
