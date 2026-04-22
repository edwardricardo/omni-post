/**
 * @file ProviderCoordinator.ts
 * @description Centralized coordination system for managing multiple providers with
 *              load balancing, failover handling, and intelligent routing decisions.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  OrchestrationError as _OrchestrationError,
  OrchestrationResult,
  PublishResult,
  OrchestrationHealth,
  ComponentHealth,
} from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type {
  ProviderId,
  ProviderAdapter,
  ProviderMetadata,
} from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";
import { providerRegistry as defaultProviderRegistry } from "../providers/providerRegistry";
import { ProviderHealthMonitor } from "./ProviderHealthMonitor.js";
import type {
  ProviderNode,
  CoordinationJob,
  RoutingDecision,
  FailoverStrategy,
  LoadBalancingStrategy,
} from "./providerCoordinatorTypes.js";
import {
  scoreProviders,
  executeParallel,
  executeSequential,
  executeOptimized,
} from "./ProviderCoordinatorExecution.js";
import {
  initializeLoadMetrics,
  getDefaultConfiguration,
  setupDefaultFailoverStrategy,
  performHealthChecks,
  collectProviderMetrics,
  updateProviderMetrics,
  evaluateFailoverConditions,
} from "./ProviderCoordinatorMonitoring.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

/**
 * Minimal interface that ProviderCoordinator needs from the registry.
 * Allows test injection without touching ESM module exports.
 */
interface ProviderRegistryLike {
  getAllProviders(): { id: string; [key: string]: unknown }[];
  getAdapter(id: string): ProviderAdapter | undefined;
}

export class ProviderCoordinator {
  private prisma: PrismaClient;
  private redis: Redis;
  private eventService: EventService;
  private scheduler: BackgroundTaskScheduler;
  private registry: ProviderRegistryLike;

  private providerNodes = new Map<ProviderId, ProviderNode>();
  private activeJobs = new Map<string, CoordinationJob>();
  private loadBalancer: LoadBalancingStrategy;
  private failoverStrategies = new Map<ProviderId, FailoverStrategy>();

  private readonly healthTaskId = "provider-coordinator-health-monitoring";
  private readonly metricsTaskId = "provider-coordinator-metrics-collection";
  private isInitialized = false;

  constructor(dependencies: {
    prisma: PrismaClient;
    redis: Redis;
    eventService: EventService;
    scheduler: BackgroundTaskScheduler;
    registry?: ProviderRegistryLike;
  }) {
    this.prisma = dependencies.prisma;
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
    this.scheduler = dependencies.scheduler;
    this.registry = (dependencies.registry ?? defaultProviderRegistry) as ProviderRegistryLike;

    // Default load balancing strategy
    this.loadBalancer = {
      type: "weighted",
      parameters: {
        responseTimeWeight: 0.4,
        errorRateWeight: 0.3,
        loadWeight: 0.3,
      },
      enabled: true,
    };
  }

  /**
   * Get a ProviderHealthMonitor instance backed by the coordinator's internal state.
   * The monitor shares the same providerNodes and failoverStrategies maps, so any
   * mutations are immediately visible.
   */
  getHealthMonitor(): ProviderHealthMonitor {
    return new ProviderHealthMonitor({
      redis: this.redis,
      eventService: this.eventService,
      scheduler: this.scheduler,
      providerNodes: this.providerNodes as unknown as Map<
        ProviderId,
        import("./providerCoordinatorTypes.js").ProviderNodeExtended
      >,
      failoverStrategies: this.failoverStrategies,
    });
  }

