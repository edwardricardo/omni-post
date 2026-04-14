/**
 * @file AIProviderFactory.ts
 * @description Factory for creating AI provider instances from credentials.
 *   Builds providers from raw API keys with sensible defaults.
 * @layer application
 */
import type { AIProvider, AIProviderConfig } from "./types.js";
import { OpenAIProvider } from "./providers/openai.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { PerplexityProvider } from "./providers/perplexity.js";

type ProviderName = "openai" | "anthropic" | "gemini" | "perplexity";

const PROVIDER_DEFAULTS: Record<
  ProviderName,
  { defaultModel: string; ProviderClass: new (config: AIProviderConfig) => AIProvider }
> = {
  openai: { defaultModel: "gpt-4o", ProviderClass: OpenAIProvider },
  anthropic: { defaultModel: "claude-sonnet-4-6", ProviderClass: AnthropicProvider },
  gemini: { defaultModel: "gemini-1.5-pro", ProviderClass: GeminiProvider },
  perplexity: {
    defaultModel: "llama-3.1-sonar-large-128k-online",
    ProviderClass: PerplexityProvider,
  },
};

const DEFAULT_RATE_LIMIT = {
  requestsPerMinute: 500,
  tokensPerMinute: 200_000,
  requestsPerDay: 10_000,
  tokensPerDay: 2_000_000,
};

/**
 * @class AIProviderFactory
 * @description Static factory for creating AIProvider instances from credentials.
 */
export class AIProviderFactory {
  /**
   * @method createProvider
   * @description Creates an AIProvider from a raw API key and optional model override.
   * @param providerName - One of openai, anthropic, gemini, perplexity
   * @param apiKey - The API key for the provider
   * @param model - Optional model override (uses provider default if omitted)
   * @returns Configured AIProvider instance
   */
  static createProvider(providerName: ProviderName, apiKey: string, model?: string): AIProvider {
    const def = PROVIDER_DEFAULTS[providerName];
    return new def.ProviderClass({
      apiKey,
      model: model ?? def.defaultModel,
      rateLimit: DEFAULT_RATE_LIMIT,
      timeout: 30_000,
      retries: 3,
    });
  }
}
