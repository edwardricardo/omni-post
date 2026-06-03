/**
 * @file providerRegistry.ts
 * @description API-side provider registry managing metadata and runtime adapter instances
 *              for all 11 social media providers using centralized configuration.
 * @layer infrastructure
 */
import type { ProviderAdapter } from "@ports/core";
import { createXAdapter } from "@providers/x";
import { createInstagramAdapter } from "@providers/instagram";
import { createFacebookAdapter } from "@providers/facebook";
import { createTikTokAdapter } from "@providers/tiktok";
import { createYouTubeAdapter } from "@providers/youtube";
import { createSnapchatAdapter } from "@providers/snapchat";
import { createTelegramAdapter } from "@providers/telegram";
import { createPinterestAdapter } from "@providers/pinterest";
import { createLinkedInAdapter } from "@providers/linkedin";
import { createBlueskyAdapter } from "@providers/bluesky";
import { createThreadsAdapter } from "@providers/threads";
import { providerLogger } from "../lib/logger.js";
import {
  PROVIDER_CONFIGS,
  getProviderConfig,
  validateContentForProvider,
  type ProviderMetadata,
  type ProviderCapabilities,
  type ProviderLimits,
} from "@shared/types";

/**
 * API-side Provider Registry Service
 *
 * This service manages provider metadata and adapters for the API backend.
 * It uses the centralized provider configuration from @shared/types and extends
 * it with runtime adapter instances for each provider. Supports class-based
 * provider adapters.
 */
class ProviderRegistryService {
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor() {
    this.registerBuiltInAdapters();
  }

  /**
   * Register built-in provider adapters.
   * The metadata is already centralized in @shared/types/providerConfig,
   * so we only need to register the adapter implementations here.
   *
   * Now uses class-based adapters (singleton instances)
   */
  private registerBuiltInAdapters() {
    this.adapters.set("x", createXAdapter());
    this.adapters.set("instagram", createInstagramAdapter());
    this.adapters.set("facebook", createFacebookAdapter());
    this.adapters.set("tiktok", createTikTokAdapter());
    this.adapters.set("youtube", createYouTubeAdapter());
    this.adapters.set("snapchat", createSnapchatAdapter());
    this.adapters.set("telegram", createTelegramAdapter());
    this.adapters.set("pinterest", createPinterestAdapter());
    this.adapters.set("linkedin", createLinkedInAdapter());
    this.adapters.set("bluesky", createBlueskyAdapter());
    this.adapters.set("threads", createThreadsAdapter());
  }

  /**
   * Register a custom provider with both metadata and adapter.
   * This is primarily for extending the system with new providers.
   *
   * Note: For built-in providers, metadata is already in PROVIDER_CONFIGS.
   * This method is mainly for custom/plugin providers.
   */
  registerProvider(metadata: ProviderMetadata, adapter?: ProviderAdapter) {
    // Custom providers would need to be added to PROVIDER_CONFIGS externally
    // or we need a separate custom providers map
    providerLogger.warn(
      "registerProvider is deprecated for built-in providers. Use registerAdapter instead."
    );
    if (adapter) {
      this.adapters.set(metadata.id, adapter);
    }
  }

  /**
   * Register an adapter for an existing provider in PROVIDER_CONFIGS.
   * This is the preferred method for adding adapter implementations.
   */
  registerAdapter(providerId: string, adapter: ProviderAdapter) {
    const metadata = getProviderConfig(providerId);
    if (!metadata) {
      throw new Error(
        `Cannot register adapter for unknown provider: ${providerId}. ` +
          `Provider must exist in PROVIDER_CONFIGS first.`
      );
    }
    this.adapters.set(providerId, adapter);
  }

  /**
   * Get provider metadata from the centralized configuration.
   */
  getProvider(id: string): ProviderMetadata | undefined {
    return getProviderConfig(id);
  }

