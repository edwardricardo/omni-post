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
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import type { RateLimiterPort } from "@ports/core";
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

  /**
   * @method isAvailable
   * @description Answers the availability the test set, so the orchestrator skips or uses this
   *   provider on the test's say.
   * @returns Whether the provider reports itself available.
   */
  async isAvailable(): Promise<boolean> {
    return this._isAvailable;
  }

  /**
   * @method setAvailable
   * @description Sets the availability `isAvailable` answers from now on.
   * @param available - Whether the provider reports itself available.
   */
  setAvailable(available: boolean): void {
    this._isAvailable = available;
  }

  /**
   * @method setShouldFail
   * @description Makes every later call throw before answering, or answer again.
   * @param fail - Whether each call throws a provider failure.
   */
  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  /**
   * @description Holds a call for this provider's configured latency, as a remote model API would.
   * @returns A promise that resolves once the latency has passed.
   */
  private respondAfterLatency(): Promise<void> {
    // fixed-wait: latency-injection — the double stands for a model API that takes time to answer
    // The orchestrator measures each call with Date.now(), and the sibling suites build slow and
    // fast providers from this latency. A suite that asserts on the measured value fakes the
    // timers and advances them by exactly the latency, so its result never depends on the host.
    return new Promise((resolve) => setTimeout(resolve, this.latency));
  }

  /**
   * @method generateText
   * @description Counts the call, records the request, and answers with text naming this
   *   provider and the last message after its latency; throws a provider failure when set to fail.
   * @param messages - The conversation; the last message is echoed in the answer.
   * @param _options - Generation options; unused.
   * @returns The generated text.
   */
  async generateText(messages: AIMessage[], _options?: any): Promise<string> {
    this.callCount++;
    this.lastRequest = { type: "generate", messages };

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    await this.respondAfterLatency();
    return `Generated text from ${this.name}: ${messages[messages.length - 1]?.content || ""}`;
  }

  /**
   * @method analyzeContent
   * @description Counts the call, records the request, and answers with a fixed positive
   *   sentiment after its latency; throws a provider failure when set to fail.
   * @param content - The content to analyze.
   * @param analysisType - The analysis asked for, recorded with the request.
   * @returns A partial analysis carrying the sentiment.
   */
  async analyzeContent(
    content: string,
    analysisType: "sentiment" | "tone" | "readability" | "engagement"
  ): Promise<Partial<ContentAnalysis>> {
    this.callCount++;
    this.lastRequest = { type: "analyze", content, analysisType };

    if (this.shouldFail) {
      throw new Error(`${this.name} provider failed`);
    }

    await this.respondAfterLatency();

    const analysis: Partial<ContentAnalysis> = {
      sentiment: {
        score: 0.8,
        label: "positive",
        confidence: 0.95,
      },
    };

    return analysis;
  }

  /**
   * @method optimizeContent
   * @description Counts the call, records the request, and answers with the content prefixed by
   *   this provider's name after its latency; throws a provider failure when set to fail.
   * @param content - The content to optimize.
   * @param platform - The target platform, keyed in the platform-specific result.
   * @param _brandVoice - The brand voice; unused.
   * @returns The optimization naming this provider.
   */
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

    await this.respondAfterLatency();

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

  /**
   * @method predictPerformance
   * @description Counts the call, records the request, and answers with a fixed prediction for
   *   the platform after its latency; throws a provider failure when set to fail.
   * @param content - The content whose performance is predicted.
   * @param platform - The platform the prediction is for.
   * @param _historicalData - Past performance; unused.
   * @returns The fixed prediction.
   */
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

    await this.respondAfterLatency();

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

  /**
   * @method generateVariations
   * @description Counts the call, records the request, and answers with `count` variations
   *   naming this provider after its latency; throws a provider failure when set to fail.
   * @param content - The content to vary.
   * @param variationType - The kind of variation, named in each variation.
   * @param count - How many variations to answer with.
   * @returns The variations.
   */
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

    await this.respondAfterLatency();

    return Array.from(
      { length: count },
      (_, i) => `${this.name} variation ${i + 1} (${variationType}): ${content}`
    );
  }

  /**
   * @method reset
   * @description Clears the call count and the last request, and makes the provider available
   *   and answering again.
   */
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

/**
 * @description Builds an AIOrchestrator over three fresh mock providers, an in-memory cache and
 *   a no-op scheduler, with zeroed usage metrics for each provider.
 * @param latencies - Each mock provider's latency, in milliseconds.
 * @param opts - The rate limiter to inject, when the test exercises throttling.
 * @returns The orchestrator and the three mock providers behind it.
 */
export function createOrchestrator(
  latencies = { openai: 50, perplexity: 75, gemini: 100 },
  opts: { rateLimiter?: RateLimiterPort } = {}
): OrchestratorFixture {
  const mockOpenAI = new MockAIProvider("openai", true, false, latencies.openai);
  const mockPerplexity = new MockAIProvider("perplexity", true, false, latencies.perplexity);
  const mockGemini = new MockAIProvider("gemini", true, false, latencies.gemini);

  const providers = new Map<string, AIProvider>();
  providers.set("openai", mockOpenAI);
  providers.set("perplexity", mockPerplexity);
  providers.set("gemini", mockGemini);

  const orchestrator = new AIOrchestrator(
    providers,
    new NoopBackgroundTaskScheduler(),
    new InMemoryCacheAdapter(),
    undefined,
    undefined,
    opts.rateLimiter
  );

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

/**
 * @description Captures and clears the AI provider keys, so real providers don't init during
 *   tests.
 * @returns The keys as they were, for restoreAIEnv().
 */
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

/**
 * @description Restores the AI provider keys saved by captureAndClearAIEnv(), deleting any that
 *   were unset.
 * @param snapshot - The keys as captureAndClearAIEnv() returned them.
 */
export function restoreAIEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}
