/**
 * @file PublishingOrchestrator.ts
 * @description Main orchestration engine for coordinating multi-provider content publishing
 *              with transaction-like semantics and rollback capabilities.
 * @layer infrastructure
 *   - PublishingOrchestrator.ts (this file) — public API surface
 */

import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import {
  OrchestrationPlan,
  OrchestrationExecution,
  OrchestrationStatus as _OrchestrationStatus,
  PublishingStrategy as _PublishingStrategy,
  ConflictResolutionStrategy as _ConflictResolutionStrategy,
  OrchestrationConflict as _OrchestrationConflict,
  OrchestrationConfig,
  CreateOrchestrationRequest,
  UpdateOrchestrationRequest,
  ExecuteOrchestrationRequest,
  OrchestrationResponse as _OrchestrationResponse,
  OrchestrationResult,
} from "@shared/orchestration";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";
import { PublishingOrchestratorExecution } from "./PublishingOrchestratorExecution";
import type { OrchestrationDependencies } from "./publishingOrchestratorTypes";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

export class PublishingOrchestrator extends PublishingOrchestratorExecution {
  protected prisma: PrismaClient;
  protected override redis: Redis;
  protected override eventService: EventService;
  protected override config: OrchestrationConfig;
  protected override activeExecutions = new Map<string, OrchestrationExecution>();
  private isInitialized = false;