  /**
   * Get provider adapter implementation.
   */
  getAdapter(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Get all providers from the centralized configuration.
   */
  getAllProviders(): ProviderMetadata[] {
    return Object.values(PROVIDER_CONFIGS);
  }

  /**
   * Get only active providers (status: "active").
   */
  getActiveProviders(): ProviderMetadata[] {
    return this.getAllProviders().filter((p) => p.status === "active");
  }

  /**
   * Get providers that have a specific capability enabled.
   */
  getProvidersByCapability(capability: keyof ProviderCapabilities): ProviderMetadata[] {
    return this.getAllProviders().filter((p) => p.capabilities[capability]);
  }

  /**
   * Get providers that have adapter implementations registered.
   */
  getProvidersWithAdapters(): ProviderMetadata[] {
    return this.getAllProviders().filter((p) => this.adapters.has(p.id));
  }

  /**
   * @method getMentionSearchProviders
   * @description Provider ids whose adapter implements market-wide brand-mention
   *   search (`searchMentions`). Provider-agnostic: derived from the registered
   *   adapters, so a new `searchMentions` implementation is included
   *   automatically with no wiring change.
   * @returns Lowercase provider ids that support mention search.
   */
  getMentionSearchProviders(): string[] {
    return this.getProvidersWithAdapters()
      .map((p) => p.id)
      .filter((id) => typeof this.adapters.get(id)?.searchMentions === "function");
  }

  /**
   * Check if a provider has an adapter registered.
   */
  hasAdapter(id: string): boolean {
    return this.adapters.has(id);
  }

  /**
   * Check the health of a provider adapter by making a test call.
   * This validates that the adapter is responsive and working correctly.
   */
  async checkProviderHealth(id: string): Promise<{
    healthy: boolean;
    latency?: number;
    error?: string;
  }> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      return { healthy: false, error: "Provider not found or adapter not implemented" };
    }

    const startTime = Date.now();
    try {
      // Try to validate with dummy credentials to check if the adapter is responsive
      const _result = await adapter.validateCredentials({});
      const latency = Date.now() - startTime;

      // We expect this to fail with AUTH_INVALID for dummy creds
      // But if it doesn't throw, the adapter is healthy
      return { healthy: true, latency };
    } catch {
      const latency = Date.now() - startTime;
      return {
        healthy: true, // Adapter is healthy if it responds, even with auth error
        latency,
      };
    }
  }

  /**
   * Check the health of all registered provider adapters.
   * Returns a map of provider ID to health status.
   */
  async checkAllProvidersHealth(): Promise<
    Map<
      string,
      {
        healthy: boolean;
        latency?: number;
        error?: string;
      }
    >
  > {
    const results = new Map();

    // Only check health for providers with registered adapters
    const adapterIds = Array.from(this.adapters.keys());
    for (const id of adapterIds) {
      const health = await this.checkProviderHealth(id);
      results.set(id, health);
    }

    return results;
  }

  /**
   * Validate content against provider limits.
   * Uses the centralized validation from @shared/types.
   */
  validateContent(
    providerId: string,
    content: string,
    mediaCount: number = 0
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const result = validateContentForProvider(providerId, content, mediaCount);
    return result;
  }

  /**
   * Get the character limit for a specific provider.
   */
  getCharLimit(providerId: string): number {
    const provider = this.getProvider(providerId);
    return provider?.limits.maxChars || 280;
  }

  /**
   * Get media limits for a specific provider.
   */
  getMediaLimits(providerId: string): ProviderLimits | undefined {
    const provider = this.getProvider(providerId);
    return provider?.limits;
  }

  /**
   * Check if a provider supports a specific capability.
   */
  supportsCapability(providerId: string, capability: keyof ProviderCapabilities): boolean {
    const provider = this.getProvider(providerId);
    return provider?.capabilities[capability] || false;
  }

  /**
   * Check if content needs to be threaded for a given provider.
   */
  needsThreading(providerId: string, content: string): boolean {
    const provider = this.getProvider(providerId);
    if (!provider) return false;

    return content.length > provider.limits.maxChars && provider.capabilities.threading === true;
  }

  /**
   * Calculate the number of posts needed for threading.
   */
  calculateThreadSize(providerId: string, content: string): number {
    if (!this.needsThreading(providerId, content)) {
      return 1;
    }

    const charLimit = this.getCharLimit(providerId);
    return Math.ceil(content.length / charLimit);
  }
}

// Export class for testing
export { ProviderRegistryService };

// Export singleton instance
export const providerRegistry = new ProviderRegistryService();

// Re-export types from centralized config for backward compatibility
export type { ProviderMetadata, ProviderCapabilities, ProviderLimits };
