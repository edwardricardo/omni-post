/**
 * @file gemini.test-helpers.ts
 * @description Test helpers for gemini test helpers
 * @layer infrastructure
 */
import type { AIProviderConfig } from "../../../src/ai/types.js";

export const mockConfig: AIProviderConfig = {
  apiKey: "test-gemini-api-key",
  model: "gemini-1.5-flash",
  timeout: 30000,
  retries: 3,
  rateLimit: {
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
    requestsPerDay: 1000,
    tokensPerDay: 1000000,
  },
};

export function makeMockClient(generateContentImpl: (...args: any[]) => any) {
  return {
    models: {
      generateContent: generateContentImpl,
    },
  };
}
