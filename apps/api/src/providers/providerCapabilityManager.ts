import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderId,
} from "./providerAdapter.interface.js";
import type { CanonicalPost } from "@shared/types";

export type CapabilityQuery = {
  requiredCapabilities?: (keyof ProviderCapabilities)[];
  optionalCapabilities?: (keyof ProviderCapabilities)[];
  minCharacterLimit?: number;
  maxCharacterLimit?: number;
  mediaRequired?: boolean;
  threadingRequired?: boolean;
  schedulingRequired?: boolean;
  analyticsRequired?: boolean;
};

export type ProviderScore = {
  providerId: ProviderId;
  score: number;
  matches: (keyof ProviderCapabilities)[];
  missing: (keyof ProviderCapabilities)[];
  limitations: string[];
  recommendations: string[];
};

export type CapabilityMatrix = {
  [K in keyof ProviderCapabilities]: ProviderId[];
};

export type ContentCompatibility = {
  providerId: ProviderId;
  compatible: boolean;
  adaptationRequired: boolean;
  limitations: Array<{
    type: "character_limit" | "media_count" | "media_type" | "threading" | "scheduling" | "other";
    message: string;
    severity: "blocking" | "warning" | "info";
    suggestion?: string;
  }>;
  estimatedReach?: number;
  optimalTiming?: Date[];
};

/**
 * Manages provider capabilities and helps with provider selection
 * based on content requirements and user preferences
 */
export class ProviderCapabilityManager {
  private providers: Map<ProviderId, ProviderAdapter> = new Map();
  private capabilityMatrix: CapabilityMatrix;

  constructor(providers: ProviderAdapter[] = []) {
    providers.forEach((provider) => this.registerProvider(provider));
    this.capabilityMatrix = this.buildCapabilityMatrix();
  }

  /**
   * Register a provider with the capability manager
   */
  registerProvider(provider: ProviderAdapter): void {
    this.providers.set(provider.id, provider);
    this.capabilityMatrix = this.buildCapabilityMatrix();
  }

