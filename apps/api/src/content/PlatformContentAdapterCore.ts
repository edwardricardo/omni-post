/**
 * Platform Content Adapter - Core Adaptation Logic
 *
 * Public API methods for content adaptation: adaptForProviders,
 * adaptForSingleProvider, optimizeForEngagement, reverseAdaptation,
 * and getAdaptationRecommendations.
 *
 * @module content/PlatformContentAdapterCore
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { PlatformAdaptation, OrchestrationResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId, ProviderAdapter } from "../providers/providerAdapter.interface";
import type { EventService } from "../events/EventService";
import { providerRegistry } from "../providers/providerRegistry";
import type {
  AdaptationSession,
  UserAdaptationPreferences,
} from "./platformContentAdapterTypes.js";
import {
  initializeMetrics,
  applyEngagementOptimizations,
  calculateContentSimilarity,
  isRuleReversible,
} from "./platformContentAdapterHelpers.js";
import type { PlatformContentAdapterStrategy } from "./PlatformContentAdapterStrategy.js";
import type { PlatformContentAdapterValidation } from "./PlatformContentAdapterValidation.js";
import { logger } from "../lib/logger.js";

/**
 * Dependencies required by the core adapter
 */
export interface PlatformContentAdapterDeps {
  prisma: PrismaClient;
  redis: Redis;
  eventService: EventService;
}

/**
 * Core adaptation logic for multi-provider content transformation
 */
export class PlatformContentAdapterCore {
  protected prisma: PrismaClient;
  protected redis: Redis;
  protected eventService: EventService;
  protected activeSessions = new Map<string, AdaptationSession>();

  /** Set by PlatformContentAdapter facade after construction */
  strategyModule!: PlatformContentAdapterStrategy;
  /** Set by PlatformContentAdapter facade after construction */
  validationModule!: PlatformContentAdapterValidation;

  constructor(deps: PlatformContentAdapterDeps) {
    this.prisma = deps.prisma;
    this.redis = deps.redis;
    this.eventService = deps.eventService;
  }

