/**
 * @file ProviderHealthMonitor.ts
 * @description Stateful facade for provider health monitoring that owns timer lifecycle,
 *              event-handler wiring, and delegates to pure monitoring/execution helpers.
 * @layer infrastructure
 * - `getDefaultConfiguration`      → {@link MonitoringHelpers.getDefaultConfiguration}
 * - `setupDefaultFailoverStrategy` → {@link MonitoringHelpers.setupDefaultFailoverStrategy}
 * - `evaluateFailoverConditions`   → {@link MonitoringHelpers.evaluateFailoverConditions}
 * - `performHealthChecks`          → {@link MonitoringHelpers.performHealthChecks}
 * - `collectProviderMetrics`       → {@link MonitoringHelpers.collectProviderMetrics}
 * - `scoreProviders`               → {@link ExecutionHelpers.scoreProviders}
 *
 * All other methods are unique to this class (timer management, event wiring,
 * status queries, and job-level metrics).
 *
 * @module orchestration/ProviderHealthMonitor
 */
import type Redis from "ioredis";
import type { ComponentHealth } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";
import type { EventService } from "../events/EventService";
import { createLogger } from "../lib/logger.js";
import type {
  ProviderNodeExtended,
  FailoverCondition,
  LoadMetrics,
  ProviderConfiguration,
  FailoverStrategy,
} from "./providerCoordinatorTypes.js";
import {
  initializeLoadMetrics as _initLoadMetrics,
  getDefaultConfiguration as _getDefaultConfig,
  setupDefaultFailoverStrategy as _setupFailover,
  performHealthChecks as _performHealthChecks,
  collectProviderMetrics as _collectMetrics,
  evaluateFailoverConditions as _evaluateFailover,
} from "./ProviderCoordinatorMonitoring.js";
import { scoreProviders as _scoreProviders } from "./ProviderCoordinatorExecution.js";

const log = createLogger("provider-health-monitor");

/**
 * Score computed for a single provider during selection.
 */
interface ProviderScore {
  providerId: ProviderId;
  score: number;
  reasoning: string[];
  estimatedLatency: number;
  loadScore: number;
}

/**
 * Stateful health monitor that wraps shared provider state and delegates
 * heavy lifting to the pure functions in ProviderCoordinatorMonitoring and
 * ProviderCoordinatorExecution.
 *
 * @description Created via {@link ProviderCoordinator.getHealthMonitor} so that
 * it shares the same providerNodes and failoverStrategies maps as the coordinator.
 */
export class ProviderHealthMonitor {
  private redis: Redis;
  private eventService: EventService;
  private providerNodes: Map<ProviderId, ProviderNodeExtended>;
  private failoverStrategies: Map<ProviderId, FailoverStrategy>;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsCollectionInterval?: NodeJS.Timeout;

  constructor(dependencies: {
    redis: Redis;
    eventService: EventService;
    providerNodes: Map<ProviderId, ProviderNodeExtended>;
    failoverStrategies: Map<ProviderId, FailoverStrategy>;
  }) {
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
    this.providerNodes = dependencies.providerNodes;
    this.failoverStrategies = dependencies.failoverStrategies;
  }

  // ─── Timer lifecycle (unique to this class) ─────────────────────────────────

