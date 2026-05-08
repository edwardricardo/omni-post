/**
 * @file openai.test-helpers.ts
 * @description Test helpers for openai test helpers
 * @layer infrastructure
 */
import type { AIProviderConfig } from "../../../src/ai/types.js";

export const mockConfig: AIProviderConfig = {
  apiKey: "test-openai-api-key",
  model: "gpt-4",
  timeout: 30000,
  retries: 3,
  rateLimit: {
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
    requestsPerDay: 1000,
    tokensPerDay: 1000000,
  },
};