  /**
   * Adapt content for multiple providers simultaneously
   */
  async adaptForProviders(
    content: CanonicalPost,
    targetProviders: ProviderId[],
    userPreferences?: UserAdaptationPreferences
  ): Promise<OrchestrationResult<Map<ProviderId, PlatformAdaptation>>> {
    try {
      const session: AdaptationSession = {
        id: this.generateId(),
        postId: content.id,
        targetProviders,
        startedAt: new Date(),
        status: "planning",
        adaptations: new Map(),
        metrics: initializeMetrics(),
        warnings: [],
        errors: [],
      };

      this.activeSessions.set(session.id, session);

      session.status = "executing";
      for (const providerId of targetProviders) {
        try {
          const adaptation = await this.adaptForSingleProvider(
            content,
            providerId,
            userPreferences
          );

          if (adaptation.ok) {
            session.adaptations.set(providerId, adaptation.value);
          } else {
            session.errors.push(adaptation.error);
            session.warnings.push(
              `Adaptation failed for ${providerId}: ${adaptation.error.message}`
            );
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          session.errors.push({
            id: this.generateId(),
            type: "system",
            message: `Adaptation error for ${providerId}: ${errorMessage}`,
            retryable: true,
            occurredAt: new Date(),
            providerId,
          });
        }
      }

      session.status = "completed";
      session.completedAt = new Date();
      session.metrics.executionTime = Date.now() - session.startedAt.getTime();

      await this.validationModule.cacheAdaptationResults(session);
      await this.validationModule.emitAdaptationEvent("ADAPTATION_COMPLETED", session);

      return { ok: true, value: session.adaptations };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Multi-provider adaptation failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
          context: { targetProviders, contentId: content.id },
        },
      };
    }
  }

  /**
   * Adapt content for a single provider
   */
  async adaptForSingleProvider(
    content: CanonicalPost,
    providerId: ProviderId,
    userPreferences?: UserAdaptationPreferences
  ): Promise<OrchestrationResult<PlatformAdaptation>> {
    try {
      const rawAdapter = providerRegistry.getAdapter(providerId);
      const provider = providerRegistry.getProvider(providerId);

      if (!rawAdapter || !provider) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Provider not found: ${providerId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Registry returns @ports/ProviderAdapter; actual adapters implement the full interface
      const adapter = rawAdapter as unknown as ProviderAdapter;

      const context = this.strategyModule.buildAdaptationContext(
        content,
        providerId,
        provider,
        adapter,
        userPreferences
      );

      const strategy = await this.strategyModule.selectOptimalStrategy(context);
      const adaptation = await this.strategyModule.executeAdaptationStrategy(strategy, context);

      const validation = await this.validationModule.validateAdaptedContent(adaptation, adapter);
      if (!validation.ok) {
        return validation;
      }

      if (adaptation.ok && adaptation.value) {
        const metrics = await this.validationModule.calculateAdaptationMetrics(
          content,
          adaptation.value
        );
        adaptation.value.confidence = metrics.confidenceScore;
      }

      return adaptation;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Single provider adaptation failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
          providerId,
        },
      };
    }
  }

  /**
   * Optimize content for engagement on specific platform
   */
  async optimizeForEngagement(
    content: CanonicalPost,
    providerId: ProviderId,
    audienceData?: any
  ): Promise<OrchestrationResult<PlatformAdaptation>> {
    try {
      const baseAdaptation = await this.adaptForSingleProvider(content, providerId);
      if (!baseAdaptation.ok) {
        return baseAdaptation;
      }

      const optimizations = await applyEngagementOptimizations(
        baseAdaptation.value,
        providerId,
        audienceData
      );

      return { ok: true, value: optimizations };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Engagement optimization failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Reverse adaptation to restore original content
   */
  async reverseAdaptation(
    adaptation: PlatformAdaptation
  ): Promise<OrchestrationResult<CanonicalPost>> {
    try {
      let restoredContent = { ...adaptation.adaptedContent };

      const reversibleRules = adaptation.adaptationRules
        .filter((rule) => isRuleReversible(rule))
        .reverse();

      for (const _rule of reversibleRules) {
        // Placeholder for rule reversal logic
        restoredContent = { ...restoredContent };
      }

      const similarity = calculateContentSimilarity(adaptation.originalContent, restoredContent);

      if (similarity < 0.8) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Restored content differs significantly from original",
            retryable: false,
            occurredAt: new Date(),
            context: { similarity },
          },
        };
      }

      return { ok: true, value: restoredContent };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Adaptation reversal failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get adaptation recommendations for content
   */
  async getAdaptationRecommendations(
    content: CanonicalPost,
    targetProviders: ProviderId[]
  ): Promise<Map<ProviderId, string[]>> {
    const recommendations = new Map<ProviderId, string[]>();

    for (const providerId of targetProviders) {
      const providerRecommendations: string[] = [];

      try {
        const provider = providerRegistry.getProvider(providerId);
        if (!provider) continue;

        const analysis = await this.validationModule.analyzeContentForProvider(content, providerId);

        if (analysis.textTooLong) {
          providerRecommendations.push("Consider shortening text to fit character limit");
        }

        if (analysis.tooManyMedia) {
          providerRecommendations.push("Reduce number of media attachments");
        }

        if (analysis.unsupportedMediaFormats.length > 0) {
          providerRecommendations.push(
            `Convert media formats: ${analysis.unsupportedMediaFormats.join(", ")}`
          );
        }

        if (analysis.suboptimalTiming) {
          providerRecommendations.push("Consider scheduling for optimal engagement times");
        }

        recommendations.set(providerId, providerRecommendations);
      } catch (error) {
        logger.error({ err: error, providerId }, "Error generating recommendations for provider");
        recommendations.set(providerId, ["Unable to generate recommendations"]);
      }
    }

    return recommendations;
  }

  generateId(): string {
    return `adapter_${randomUUID()}`;
  }
}