  private readonly defaultConfig: OrchestrationConfig = {
    maxConcurrentExecutions: 10,
    defaultRetryPolicy: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffStrategy: "exponential",
      retryableErrors: ["RATE_LIMIT", "NETWORK", "TIMEOUT"],
    },
    defaultConflictResolution: "BEST_EFFORT",
    healthCheckInterval: 30000,
    metricsRetention: 30,
    enableRollback: true,
    enableAnalytics: true,
    enableSynchronization: true,
  };

  constructor(dependencies: OrchestrationDependencies) {
    super();
    this.prisma = dependencies.prisma;
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
    this.config = { ...this.defaultConfig, ...dependencies.config };
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Setup Redis channels for coordination
      await this.setupRedisChannels();

      // Register event handlers
      this.registerEventHandlers();

      // Start health monitoring
      this.startHealthMonitoring();

      this.isInitialized = true;
      log.info("Publishing Orchestrator initialized successfully");

      // Emit initialization event
      await this.emitEvent({
        type: "ORCHESTRATION_STARTED",
        orchestrationId: "system",
        timestamp: new Date(),
        data: {
          component: "PublishingOrchestrator",
          status: "initialized",
          config: this.config,
        },
      });
    } catch (error: unknown) {
      log.error({ err: error }, "Failed to initialize Publishing Orchestrator");
      throw error;
    }
  }

  /**
   * Create a new orchestration plan
   */
  async createPlan(
    request: CreateOrchestrationRequest
  ): Promise<OrchestrationResult<OrchestrationPlan>> {
    try {
      // Validate request
      const validation = await this.validateCreateRequest(request);
      if (!validation.ok) {
        return validation;
      }

      // Generate orchestration plan
      const plan = await this.generatePlan(request);

      // Store plan in database
      await this.storePlan(plan);

      // Cache plan for quick access
      await this.redis.setex(
        `orchestration:plan:${plan.id}`,
        3600, // 1 hour
        JSON.stringify(plan)
      );

      await this.emitEvent({
        type: "ORCHESTRATION_PLANNED",
        orchestrationId: plan.id,
        timestamp: new Date(),
        data: { plan },
      });

      return { ok: true, value: plan };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to create orchestration plan: ${errorMessage}`,
          retryable: false,
          occurredAt: new Date(),
          context: { request },
        },
      };
    }
  }

  /**
   * Update an existing orchestration plan
   */
  async updatePlan(
    planId: string,
    updates: UpdateOrchestrationRequest
  ): Promise<OrchestrationResult<OrchestrationPlan>> {
    try {
      const plan = await this.getPlan(planId);
      if (!plan) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Orchestration plan not found: ${planId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Check if plan can be updated (not currently executing)
      const execution = this.activeExecutions.get(planId);
      if (execution && execution.status === "executing") {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Cannot update plan while execution is in progress",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Apply updates
      const updatedPlan: Record<string, unknown> = {
        ...plan,
        id: planId, // Ensure ID doesn't change
      };
      // Apply only defined updates
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          updatedPlan[key] = value;
        }
      }

      // Validate updated plan
      const typedPlan = updatedPlan as unknown as OrchestrationPlan;
      const validation = await this.validatePlan(typedPlan);
      if (!validation.ok) {
        return validation;
      }

      // Store updated plan
      await this.storePlan(typedPlan);
      await this.redis.setex(`orchestration:plan:${planId}`, 3600, JSON.stringify(typedPlan));

      return { ok: true, value: typedPlan };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to update orchestration plan: ${errorMessage}`,
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Execute an orchestration plan
   */
  async executePlan(
    request: ExecuteOrchestrationRequest
  ): Promise<OrchestrationResult<OrchestrationExecution>> {
    try {
      // Check concurrent execution limit
      if (this.activeExecutions.size >= this.config.maxConcurrentExecutions) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "system",
            message: "Maximum concurrent executions reached",
            retryable: true,
            occurredAt: new Date(),
          },
        };
      }

      const plan = await this.getPlan(request.planId);
      if (!plan) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `Orchestration plan not found: ${request.planId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Create execution
      const execution: OrchestrationExecution = {
        id: this.generateId(),
        planId: request.planId,
        status: "planning",
        startedAt: new Date(),
        results: {} as Record<ProviderId, import("@shared/orchestration").PublishResult>,
        conflicts: [],
        metrics: this.initializeMetrics(),
        errors: [],
      };

      // Apply overrides if provided
      const effectivePlan = this.applyExecutionOverrides(plan, request.overrides);

      // Register active execution
      this.activeExecutions.set(execution.id, execution);

      // If dry run, simulate execution
      if (request.dryRun) {
        return await this.simulateExecution(execution, effectivePlan);
      }

      // Start actual execution
      await this.emitEvent({
        type: "ORCHESTRATION_STARTED",
        orchestrationId: execution.id,
        timestamp: new Date(),
        data: { execution, plan: effectivePlan },
      });

      // Execute asynchronously
      this.executeAsync(execution, effectivePlan);

      return { ok: true, value: execution };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to execute orchestration plan: ${errorMessage}`,
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get orchestration execution status
   */
  async getExecution(executionId: string): Promise<OrchestrationExecution | null> {
    // Check active executions first
    const activeExecution = this.activeExecutions.get(executionId);
    if (activeExecution) {
      return activeExecution;
    }

    // Check database for completed executions
    try {
      const cached = await this.redis.get(`orchestration:execution:${executionId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // Fallback to database query
      return await this.getExecutionFromDatabase(executionId);
    } catch (error: unknown) {
      log.error({ err: error, executionId }, "Error retrieving execution");
      return null;
    }
  }

  /**
   * Cancel an active orchestration execution
   */
  async cancelExecution(executionId: string): Promise<OrchestrationResult<void>> {
    try {
      const execution = this.activeExecutions.get(executionId);
      if (!execution) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Execution not found or already completed",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      if (execution.status === "completed" || execution.status === "cancelled") {
        return { ok: true, value: undefined };
      }

      // Update execution status
      execution.status = "cancelled";
      execution.completedAt = new Date();

      // Signal cancellation via Redis
      await this.redis.publish(
        `orchestration:cancel:${executionId}`,
        JSON.stringify({ reason: "manual_cancellation" })
      );

      await this.emitEvent({
        type: "ORCHESTRATION_CANCELLED",
        orchestrationId: executionId,
        timestamp: new Date(),
        data: { reason: "manual_cancellation" },
      });

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to cancel execution: ${errorMessage}`,
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get orchestration health status
   */
  async getHealthStatus(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    details: {
      activeExecutions: number;
      queuedExecutions: number;
      errorRate: number;
      averageExecutionTime: number;
    };
  }> {
    try {
      const activeCount = this.activeExecutions.size;
      const queuedCount = await this.getQueuedExecutionsCount();
      const errorRate = await this.calculateErrorRate();
      const avgTime = await this.calculateAverageExecutionTime();

      const status = this.determineHealthStatus(activeCount, errorRate);

      return {
        status,
        details: {
          activeExecutions: activeCount,
          queuedExecutions: queuedCount,
          errorRate,
          averageExecutionTime: avgTime,
        },
      };
    } catch (error: unknown) {
      log.error({ err: error }, "Error getting health status");
      return {
        status: "unhealthy",
        details: {
          activeExecutions: 0,
          queuedExecutions: 0,
          errorRate: 1,
          averageExecutionTime: 0,
        },
      };
    }
  }
}

// Re-export types so existing consumers keep compiling
export type { OrchestrationDependencies } from "./publishingOrchestratorTypes";