  /**
   * Start periodic health monitoring (30 s interval).
   *
   * @description Delegates each tick to
   * {@link ProviderCoordinatorMonitoring.performHealthChecks}.
   */
  startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await _performHealthChecks(this.providerNodes);
      } catch (error: unknown) {
        log.error({ err: error }, "Health check error");
      }
    }, 30000);
    this.healthCheckInterval.unref();
    log.info("Started provider health monitoring");
  }

  /**
   * Start periodic metrics collection (60 s interval).
   *
   * @description Delegates each tick to
   * {@link ProviderCoordinatorMonitoring.collectProviderMetrics}.
   */
  startMetricsCollection(): void {
    this.metricsCollectionInterval = setInterval(async () => {
      try {
        await _collectMetrics(this.providerNodes, this.redis);
      } catch (error: unknown) {
        log.error({ err: error }, "Metrics collection error");
      }
    }, 60000);
    this.metricsCollectionInterval.unref();
    log.info("Started provider metrics collection");
  }

  // ─── Event wiring (unique to this class) ────────────────────────────────────

  /**
   * Register event handlers for provider health changes.
   *
   * @description Listens to `PROVIDER_HEALTH_CHANGED` and `PROVIDER_ERROR`
   * events and mutates the shared providerNodes map accordingly.
   */
  registerEventHandlers(): void {
    this.eventService.registerHandler("PROVIDER_HEALTH_CHANGED", {
      eventType: "PROVIDER_HEALTH_CHANGED",
      handle: async (event) => {
        const data = event.data as { providerId: string; health: ComponentHealth };
        this.updateProviderHealth(data.providerId as ProviderId, data.health);
      },
    });

    this.eventService.registerHandler("PROVIDER_ERROR", {
      eventType: "PROVIDER_ERROR",
      handle: async (event) => {
        const data = event.data as { providerId: string; error: string };
        this.handleProviderError(data.providerId as ProviderId);
      },
    });
  }

  // ─── Delegated methods ──────────────────────────────────────────────────────

  /**
   * Score providers based on health, load, and criteria.
   *
   * @description Delegates to {@link ProviderCoordinatorExecution.scoreProviders}.
   * @param providers - List of provider IDs to score
   * @param content - The canonical post being evaluated
   * @param criteria - Additional scoring criteria
   * @returns Sorted array of provider scores (best first)
   */
  async scoreProviders(
    providers: ProviderId[],
    content: CanonicalPost,
    criteria: Record<string, unknown>
  ): Promise<ProviderScore[]> {
    return _scoreProviders(providers, this.providerNodes, content, criteria);
  }

  /**
   * Evaluate whether failover conditions are met for a provider.
   *
   * @description Delegates to
   * {@link ProviderCoordinatorMonitoring.evaluateFailoverConditions}.
   * @param providerId - The provider to check
   * @param conditions - Conditions to evaluate
   * @returns True if any condition is met
   */
  async evaluateFailoverConditions(
    providerId: ProviderId,
    conditions: FailoverCondition[]
  ): Promise<boolean> {
    return _evaluateFailover(providerId, conditions, this.providerNodes);
  }

  /**
   * Setup default failover strategy for a provider.
   *
   * @description Delegates to
   * {@link ProviderCoordinatorMonitoring.setupDefaultFailoverStrategy}.
   * @param providerId - The provider to configure
   */
  setupDefaultFailoverStrategy(providerId: ProviderId): void {
    _setupFailover(providerId, this.providerNodes, this.failoverStrategies);
  }

  /**
   * Initialize default load metrics for a new provider node.
   *
   * @description Delegates to
   * {@link ProviderCoordinatorMonitoring.initializeLoadMetrics}.
   * @returns Fresh LoadMetrics object with zero values
   */
  initializeLoadMetrics(): LoadMetrics {
    return _initLoadMetrics();
  }

  /**
   * Get default provider configuration.
   *
   * @description Delegates to
   * {@link ProviderCoordinatorMonitoring.getDefaultConfiguration}.
   * @returns Default ProviderConfiguration
   */
  getDefaultConfiguration(): ProviderConfiguration {
    return _getDefaultConfig();
  }

  // ─── Unique query methods ───────────────────────────────────────────────────

  /**
   * Get the health status of a single provider.
   *
   * @description Returns "healthy", "degraded", or "unhealthy" based on the
   * provider node's status and health fields.
   * @param providerId - The provider to check
   * @returns Health status string
   */
  getProviderStatus(providerId: ProviderId): "healthy" | "degraded" | "unhealthy" {
    const node = this.providerNodes.get(providerId);
    if (!node || node.status === "failed" || node.status === "inactive") {
      return "unhealthy";
    }
    if (node.health.status === "healthy") {
      return "healthy";
    }
    return "degraded";
  }

  /**
   * Calculate provider availability map.
   *
   * @description Maps each provider to 1 (healthy) or 0 (not healthy).
   * @returns Record of provider IDs to availability (0 or 1)
   */
  calculateProviderAvailability(): Record<ProviderId, number> {
    const availability: Partial<Record<ProviderId, number>> = {};
    for (const [providerId, node] of this.providerNodes) {
      availability[providerId] = node.health.status === "healthy" ? 1 : 0;
    }
    return availability as Record<ProviderId, number>;
  }

  /**
   * Calculate failure rate from a list of jobs.
   *
   * @description Counts jobs with status "failed" and divides by total count.
   * @param jobs - Array of job-like objects with a status field
   * @returns Failure rate between 0 and 1
   */
  calculateFailureRate(jobs: Array<{ status: string }>): number {
    const totalJobs = jobs.length;
    const failedJobs = jobs.filter((job) => job.status === "failed").length;
    return totalJobs > 0 ? failedJobs / totalJobs : 0;
  }

  /**
   * Calculate average execution time from completed jobs.
   *
   * @description Only considers jobs with status "completed" and a completedAt date.
   * @param jobs - Array of job-like objects with status, completedAt, and startedAt
   * @returns Average execution time in milliseconds, or 0 if no completed jobs
   */
  calculateAverageExecutionTime(
    jobs: Array<{ status: string; completedAt?: Date; startedAt: Date }>
  ): number {
    const completedJobs = jobs.filter((job) => job.status === "completed" && job.completedAt);
    if (completedJobs.length === 0) return 0;

    const totalTime = completedJobs.reduce(
      (sum, job) => sum + (job.completedAt!.getTime() - job.startedAt.getTime()),
      0
    );
    return totalTime / completedJobs.length;
  }

  // ─── Private helpers (unique event-handler callbacks) ───────────────────────

  /**
   * Update provider health from an event payload.
   * @param providerId - The provider whose health changed
   * @param health - New ComponentHealth value
   */
  private updateProviderHealth(providerId: ProviderId, health: ComponentHealth): void {
    const node = this.providerNodes.get(providerId);
    if (node) {
      node.health = health;
    }
  }

  /**
   * Handle provider error by incrementing failure count and error rate.
   * @param providerId - The provider that experienced an error
   */
  private handleProviderError(providerId: ProviderId): void {
    const node = this.providerNodes.get(providerId);
    if (node) {
      node.failureCount++;
      node.lastFailure = new Date();
      node.loadMetrics.errorRate = Math.min(1, node.loadMetrics.errorRate + 0.1);
    }
  }
}
