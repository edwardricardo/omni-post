/**
 * @file perplexity.test-helpers.ts
 * @description Test helpers for perplexity test helpers
 * @layer infrastructure
 */
import type { AIProviderConfig } from "../../../src/ai/types.js";

export const mockConfig: AIProviderConfig = {
  apiKey: "test-perplexity-api-key",
  model: "llama-3.1-sonar-small-128k-online",
  timeout: 30000,
  retries: 3,
  rateLimit: {
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
    requestsPerDay: 1000,
    tokensPerDay: 1000000,
  },
};
