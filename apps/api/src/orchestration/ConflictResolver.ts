/**
 * @file ConflictResolver.ts
 * @description Advanced conflict detection and resolution for multi-provider publishing
 *              scenarios including content, timing, rate limit, and validation conflicts.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import {
  OrchestrationConflict,
  ConflictResolution,
  PublishResult,
  OrchestrationError as _OrchestrationError,
  OrchestrationResult,
  ContentVersion as _ContentVersion,
  VersionDiff as _VersionDiff,
  PlatformAdaptation,
  AdaptationRule,
  TimingConfiguration,
} from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId, ProviderAdapter } from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";
import { providerRegistry } from "../providers/providerRegistry";
import { validateContentForLimits } from "@providers/shared";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  ConflictContext,
  ConflictDetectionRule,
  ConflictResolutionRule,
  ConflictPattern,
  ResolutionResult,
} from "./conflictResolverTypes.js";

import type {
  ConflictContext,
  ConflictPattern,
  ResolutionResult,
} from "./conflictResolverTypes.js";

// ── Pattern helpers ──────────────────────────────────────────────────────────
import {
  loadBuiltInPatterns,
  loadCustomPatterns,
  matchPattern,
  mapPatternToConflictType,
  generateConflictDescription,
  calculateSeverity,
} from "./ConflictPatterns.js";

// ── Strategy helpers ─────────────────────────────────────────────────────────
import {
  resolveConflict,
  applyContentAdaptation,
  calculateAdaptationConfidence,
} from "./ConflictStrategies.js";

export class ConflictResolver {
  private prisma: PrismaClient;
  private redis: Redis;
  private eventService: EventService;
  private conflictPatterns: Map<string, ConflictPattern> = new Map();
  private activeResolutions = new Map<string, ConflictResolution>();

  constructor(dependencies: { prisma: PrismaClient; redis: Redis; eventService: EventService }) {
    this.prisma = dependencies.prisma;
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
  }

  /**
   * Initialize conflict resolver with built-in patterns
   */
  async initialize(): Promise<void> {
    try {
      await loadBuiltInPatterns(this.conflictPatterns);
      await loadCustomPatterns();

      log.info({ patternsCount: this.conflictPatterns.size }, "Conflict Resolver initialized");

      await this.eventService.publishEvent({
        id: this.generateId(),
        type: "CONFLICT_RESOLVED",
        aggregateId: "system",
        aggregateType: "ConflictResolver",
        version: 1,
        data: {
          component: "ConflictResolver",
          status: "initialized",
          patternsLoaded: this.conflictPatterns.size,
        },
        metadata: {
          source: "ConflictResolver",
        },
        timestamp: new Date(),
      });
    } catch (error: unknown) {
      log.error({ err: error }, "Failed to initialize Conflict Resolver");
      throw error;
    }
  }

  /**
   * Detect conflicts in publishing results
   */
  async detectConflicts(
    context: ConflictContext,
    result: PublishResult
  ): Promise<OrchestrationConflict[]> {
    const conflicts: OrchestrationConflict[] = [];

    try {
      for (const [_patternId, pattern] of this.conflictPatterns) {
        if (!pattern.enabled) continue;

        const matchResult = await matchPattern(pattern, context, result);
        if (matchResult.matches) {
          const conflict: OrchestrationConflict = {
            id: this.generateId(),
            type: mapPatternToConflictType(pattern),
            providerId: context.providerId,
            description: generateConflictDescription(pattern, matchResult),
            severity: calculateSeverity(pattern, matchResult),
            autoResolved: false,
          };

          conflicts.push(conflict);
          await this.emitConflictEvent("CONFLICT_DETECTED", conflict, context);
        }
      }

      if (conflicts.length > 0) {
        await this.storeConflicts(context.planId, conflicts);
      }

      return conflicts;
    } catch (error) {
      log.error({ err: error, providerId: context.providerId }, "Error detecting conflicts");
      return [];
    }
  }

  /**
   * Resolve detected conflicts
   */
  async resolveConflicts(
    conflicts: OrchestrationConflict[],
    context: ConflictContext
  ): Promise<OrchestrationResult<ResolutionResult[]>> {
    try {
      const resolutions: ResolutionResult[] = [];

      for (const conflict of conflicts) {
        const resolutionResult = await resolveConflict(
          conflict,
          context,
          this.conflictPatterns,
          this.adaptContentForProvider.bind(this),
          this.getCurrentContent.bind(this)
        );
        resolutions.push(resolutionResult);

        const result =
          resolutionResult.action === "resolved"
            ? "resolved"
            : resolutionResult.action === "failed"
              ? "failed"
              : "pending";
        conflict.resolution = {
          strategy: resolutionResult.strategy as
            | "retry"
            | "skip"
            | "adapt_content"
            | "reschedule"
            | "manual",
          parameters: resolutionResult.metadata || {},
          appliedAt: new Date(),
          result,
        };

        conflict.resolvedAt = new Date();
        conflict.autoResolved = resolutionResult.action === "resolved";

        await this.emitConflictEvent("CONFLICT_RESOLVED", conflict, context);
      }

      await this.updateConflicts(context.planId, conflicts);

      return { ok: true, value: resolutions };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Conflict resolution failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
          context: { planId: context.planId, providerId: context.providerId },
        },
      };
    }
  }

  /**
   * Adapt content to resolve validation conflicts
   */
  async adaptContentForProvider(
    content: CanonicalPost,
    providerId: ProviderId,
    validationErrors: string[]
  ): Promise<OrchestrationResult<PlatformAdaptation>> {
    try {
      const adapter = providerRegistry.getAdapter(providerId) as unknown as ProviderAdapter;
      if (!adapter) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Provider adapter not found: ${providerId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      let adaptedContent = { ...content };
      const appliedRules: AdaptationRule[] = [];
      const warnings: string[] = [];

      for (const error of validationErrors) {
        const adaptation = await applyContentAdaptation(adaptedContent, error, adapter);

        if (adaptation.ok) {
          adaptedContent = adaptation.value.content;
          appliedRules.push(adaptation.value.rule);
        } else {
          warnings.push(`Failed to adapt for error: ${error}`);
        }
      }

      const validation = await validateContentForLimits(
        adaptedContent,
        adapter.limits,
        adapter.capabilities
      );
      const requiresManualReview = validation.errors.some((e) => e.severity === "error");

      const platformAdaptation: PlatformAdaptation = {
        providerId,
        originalContent: content,
        adaptedContent,
        adaptationRules: appliedRules,
        confidence: calculateAdaptationConfidence(appliedRules, warnings),
        warnings,
        requiresManualReview,
      };

      return { ok: true, value: platformAdaptation };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Content adaptation failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Find alternative timing to resolve scheduling conflicts
   */
  async findAlternativeTiming(
    providerId: ProviderId,
    originalTime: Date,
    _timingConfig: TimingConfiguration
  ): Promise<OrchestrationResult<Date>> {
    try {
      const adapter = providerRegistry.getAdapter(providerId) as unknown as ProviderAdapter;
      if (!adapter?.getOptimalTimes) {
        const delayMinutes = Math.floor(Math.random() * 60) + 15; // 15-75 minutes
        return {
          ok: true,
          value: new Date(originalTime.getTime() + delayMinutes * 60000),
        };
      }

      const optimalTimesResult = await adapter.getOptimalTimes({ connectedAt: new Date() });
      if (!optimalTimesResult.ok) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "provider",
            message: `Failed to get optimal times: ${optimalTimesResult.error}`,
            retryable: true,
            occurredAt: new Date(),
          },
        };
      }

      const optimalTimes = optimalTimesResult.value;
      const nextOptimalTime = optimalTimes.find((slot) => slot.datetime > originalTime);

      if (nextOptimalTime) {
        return { ok: true, value: nextOptimalTime.datetime };
      }

      const nextDay = new Date(originalTime);
      nextDay.setDate(nextDay.getDate() + 1);
      return { ok: true, value: nextDay };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Alternative timing calculation failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get conflict resolution statistics
   */
  async getResolutionStatistics(_timeframe: { start: Date; end: Date }): Promise<{
    totalConflicts: number;
    resolvedConflicts: number;
    conflictsByType: Record<string, number>;
    resolutionsByStrategy: Record<string, number>;
    averageResolutionTime: number;
    topConflictPatterns: Array<{ pattern: string; count: number }>;
  }> {
    return {
      totalConflicts: 0,
      resolvedConflicts: 0,
      conflictsByType: {},
      resolutionsByStrategy: {},
      averageResolutionTime: 0,
      topConflictPatterns: [],
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async emitConflictEvent(
    eventType: "CONFLICT_DETECTED" | "CONFLICT_RESOLVED",
    conflict: OrchestrationConflict,
    context: ConflictContext
  ): Promise<void> {
    await this.eventService.publishEvent({
      id: this.generateId(),
      type: eventType,
      aggregateId: context.planId,
      aggregateType: "Orchestration",
      version: 1,
      data: {
        conflict,
        context: {
          providerId: context.providerId,
          postId: context.postId,
          attemptNumber: context.attemptNumber,
        },
      },
      metadata: {
        source: "ConflictResolver",
      },
      timestamp: new Date(),
    });
  }

  private async storeConflicts(planId: string, conflicts: OrchestrationConflict[]): Promise<void> {
    await this.redis.setex(
      `conflicts:${planId}`,
      86400, // 24 hours
      JSON.stringify(conflicts)
    );
  }

  private async updateConflicts(planId: string, conflicts: OrchestrationConflict[]): Promise<void> {
    await this.storeConflicts(planId, conflicts);
  }

  private async getCurrentContent(_postId: string): Promise<CanonicalPost | null> {
    // This would fetch from database
    return null;
  }

  private generateId(): string {
    return `conflict_${randomUUID()}`;
  }
}
