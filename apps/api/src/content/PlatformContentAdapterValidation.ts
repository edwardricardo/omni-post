/**
 * @file PlatformContentAdapterValidation.ts
 * @description Content validation, adaptation metrics calculation, content analysis,
 *              caching, and event emission for platform content adaptation.
 * @layer infrastructure
 */

import type Redis from "ioredis";
import type { PlatformAdaptation, OrchestrationResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId, ProviderAdapter } from "../providers/providerAdapter.interface";
import type { EventService } from "../events/EventService";
import { providerRegistry } from "../providers/providerRegistry";
import { validateContentForLimits } from "@providers/shared";
import type { AdaptationMetrics, AdaptationSession } from "./platformContentAdapterTypes.js";
import {
  calculateQualityScore,
  calculateReversibilityScore,
  predictEngagement,
  findUnsupportedMediaFormats,
} from "./platformContentAdapterHelpers.js";

/**
 * Validation, metrics, and infrastructure for platform content adaptation
 */
export class PlatformContentAdapterValidation {
  constructor(
    private redis: Redis,
    private eventService: EventService,
    private generateId: () => string
  ) {}

  // ---------------------------------------------------------------------------
  // Content Validation
  // ---------------------------------------------------------------------------

  /**
   * Validate adapted content against provider constraints
   */
  async validateAdaptedContent(
    adaptation: OrchestrationResult<PlatformAdaptation>,
    adapter: ProviderAdapter
  ): Promise<OrchestrationResult<PlatformAdaptation>> {
    if (!adaptation.ok) return adaptation;

    try {
      const validation = await validateContentForLimits(
        adaptation.value.adaptedContent,
        adapter.limits,
        adapter.capabilities
      );

      if (!validation.valid) {
        const errors = validation.errors.filter((e) => e.severity === "error");
        if (errors.length > 0) {
          return {
            ok: false,
            error: {
              id: this.generateId(),
              type: "validation",
              message: `Validation failed: ${errors.map((e) => e.message).join(", ")}`,
              retryable: true,
              occurredAt: new Date(),
              context: { validationErrors: errors },
            },
          };
        }
      }

      return adaptation;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Content validation failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Metrics Calculation
  // ---------------------------------------------------------------------------

  /**
   * Calculate adaptation quality and engagement metrics
   */
  async calculateAdaptationMetrics(
    original: CanonicalPost,
    adaptation: PlatformAdaptation
  ): Promise<AdaptationMetrics> {
    return {
      executionTime: 0,
      confidenceScore: adaptation.confidence,
      qualityScore: calculateQualityScore(original, adaptation.adaptedContent),
      engagementPrediction: await predictEngagement(
        adaptation.adaptedContent,
        adaptation.providerId
      ),
      complianceScore: adaptation.warnings.length === 0 ? 1.0 : 0.8,
      reversibilityScore: calculateReversibilityScore(adaptation.adaptationRules),
    };
  }

  // ---------------------------------------------------------------------------
  // Content Analysis
  // ---------------------------------------------------------------------------

  /**
   * Analyze content suitability for a specific provider
   */
  async analyzeContentForProvider(
    content: CanonicalPost,
    providerId: ProviderId
  ): Promise<{
    textTooLong: boolean;
    tooManyMedia: boolean;
    unsupportedMediaFormats: string[];
    suboptimalTiming: boolean;
  }> {
    const provider = providerRegistry.getProvider(providerId);
    const adapter = providerRegistry.getAdapter(providerId) as unknown as ProviderAdapter;

    if (!provider || !adapter) {
      return {
        textTooLong: false,
        tooManyMedia: false,
        unsupportedMediaFormats: [],
        suboptimalTiming: false,
      };
    }

    return {
      textTooLong: content.body.length > adapter.limits.maxChars,
      tooManyMedia: (content.media?.length || 0) > adapter.limits.maxMediaPerPost,
      unsupportedMediaFormats: findUnsupportedMediaFormats(
        content.media,
        adapter.limits.allowedMedia
      ),
      suboptimalTiming: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Caching & Events
  // ---------------------------------------------------------------------------

  /**
   * Cache adaptation session results in Redis
   */
  async cacheAdaptationResults(session: AdaptationSession): Promise<void> {
    await this.redis.setex(
      `adaptation:session:${session.id}`,
      86400,
      JSON.stringify({
        ...session,
        adaptations: Array.from(session.adaptations.entries()),
      })
    );
  }

  /**
   * Emit adaptation lifecycle event
   */
  async emitAdaptationEvent(eventType: string, session: AdaptationSession): Promise<void> {
    await this.eventService.publishEvent({
      id: this.generateId(),
      type: eventType,
      aggregateId: session.postId,
      aggregateType: "ContentAdaptation",
      version: 1,
      data: {
        sessionId: session.id,
        providersCount: session.targetProviders.length,
        successfulAdaptations: session.adaptations.size,
        errors: session.errors.length,
        metrics: session.metrics,
      },
      metadata: { source: "PlatformContentAdapter" },
      timestamp: new Date(),
    });
  }
}