  /**
   * Initialize the provider coordinator.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.loadProviderNodes();
      this.startHealthMonitoring();
      this.startMetricsCollection();
      this.registerEventHandlers();

      this.isInitialized = true;
      log.info({ providersCount: this.providerNodes.size }, "Provider Coordinator initialized");

      await this.eventService.publishEvent({
        id: this.generateId(),
        type: "PROVIDER_COORDINATION_STARTED",
        aggregateId: "system",
        aggregateType: "ProviderCoordinator",
        version: 1,
        data: {
          component: "ProviderCoordinator",
          status: "initialized",
          providersCount: this.providerNodes.size,
        },
        metadata: { source: "ProviderCoordinator" },
        timestamp: new Date(),
      });
    } catch (error: unknown) {
      log.error({ err: error }, "Failed to initialize Provider Coordinator");
      throw error;
    }
  }

  /**
   * Coordinate multi-provider publishing with intelligent routing.
   */
  async coordinatePublishing(
    content: CanonicalPost,
    targetProviders: ProviderId[],
    options: {
      strategy?: "parallel" | "sequential" | "optimized";
      failoverEnabled?: boolean;
      timeout?: number;
      priority?: "low" | "normal" | "high";
    } = {}
  ): Promise<OrchestrationResult<Map<ProviderId, PublishResult>>> {
    try {
      const job: CoordinationJob = {
        id: this.generateId(),
        type: "publish",
        postId: content.id,
        providers: targetProviders,
        status: "pending",
        routing: [],
        results: new Map(),
        startedAt: new Date(),
        metadata: {
          strategy: options.strategy || "optimized",
          failoverEnabled: options.failoverEnabled || true,
          priority: options.priority || "normal",
        },
      };

      this.activeJobs.set(job.id, job);

      job.status = "routing";
      const routingDecisions = await this.routeRequests(targetProviders, content, options);
      job.routing = routingDecisions;

      job.status = "executing";
      const results = await this.executeCoordination(job, content, options);

      job.results = results;
      job.status = "completed";
      job.completedAt = new Date();

      updateProviderMetrics(results, this.providerNodes);

      return { ok: true, value: results };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Coordination failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
          context: { postId: content.id, providers: targetProviders },
        },
      };
    }
  }

  /**
   * Get optimal provider for a specific request.
   */
  async selectOptimalProvider(
    availableProviders: ProviderId[],
    content: CanonicalPost,
    criteria: {
      prioritizeSpeed?: boolean;
      prioritizeReliability?: boolean;
      prioritizeFeatures?: boolean;
      excludeProviders?: ProviderId[];
    } = {}
  ): Promise<OrchestrationResult<RoutingDecision>> {
    try {
      const validProviders = availableProviders.filter(
        (id) =>
          this.providerNodes.has(id) &&
          this.providerNodes.get(id)!.status === "active" &&
          !criteria.excludeProviders?.includes(id)
      );

      if (validProviders.length === 0) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "No valid providers available",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      const providerScores = scoreProviders(
        validProviders,
        this.providerNodes,
        content,
        criteria as Record<string, unknown>
      );

      const bestProvider = providerScores[0];
      if (!bestProvider) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "system",
            message: "No suitable provider found after scoring",
            retryable: true,
            occurredAt: new Date(),
          },
        };
      }

      const decision: RoutingDecision = {
        selectedProvider: bestProvider.providerId,
        reasoning: bestProvider.reasoning,
        confidence: bestProvider.score,
        alternativeProviders: providerScores.slice(1, 3).map((p) => p.providerId),
        estimatedLatency: bestProvider.estimatedLatency,
        loadScore: bestProvider.loadScore,
      };

      return { ok: true, value: decision };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Provider selection failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Handle provider failover.
   */
  async handleFailover(
    failedProvider: ProviderId,
    content: CanonicalPost,
    jobId: string
  ): Promise<OrchestrationResult<ProviderId>> {
    try {
      const failoverStrategy = this.failoverStrategies.get(failedProvider);
      if (!failoverStrategy) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: `No failover strategy defined for provider: ${failedProvider}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      const shouldFailover = evaluateFailoverConditions(
        failedProvider,
        failoverStrategy.conditions,
        this.providerNodes
      );

      if (!shouldFailover) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Failover conditions not met",
            retryable: true,
            occurredAt: new Date(),
          },
        };
      }

      const fallbackSelection = await this.selectOptimalProvider(
        failoverStrategy.fallbackProviders,
        content,
        { prioritizeReliability: true }
      );

      if (!fallbackSelection.ok) {
        return fallbackSelection;
      }

      const providerNode = this.providerNodes.get(failedProvider);
      if (providerNode) {
        providerNode.status = "failed";
        providerNode.failureCount++;
        providerNode.lastFailure = new Date();
      }

      await this.emitFailoverEvent(failedProvider, fallbackSelection.value.selectedProvider, jobId);

      return { ok: true, value: fallbackSelection.value.selectedProvider };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failover handling failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get coordination health status.
   */
  async getHealthStatus(): Promise<OrchestrationHealth> {
    const componentHealths = new Map<string, ComponentHealth>();

    for (const [providerId, node] of this.providerNodes) {
      componentHealths.set(providerId, node.health);
    }

    const healthyProviders = Array.from(componentHealths.values()).filter(
      (health) => health.status === "healthy"
    ).length;

    const totalProviders = componentHealths.size;
    const healthPercentage = totalProviders > 0 ? healthyProviders / totalProviders : 0;

    let overallStatus: "healthy" | "degraded" | "unhealthy";
    if (healthPercentage >= 0.8) {
      overallStatus = "healthy";
    } else if (healthPercentage >= 0.5) {
      overallStatus = "degraded";
    } else {
      overallStatus = "unhealthy";
    }

    return {
      status: overallStatus,
      components: {
        contentManager: { status: "healthy", uptime: 100 },
        syncEngine: { status: "healthy", uptime: 100 },
        conflictResolver: { status: "healthy", uptime: 100 },
        providerCoordinator: { status: "healthy", uptime: 100 },
        analyticsAggregator: { status: "healthy", uptime: 100 },
      },
      lastCheck: new Date(),
      metrics: {
        activeOrchestrations: this.activeJobs.size,
        queuedExecutions: Array.from(this.activeJobs.values()).filter(
          (job) => job.status === "pending"
        ).length,
        failureRate: this.calculateFailureRate(),
        averageExecutionTime: this.calculateAverageExecutionTime(),
        providerAvailability: this.calculateProviderAvailability(),
      },
    };
  }

  /**
   * Update load balancing strategy.
   */
  async updateLoadBalancingStrategy(
    strategy: LoadBalancingStrategy
  ): Promise<OrchestrationResult<void>> {
    try {
      if (!this.isValidLoadBalancingStrategy(strategy)) {
        return {
          ok: false,
          error: {
            id: this.generateId(),
            type: "validation",
            message: "Invalid load balancing strategy",
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      this.loadBalancer = strategy;

      await this.redis.setex(
        "coordinator:load_balancer",
        86400, // 24 hours
        JSON.stringify(strategy)
      );

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to update load balancing strategy: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  // ─── Private methods ──────────────────────────────────────────────────────

  private async loadProviderNodes(): Promise<void> {
    const providers = this.registry.getAllProviders();

    for (const providerMeta of providers) {
      const adapter = this.registry.getAdapter(providerMeta.id);
      if (adapter) {
        const metadata: ProviderMetadata = {
          ...providerMeta,
          ...(!(providerMeta as Record<string, unknown>).website && {
            website: "https://example.com",
          }),
        } as ProviderMetadata;
        const node: ProviderNode = {
          id: providerMeta.id as ProviderId,
          adapter,
          metadata,
          status: "active",
          health: { status: "healthy", uptime: 100 },
          loadMetrics: initializeLoadMetrics(),
          configuration: getDefaultConfiguration(),
          lastHealthCheck: new Date(),
          failureCount: 0,
        };

        this.providerNodes.set(node.id, node);
        setupDefaultFailoverStrategy(node.id, this.providerNodes, this.failoverStrategies);
      }
    }

    log.info({ nodesCount: this.providerNodes.size }, "Loaded provider nodes");
  }

  private startHealthMonitoring(): void {
    this.scheduler.register(
      this.healthTaskId,
      () => performHealthChecks(this.providerNodes),
      30_000
    );
    log.info("Started provider health monitoring");
  }

  private startMetricsCollection(): void {
    this.scheduler.register(
      this.metricsTaskId,
      () => collectProviderMetrics(this.providerNodes, this.redis),
      60_000
    );
    log.info("Started provider metrics collection");
  }

  private registerEventHandlers(): void {
    this.eventService.registerHandler("PROVIDER_HEALTH_CHANGED", {
      eventType: "PROVIDER_HEALTH_CHANGED",
      handle: async (event) => {
        const data = event.data as { providerId: string; health: ComponentHealth };
        const node = this.providerNodes.get(data.providerId as ProviderId);
        if (node) {
          node.health = data.health;
        }
      },
    });

    this.eventService.registerHandler("PROVIDER_ERROR", {
      eventType: "PROVIDER_ERROR",
      handle: async (event) => {
        const data = event.data as { providerId: string; error: string };
        const node = this.providerNodes.get(data.providerId as ProviderId);
        if (node) {
          node.failureCount++;
          node.lastFailure = new Date();
          node.loadMetrics.errorRate = Math.min(1, node.loadMetrics.errorRate + 0.1);
        }
      },
    });
  }

  private async routeRequests(
    targetProviders: ProviderId[],
    content: CanonicalPost,
    _options: Record<string, unknown>
  ): Promise<RoutingDecision[]> {
    const decisions: RoutingDecision[] = [];

    for (const providerId of targetProviders) {
      const decision = await this.selectOptimalProvider([providerId], content);
      if (decision.ok) {
        decisions.push(decision.value);
      }
    }

    return decisions;
  }

  private async executeCoordination(
    job: CoordinationJob,
    content: CanonicalPost,
    _options: Record<string, unknown>
  ): Promise<Map<ProviderId, PublishResult>> {
    const failoverFn = (failedProvider: ProviderId, cnt: CanonicalPost, jobId: string) =>
      this.handleFailover(failedProvider, cnt, jobId);

    switch (job.metadata.strategy) {
      case "parallel":
        return executeParallel(job, content, this.providerNodes);
      case "sequential":
        return executeSequential(job, content, this.providerNodes, failoverFn);
      case "optimized":
      default:
        return executeOptimized(job, content, this.providerNodes, failoverFn);
    }
  }

  private isValidLoadBalancingStrategy(strategy: LoadBalancingStrategy): boolean {
    const validTypes = ["round_robin", "weighted", "least_connections", "response_time", "custom"];
    return validTypes.includes(strategy.type) && typeof strategy.enabled === "boolean";
  }

  private calculateFailureRate(): number {
    const totalJobs = this.activeJobs.size;
    const failedJobs = Array.from(this.activeJobs.values()).filter(
      (job) => job.status === "failed"
    ).length;
    return totalJobs > 0 ? failedJobs / totalJobs : 0;
  }

  private calculateAverageExecutionTime(): number {
    const completedJobs = Array.from(this.activeJobs.values()).filter(
      (job) => job.status === "completed" && job.completedAt
    );
    if (completedJobs.length === 0) return 0;

    const totalTime = completedJobs.reduce(
      (sum, job) => sum + (job.completedAt!.getTime() - job.startedAt.getTime()),
      0
    );
    return totalTime / completedJobs.length;
  }

  private calculateProviderAvailability(): Record<ProviderId, number> {
    const availability: Partial<Record<ProviderId, number>> = {};
    for (const [providerId, node] of this.providerNodes) {
      availability[providerId] = node.health.status === "healthy" ? 1 : 0;
    }
    return availability as Record<ProviderId, number>;
  }

  private async emitFailoverEvent(
    failedProvider: ProviderId,
    fallbackProvider: ProviderId,
    jobId: string
  ): Promise<void> {
    await this.eventService.publishEvent({
      id: this.generateId(),
      type: "PROVIDER_FAILOVER",
      aggregateId: jobId,
      aggregateType: "ProviderCoordination",
      version: 1,
      data: { failedProvider, fallbackProvider, jobId, timestamp: new Date() },
      metadata: { source: "ProviderCoordinator" },
      timestamp: new Date(),
    });
  }

  private generateId(): string {
    return `coord_${randomUUID()}`;
  }
}
