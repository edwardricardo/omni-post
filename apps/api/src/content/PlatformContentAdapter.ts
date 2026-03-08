/**
 * Platform Content Adapter - Facade
 *
 * Composes PlatformContentAdapterCore, PlatformContentAdapterStrategy,
 * and PlatformContentAdapterValidation into the original public API.
 *
 * External consumers continue importing PlatformContentAdapter from this file.
 *
 * @module content/PlatformContentAdapter
 */

import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { PlatformAdaptation, OrchestrationResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";
import type { EventService } from "../events/EventService";
import type { UserAdaptationPreferences } from "./platformContentAdapterTypes.js";
import { PlatformContentAdapterCore } from "./PlatformContentAdapterCore.js";
import { PlatformContentAdapterStrategy } from "./PlatformContentAdapterStrategy.js";
import { PlatformContentAdapterValidation } from "./PlatformContentAdapterValidation.js";
import { logger } from "../lib/logger.js";

export class PlatformContentAdapter {
  private core: PlatformContentAdapterCore;
  private strategy: PlatformContentAdapterStrategy;
  private validation: PlatformContentAdapterValidation;

  constructor(dependencies: { prisma: PrismaClient; redis: Redis; eventService: EventService }) {
    this.core = new PlatformContentAdapterCore(dependencies);

    const generateId = () => this.core.generateId();

    this.strategy = new PlatformContentAdapterStrategy(
      dependencies.prisma,
      dependencies.redis,
      dependencies.eventService,
      generateId
    );

    this.validation = new PlatformContentAdapterValidation(
      dependencies.redis,
      dependencies.eventService,
      generateId
    );

    // Wire modules together
    this.core.strategyModule = this.strategy;
    this.core.validationModule = this.validation;
  }

  async initialize(): Promise<void> {
    try {
      await this.strategy.initialize();
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize Platform Content Adapter");
      throw error;
    }
  }

  async adaptForProviders(
    content: CanonicalPost,
    targetProviders: ProviderId[],
    userPreferences?: UserAdaptationPreferences
  ): Promise<OrchestrationResult<Map<ProviderId, PlatformAdaptation>>> {
    return this.core.adaptForProviders(content, targetProviders, userPreferences);
  }

  async adaptForSingleProvider(
    content: CanonicalPost,
    providerId: ProviderId,
    userPreferences?: UserAdaptationPreferences
  ): Promise<OrchestrationResult<PlatformAdaptation>> {
    return this.core.adaptForSingleProvider(content, providerId, userPreferences);
  }

  async optimizeForEngagement(
    content: CanonicalPost,
    providerId: ProviderId,
    audienceData?: any
  ): Promise<OrchestrationResult<PlatformAdaptation>> {
    return this.core.optimizeForEngagement(content, providerId, audienceData);
  }

  async reverseAdaptation(
    adaptation: PlatformAdaptation
  ): Promise<OrchestrationResult<CanonicalPost>> {
    return this.core.reverseAdaptation(adaptation);
  }

  async getAdaptationRecommendations(
    content: CanonicalPost,
    targetProviders: ProviderId[]
  ): Promise<Map<ProviderId, string[]>> {
    return this.core.getAdaptationRecommendations(content, targetProviders);
  }
}