  /**
   * Remove a provider from the capability manager
   */
  unregisterProvider(providerId: ProviderId): void {
    this.providers.delete(providerId);
    this.capabilityMatrix = this.buildCapabilityMatrix();
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers that match specific capabilities
   */
  getProvidersByCapability(capability: keyof ProviderCapabilities): ProviderAdapter[] {
    return Array.from(this.providers.values()).filter(
      (provider) => provider.capabilities[capability] === true
    );
  }

  /**
   * Get providers that support all required capabilities
   */
  getCompatibleProviders(query: CapabilityQuery): ProviderScore[] {
    const scores: ProviderScore[] = [];

    for (const provider of this.providers.values()) {
      const score = this.scoreProvider(provider, query);
      if (score.score > 0) {
        scores.push(score);
      }
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Score a provider based on capability requirements
   */
  private scoreProvider(provider: ProviderAdapter, query: CapabilityQuery): ProviderScore {
    let score = 0;
    const matches: (keyof ProviderCapabilities)[] = [];
    const missing: (keyof ProviderCapabilities)[] = [];
    const limitations: string[] = [];
    const recommendations: string[] = [];

    // Check required capabilities
    if (query.requiredCapabilities) {
      for (const capability of query.requiredCapabilities) {
        if (provider.capabilities[capability]) {
          matches.push(capability);
          score += 10; // High weight for required capabilities
        } else {
          missing.push(capability);
          score = 0; // Provider is incompatible if missing required capabilities
          break;
        }
      }
    }

    // If provider failed required capabilities, return early
    if (score === 0 && query.requiredCapabilities?.length) {
      return {
        providerId: provider.id,
        score: 0,
        matches,
        missing,
        limitations: [`Missing required capabilities: ${missing.join(", ")}`],
        recommendations: [],
      };
    }

    // Check optional capabilities (bonus points)
    if (query.optionalCapabilities) {
      for (const capability of query.optionalCapabilities) {
        if (provider.capabilities[capability]) {
          matches.push(capability);
          score += 5; // Lower weight for optional capabilities
        }
      }
    }

    // Check character limits
    if (query.minCharacterLimit && provider.limits.maxChars < query.minCharacterLimit) {
      limitations.push(
        `Character limit too low (${provider.limits.maxChars} < ${query.minCharacterLimit})`
      );
      score -= 5;
    }

    if (query.maxCharacterLimit && provider.limits.maxChars > query.maxCharacterLimit) {
      recommendations.push(
        `Consider using full character limit (${provider.limits.maxChars} available)`
      );
    }

    // Check media requirements
    if (query.mediaRequired && provider.limits.maxMediaPerPost === 0) {
      limitations.push("Media not supported");
      score -= 10;
    }

    // Check threading requirements
    if (query.threadingRequired && !provider.capabilities.threading) {
      limitations.push("Threading not supported");
      score -= 8;
    }

    // Check scheduling requirements
    if (query.schedulingRequired && !provider.capabilities.schedule) {
      limitations.push("Scheduling not supported");
      score -= 6;
    }

    // Check analytics requirements
    if (query.analyticsRequired && !provider.capabilities.analytics) {
      limitations.push("Analytics not supported");
      score -= 4;
    }

    // Provider status bonus/penalty
    switch (provider.metadata.status) {
      case "active":
        score += 2;
        break;
      case "beta":
        score -= 1;
        recommendations.push("Provider is in beta - expect possible issues");
        break;
      case "maintenance":
        score -= 5;
        limitations.push("Provider is under maintenance");
        break;
      case "deprecated":
        score -= 10;
        limitations.push("Provider is deprecated");
        break;
    }

    return {
      providerId: provider.id,
      score: Math.max(0, score),
      matches: [...new Set(matches)], // Remove duplicates
      missing,
      limitations,
      recommendations,
    };
  }

  /**
   * Check content compatibility across all providers
   */
  async checkContentCompatibility(
    content: CanonicalPost,
    targetProviders?: ProviderId[]
  ): Promise<ContentCompatibility[]> {
    const providers = targetProviders
      ? Array.from(this.providers.values()).filter((p) => targetProviders.includes(p.id))
      : Array.from(this.providers.values());

    const results: ContentCompatibility[] = [];

    for (const provider of providers) {
      try {
        const validation = await provider.validateContent(content);
        const limitations = validation.errors.map((error) => {
          const suggestion = validation.suggestions.find((s) => s.type === "truncate")?.message;
          return {
            type: this.mapErrorToLimitationType(error.field),
            message: error.message,
            severity: error.severity as "blocking" | "warning" | "info",
            ...(suggestion ? { suggestion } : {}),
          };
        });

        results.push({
          providerId: provider.id,
          compatible: validation.valid,
          adaptationRequired: validation.suggestions.length > 0,
          limitations,
          estimatedReach: this.estimateReach(provider.id, content),
          optimalTiming: await this.getOptimalTiming(provider.id),
        });
      } catch (error: unknown) {
        results.push({
          providerId: provider.id,
          compatible: false,
          adaptationRequired: false,
          limitations: [
            {
              type: "other",
              message: `Validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              severity: "blocking",
            },
          ],
        });
      }
    }

    return results;
  }

  /**
   * Get the capability matrix showing which providers support which capabilities
   */
  getCapabilityMatrix(): CapabilityMatrix {
    return { ...this.capabilityMatrix };
  }

  /**
   * Get aggregated statistics about capabilities across all providers
   */
  getCapabilityStatistics(): {
    totalProviders: number;
    capabilitySupport: Record<keyof ProviderCapabilities, number>;
    averageCharacterLimit: number;
    averageMediaSupport: number;
    mostSupportedCapabilities: (keyof ProviderCapabilities)[];
    leastSupportedCapabilities: (keyof ProviderCapabilities)[];
  } {
    const providers = Array.from(this.providers.values());
    const totalProviders = providers.length;

    const capabilitySupport: Record<keyof ProviderCapabilities, number> = {
      publish: 0,
      schedule: 0,
      analytics: 0,
      comments: 0,
      replies: 0,
      threading: 0,
      stories: 0,
      reels: 0,
      carousel: 0,
      liveStreaming: 0,
      directMessages: 0,
    };

    let totalCharacters = 0;
    let totalMediaSlots = 0;

    for (const provider of providers) {
      Object.keys(capabilitySupport).forEach((capability) => {
        if (provider.capabilities[capability as keyof ProviderCapabilities]) {
          capabilitySupport[capability as keyof ProviderCapabilities]++;
        }
      });

      totalCharacters += provider.limits.maxChars;
      totalMediaSlots += provider.limits.maxMediaPerPost;
    }

    const sortedCapabilities = Object.entries(capabilitySupport).sort(([, a], [, b]) => b - a);

    return {
      totalProviders,
      capabilitySupport,
      averageCharacterLimit: Math.round(totalCharacters / totalProviders),
      averageMediaSupport: Math.round(totalMediaSlots / totalProviders),
      mostSupportedCapabilities: sortedCapabilities
        .slice(0, 3)
        .map(([cap]) => cap as keyof ProviderCapabilities),
      leastSupportedCapabilities: sortedCapabilities
        .slice(-3)
        .map(([cap]) => cap as keyof ProviderCapabilities),
    };
  }

  /**
   * Suggest optimal provider combinations for cross-platform publishing
   */
  suggestProviderCombinations(
    query: CapabilityQuery & {
      maxProviders?: number;
      prioritizeReach?: boolean;
      avoidOverlap?: boolean;
    }
  ): ProviderId[][] {
    const compatibleProviders = this.getCompatibleProviders(query);
    const maxProviders = query.maxProviders || 3;
    const combinations: ProviderId[][] = [];

    if (compatibleProviders.length === 0) {
      return combinations;
    }

    // Single provider combinations
    compatibleProviders.slice(0, maxProviders).forEach((provider) => {
      combinations.push([provider.providerId]);
    });

    // Two provider combinations
    if (maxProviders >= 2) {
      for (let i = 0; i < Math.min(compatibleProviders.length, 3); i++) {
        for (let j = i + 1; j < Math.min(compatibleProviders.length, 3); j++) {
          const provider1 = compatibleProviders[i]?.providerId;
          const provider2 = compatibleProviders[j]?.providerId;
          if (!provider1 || !provider2) continue;
          const combo = [provider1, provider2];
          if (!query.avoidOverlap || !this.hasAudienceOverlap(combo)) {
            combinations.push(combo);
          }
        }
      }
    }

    // Three provider combinations
    if (maxProviders >= 3) {
      for (let i = 0; i < Math.min(compatibleProviders.length, 2); i++) {
        for (let j = i + 1; j < Math.min(compatibleProviders.length, 3); j++) {
          for (let k = j + 1; k < Math.min(compatibleProviders.length, 4); k++) {
            const provider1 = compatibleProviders[i]?.providerId;
            const provider2 = compatibleProviders[j]?.providerId;
            const provider3 = compatibleProviders[k]?.providerId;
            if (!provider1 || !provider2 || !provider3) continue;
            const combo = [provider1, provider2, provider3];
            if (!query.avoidOverlap || !this.hasAudienceOverlap(combo)) {
              combinations.push(combo);
            }
          }
        }
      }
    }

    return combinations;
  }

  // Private helper methods

  private buildCapabilityMatrix(): CapabilityMatrix {
    const matrix: Partial<CapabilityMatrix> = {};

    for (const provider of this.providers.values()) {
      Object.entries(provider.capabilities).forEach(([capability, supported]) => {
        if (supported) {
          const cap = capability as keyof ProviderCapabilities;
          if (!matrix[cap]) {
            matrix[cap] = [];
          }
          matrix[cap]!.push(provider.id);
        }
      });
    }

    return matrix as CapabilityMatrix;
  }

  private mapErrorToLimitationType(field: string): ContentCompatibility["limitations"][0]["type"] {
    switch (field) {
      case "content":
      case "text":
        return "character_limit";
      case "media":
        return "media_count";
      case "mediaType":
        return "media_type";
      case "thread":
        return "threading";
      case "schedule":
        return "scheduling";
      default:
        return "other";
    }
  }

  private estimateReach(providerId: ProviderId, _content: CanonicalPost): number {
    // Future: query AnalyticsRepository for historical reach data per provider
    const baseReach: Record<ProviderId, number> = {
      x: 1000,
      instagram: 1500,
      facebook: 2000,
      youtube: 5000,
      tiktok: 3000,
      linkedin: 800,
      pinterest: 600,
      snapchat: 900,
      telegram: 700,
    };

    return baseReach[providerId] || 500;
  }

  private async getOptimalTiming(_providerId: ProviderId): Promise<Date[]> {
    // Future: use TimingPredictor / engagement analytics per provider
    const now = new Date();
    const optimalTimes: Date[] = [];

    // Add some optimal times for the next week
    for (let i = 1; i <= 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      date.setHours(9, 0, 0, 0); // 9 AM
      optimalTimes.push(new Date(date));

      date.setHours(15, 0, 0, 0); // 3 PM
      optimalTimes.push(new Date(date));

      date.setHours(19, 0, 0, 0); // 7 PM
      optimalTimes.push(new Date(date));
    }

    return optimalTimes;
  }

  private hasAudienceOverlap(providers: ProviderId[]): boolean {
    // Future: use AudienceAnalyzer cross-platform overlap data
    const overlaps: Record<string, boolean> = {
      "x,facebook": true,
      "instagram,facebook": true,
      "youtube,tiktok": false,
      "linkedin,x": true,
    };

    const key = providers.sort().join(",");
    return overlaps[key] || false;
  }
}

// Singleton instance for global use
export const capabilityManager = new ProviderCapabilityManager();
