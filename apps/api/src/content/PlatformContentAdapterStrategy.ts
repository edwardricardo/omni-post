/**
 * Platform Content Adapter - Strategy Selection & Execution
 *
 * Handles adapter initialization, strategy loading, selection,
 * and rule-based content transformation execution.
 *
 * @module content/PlatformContentAdapterStrategy
 */

import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type {
  PlatformAdaptation,
  AdaptationRule,
  OrchestrationResult,
} from "@shared/orchestration";
import type { CanonicalPost, ProviderMetadata } from "@shared/types";
import type { ProviderId, ProviderAdapter } from "../providers/providerAdapter.interface";
import type { EventService } from "../events/EventService";
import { providerRegistry } from "../providers/providerRegistry";
import type {
  AdaptationStrategy,
  ContentTransformer,
  AdaptationContext,
  AdaptationGoal,
  UserAdaptationPreferences,
} from "./platformContentAdapterTypes.js";
import {
  calculateConfidence,
  evaluateCondition,
  buildBuiltInTransformers,
} from "./platformContentAdapterHelpers.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";

/**
 * Strategy selection and execution for platform content adaptation
 */
export class PlatformContentAdapterStrategy {
  private transformers = new Map<string, ContentTransformer>();
  private strategies = new Map<string, AdaptationStrategy>();

  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private eventService: EventService,
    private generateId: () => string
  ) {}

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize the strategy module with built-in transformers and strategies
   */
  async initialize(): Promise<void> {
    await this.registerBuiltInTransformers();
    await this.loadAdaptationStrategies();

    logger.info(
      { transformersCount: this.transformers.size, strategiesCount: this.strategies.size },
      "Platform Content Adapter initialized"
    );

    await this.eventService.publishEvent({
      id: this.generateId(),
      type: "ADAPTER_INITIALIZED",
      aggregateId: "system",
      aggregateType: "PlatformContentAdapter",
      version: 1,
      data: {
        component: "PlatformContentAdapter",
        transformersCount: this.transformers.size,
        strategiesCount: this.strategies.size,
      },
      metadata: { source: "PlatformContentAdapter" },
      timestamp: new Date(),
    });
  }

  get transformerCount(): number {
    return this.transformers.size;
  }

  get strategyCount(): number {
    return this.strategies.size;
  }

  // ---------------------------------------------------------------------------
  // Context Building
  // ---------------------------------------------------------------------------

  /**
   * Build adaptation context for a provider
   */
  buildAdaptationContext(
    content: CanonicalPost,
    providerId: ProviderId,
    provider: ProviderMetadata,
    adapter: ProviderAdapter,
    userPreferences?: UserAdaptationPreferences
  ): AdaptationContext {
    return {
      originalContent: content,
      targetProvider: providerId,
      adaptationGoals: this.generateAdaptationGoals(content, provider),
      constraints: adapter.limits,
      capabilities: adapter.capabilities,
      ...(userPreferences && { userPreferences }),
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy Selection
  // ---------------------------------------------------------------------------

  /**
   * Select the optimal strategy for a given context
   */
  async selectOptimalStrategy(context: AdaptationContext): Promise<AdaptationStrategy> {
    const providerStrategies = Array.from(this.strategies.values()).filter(
      (s) => s.providerId === context.targetProvider && s.enabled
    );

    if (providerStrategies.length === 0) {
      return await this.createProviderStrategy(context.targetProvider);
    }

    let bestStrategy: AdaptationStrategy | undefined = providerStrategies[0];
    let bestScore = 0;

    for (const strategy of providerStrategies) {
      const score = await this.scoreStrategy(strategy, context);
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }

    return bestStrategy || (await this.createProviderStrategy(context.targetProvider));
  }

  // ---------------------------------------------------------------------------
  // Strategy Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute an adaptation strategy against a context
   */
  async executeAdaptationStrategy(
    strategy: AdaptationStrategy,
    context: AdaptationContext
  ): Promise<OrchestrationResult<PlatformAdaptation>> {
    try {
      let adaptedContent = { ...context.originalContent };
      const appliedRules: AdaptationRule[] = [];
      const warnings: string[] = [];

      for (const rule of strategy.rules) {
        try {
          const ruleResult = await this.applyAdaptationRule(adaptedContent, rule, context);
          if (ruleResult.ok) {
            adaptedContent = ruleResult.value.content;
            appliedRules.push({
              ...rule,
              applied: true,
              transformedValue: ruleResult.value.transformedValue,
            });
          } else {
            warnings.push(`Rule ${rule.ruleId} failed: ${ruleResult.error.message}`);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          warnings.push(`Rule ${rule.ruleId} error: ${errorMessage}`);
        }
      }

      const adaptation: PlatformAdaptation = {
        providerId: context.targetProvider,
        originalContent: context.originalContent,
        adaptedContent,
        adaptationRules: appliedRules,
        confidence: calculateConfidence(appliedRules, warnings),
        warnings,
        requiresManualReview: warnings.length > appliedRules.length,
      };

      return { ok: true, value: adaptation };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Strategy execution failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Transformer Registration
  // ---------------------------------------------------------------------------

  private async registerBuiltInTransformers(): Promise<void> {
    for (const [key, transformer] of buildBuiltInTransformers()) {
      this.transformers.set(key, transformer);
    }
    logger.debug({ count: this.transformers.size }, "Registered content transformers");
  }

  // ---------------------------------------------------------------------------
  // Private: Strategy Loading
  // ---------------------------------------------------------------------------

  private async loadAdaptationStrategies(): Promise<void> {
    const providersWithAdapters = providerRegistry.getProvidersWithAdapters();

    for (const provider of providersWithAdapters) {
      try {
        const strategy = await this.createProviderStrategy(provider.id as ProviderId);
        this.strategies.set(`${provider.id}_default`, strategy);
      } catch (error) {
        logger.warn(
          { err: error, providerId: provider.id },
          "Failed to create strategy for provider"
        );
      }
    }

    logger.debug({ count: this.strategies.size }, "Loaded adaptation strategies");
  }

  private async createProviderStrategy(providerId: ProviderId): Promise<AdaptationStrategy> {
    const provider = providerRegistry.getProvider(providerId);
    const adapter = providerRegistry.getAdapter(providerId) as unknown as ProviderAdapter;

    if (!provider || !adapter) {
      throw AppError.notFound("Provider or adapter", { providerId });
    }

    const rules: AdaptationRule[] = [];

    if (adapter.limits.maxChars) {
      rules.push({
        ruleId: "text_length_limit",
        type: "text_length",
        description: `Limit text to ${adapter.limits.maxChars} characters`,
        applied: false,
      });
    }

    if (adapter.limits.maxMediaPerPost) {
      rules.push({
        ruleId: "media_count_limit",
        type: "media_format",
        description: `Limit media to ${adapter.limits.maxMediaPerPost} items`,
        applied: false,
      });
    }

    if (adapter.limits.allowedMedia) {
      rules.push({
        ruleId: "media_format_limit",
        type: "media_format",
        description: `Convert media to supported formats: ${adapter.limits.allowedMedia.join(", ")}`,
        applied: false,
      });
    }

    if (adapter.limits.maxHashtags) {
      rules.push({
        ruleId: "hashtag_count_limit",
        type: "hashtag_limit",
        description: `Limit hashtags to ${adapter.limits.maxHashtags}`,
        applied: false,
      });
    }

    return {
      id: `${providerId}_default`,
      name: `Default ${provider.displayName} Strategy`,
      description: `Standard adaptation for ${provider.displayName}`,
      providerId,
      rules,
      priority: 1,
      enabled: true,
      conditions: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Goal Generation & Scoring
  // ---------------------------------------------------------------------------

  private generateAdaptationGoals(
    content: CanonicalPost,
    provider: ProviderMetadata
  ): AdaptationGoal[] {
    const goals: AdaptationGoal[] = [
      { type: "meet_limits", priority: 1 },
      { type: "preserve_meaning", priority: 2 },
    ];

    const capabilities = provider.capabilities as unknown as Record<string, unknown> | undefined;
    if (capabilities?.analytics) {
      goals.push({ type: "maximize_engagement", priority: 3 });
    }

    if (content.media && content.media.length > 0) {
      goals.push({ type: "optimize_media", priority: 4 });
    }

    return goals;
  }

  private async scoreStrategy(
    strategy: AdaptationStrategy,
    context: AdaptationContext
  ): Promise<number> {
    let score = strategy.priority;

    for (const condition of strategy.conditions) {
      const conditionMet = await evaluateCondition(condition, context.originalContent);
      if (conditionMet) {
        score += condition.weight;
      }
    }

    return score;
  }

  // ---------------------------------------------------------------------------
  // Private: Rule Application
  // ---------------------------------------------------------------------------

  private async applyAdaptationRule(
    content: CanonicalPost,
    rule: AdaptationRule,
    context: AdaptationContext
  ): Promise<OrchestrationResult<{ content: CanonicalPost; transformedValue?: unknown }>> {
    try {
      let transformedContent = { ...content };
      let transformedValue: unknown;

      switch (rule.type) {
        case "text_length": {
          const textTransformer = this.transformers.get("text_truncate");
          if (textTransformer && content.body.length > context.constraints.maxChars) {
            transformedValue = await textTransformer.transform(content.body, {
              maxLength: context.constraints.maxChars,
            });
            transformedContent.body = transformedValue as string;
          }
          break;
        }

        case "media_format": {
          const mediaTransformer = this.transformers.get("media_optimize");
          if (mediaTransformer && content.media) {
            transformedValue = await mediaTransformer.transform(content.media, {
              maxCount: context.constraints.maxMediaPerPost,
              allowedFormats: context.constraints.allowedMedia,
            });
            transformedContent.media = transformedValue as typeof content.media;
          }
          break;
        }

        case "hashtag_limit": {
          const hashtagTransformer = this.transformers.get("hashtag_optimize");
          if (hashtagTransformer && content.tags) {
            transformedValue = await hashtagTransformer.transform(content.tags, {
              maxTags: context.constraints.maxHashtags || 10,
            });
            transformedContent.tags = transformedValue as string[];
          }
          break;
        }

        default:
          logger.warn({ ruleType: rule.type }, "Unknown adaptation rule type");
          break;
      }

      return { ok: true, value: { content: transformedContent, transformedValue } };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Rule application failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }
}
