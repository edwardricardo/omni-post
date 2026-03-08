import type { TestContext } from "node:test";
import Fastify, { FastifyInstance } from "fastify";
import aiRoutes from "../../src/ai/routes.js";
import { aiService } from "../../src/ai/aiService.js";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { prisma } from "@infra/prisma";

export async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const container = setupContainer({ prisma });
  container.registerInstance(TOKENS.AIService, aiService);
  app.decorate("container", container);

  await app.register(aiRoutes, { prefix: "/ai" });
  return app;
}

export const mockHealthCheckResponse = {
  status: "healthy",
  providers: {},
  availableProviders: ["openai", "anthropic"],
  metrics: {},
  cache: { hits: 0, misses: 0, size: 0 },
  timestamp: new Date().toISOString(),
};

export const mockGenerateResponse = {
  success: true,
  content: "Generated content here",
  metadata: { provider: "openai", latency: 100 },
};

export const mockAnalyzeResponse = {
  success: true,
  analysis: {
    sentiment: { score: 0.8, label: "positive" },
  },
  metadata: { provider: "openai", latency: 150 },
};

export const mockOptimizeResponse = {
  success: true,
  optimization: {
    suggestions: ["Use more emojis", "Add hashtags"],
    optimizedContent: "Optimized content",
  },
  metadata: { provider: "openai", latency: 200 },
};

export const mockPredictResponse = {
  success: true,
  prediction: {
    engagementScore: 0.75,
    estimatedReach: 1000,
  },
  metadata: { provider: "openai", latency: 180 },
};

export const mockVariationsResponse = {
  success: true,
  variations: [
    { content: "Variation 1", score: 0.9 },
    { content: "Variation 2", score: 0.85 },
    { content: "Variation 3", score: 0.8 },
  ],
  metadata: { provider: "openai", latency: 250 },
};

export const mockSmartAnalysisResponse = {
  success: true,
  content: "Test content",
  platform: "twitter",
  analysis: {
    sentiment: { score: 0.8, label: "positive" },
    tone: { primary: "professional", confidence: 0.9 },
    readability: { score: 85, level: "easy" },
    engagement: { score: 0.75, factors: ["concise", "clear"] },
  },
  optimization: {
    suggestions: ["Add hashtags"],
    optimizedContent: "Optimized",
  },
  prediction: {
    engagementScore: 0.75,
  },
  metadata: {
    providersUsed: ["openai"],
    totalLatency: 500,
    timestamp: new Date().toISOString(),
  },
};

export const mockMetricsResponse = {
  success: true,
  metrics: {},
  cache: { hits: 10, misses: 5, size: 100 },
  timestamp: new Date().toISOString(),
};

export const mockClearCacheResponse = {
  success: true,
  message: "Cache cleared successfully",
};

/**
 * Sets up all 9 aiService mocks using test-context-scoped t.mock.method().
 * Mocks auto-restore when the test/beforeEach scope ends.
 *
 * @param t - TestContext from beforeEach or it callback
 * @param service - The aiService singleton to mock
 * @param overrides - Optional per-method mock implementations to override defaults
 */
export function setupAiServiceMocks(
  t: TestContext,
  service: typeof aiService,
  overrides?: Partial<
    Record<
      | "healthCheck"
      | "generateContent"
      | "analyzeContent"
      | "optimizeContent"
      | "predictPerformance"
      | "generateVariations"
      | "smartAnalysis"
      | "getMetrics"
      | "clearCache",
      (...args: unknown[]) => unknown
    >
  >
): void {
  t.mock.method(
    service,
    "healthCheck",
    overrides?.healthCheck ?? (async () => mockHealthCheckResponse)
  );
  t.mock.method(
    service,
    "generateContent",
    overrides?.generateContent ?? (async () => mockGenerateResponse)
  );
  t.mock.method(
    service,
    "analyzeContent",
    overrides?.analyzeContent ?? (async () => mockAnalyzeResponse)
  );
  t.mock.method(
    service,
    "optimizeContent",
    overrides?.optimizeContent ?? (async () => mockOptimizeResponse)
  );
  t.mock.method(
    service,
    "predictPerformance",
    overrides?.predictPerformance ?? (async () => mockPredictResponse)
  );
  t.mock.method(
    service,
    "generateVariations",
    overrides?.generateVariations ?? (async () => mockVariationsResponse)
  );
  t.mock.method(
    service,
    "smartAnalysis",
    overrides?.smartAnalysis ?? (async () => mockSmartAnalysisResponse)
  );
  t.mock.method(service, "getMetrics", overrides?.getMetrics ?? (async () => mockMetricsResponse));
  t.mock.method(
    service,
    "clearCache",
    overrides?.clearCache ?? (async () => mockClearCacheResponse)
  );
}

export { aiService };
