/**
 * @file ProviderCoordinatorMonitoring.ts
 * @description Pure functions for provider health checks, metrics collection,
 *              failover condition evaluation, and default configuration factories.
 * @layer infrastructure
 */

import type Redis from "ioredis";
import type { ComponentHealth, PublishResult } from "@shared/orchestration";
import type { ProviderId } from "../providers/providerAdapter.interface";
import type {
  ProviderNode,
  ProviderConfiguration,
  LoadMetrics,
  FailoverStrategy,
  FailoverCondition,
} from "./providerCoordinatorTypes.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

// ─── Default factories ────────────────────────────────────────────────────────

export function initializeLoadMetrics(): LoadMetrics {
  return {
    activeRequests: 0,
    requestsPerMinute: 0,
    averageResponseTime: 0,
    errorRate: 0,
    queueDepth: 0,
    resourceUtilization: 0,
    capacity: 100,
    throughput: 0,
  };
}

export function getDefaultConfiguration(): ProviderConfiguration {
  return {
    priority: 1,
    weight: 1,
    maxConcurrentRequests: 10,
    timeoutMs: 30000,
    retryPolicy: {
      maxAttempts: 3,
      backoffMs: 1000,
      exponentialBackoff: true,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeMs: 60000,
    },
    rateLimit: {
      requestsPerMinute: 100,
      burstSize: 20,
    },
  };
}

/**
 * Register a default immediate failover strategy for a provider.
 * Uses all other known providers as fallbacks.
 */
export function setupDefaultFailoverStrategy(
  providerId: ProviderId,
  providerNodes: Map<ProviderId, ProviderNode>,
  failoverStrategies: Map<ProviderId, FailoverStrategy>
): void {
  const alternativeProviders = Array.from(providerNodes.keys()).filter((id) => id !== providerId);

  const strategy: FailoverStrategy = {
    primaryProvider: providerId,
    fallbackProviders: alternativeProviders,
    strategy: "immediate",
    conditions: [
      {
        type: "error_rate",
        threshold: 0.5,
        timeWindowMs: 300_000, // 5 minutes
        operator: "gt",
      },
      {
        type: "response_time",
        threshold: 10_000, // 10 seconds
        timeWindowMs: 60_000, // 1 minute
        operator: "gt",
      },
    ],
  };

  failoverStrategies.set(providerId, strategy);
}

// ─── Health checks ────────────────────────────────────────────────────────────

/**
 * Run health checks against every node in providerNodes.
 * Mutates node.health, node.status, node.failureCount, and node.lastHealthCheck in-place.
 */
export async function performHealthChecks(
  providerNodes: Map<ProviderId, ProviderNode>
): Promise<void> {
  for (const [providerId, node] of providerNodes) {
    try {
      const healthResult = await node.adapter.healthCheck();
      const isHealthy = healthResult.ok;

      const health: ComponentHealth = {
        status: isHealthy ? "healthy" : "unhealthy",
        uptime: isHealthy ? 100 : 0,
      };

      if (healthResult.ok && healthResult.value?.latency !== undefined) {
        health.latency = healthResult.value.latency;
      }

      if (node.loadMetrics.errorRate !== undefined) {
        health.errorRate = node.loadMetrics.errorRate;
      }

      node.health = health;
      node.lastHealthCheck = new Date();

      if (!isHealthy && node.status === "active") {
        node.status = "failed";
        node.failureCount++;
      } else if (isHealthy && node.status === "failed") {
        node.status = "active";
        node.failureCount = 0;
      }
    } catch (error: unknown) {
      log.error({ err: error, providerId }, "Health check failed for provider");
      node.health.status = "unhealthy";
      node.status = "failed";
      node.failureCount++;
    }
  }
}

// ─── Metrics collection ───────────────────────────────────────────────────────

/**
 * Snapshot current metrics for every provider node into Redis.
 * Resets the per-minute request counter on each node.
 */
export async function collectProviderMetrics(
  providerNodes: Map<ProviderId, ProviderNode>,
  redis: Redis
): Promise<void> {
  for (const [providerId, node] of providerNodes) {
    try {
      node.loadMetrics.requestsPerMinute = 0;

      await redis.setex(
        `coordinator:metrics:${providerId}`,
        300, // 5 minutes
        JSON.stringify({
          loadMetrics: node.loadMetrics,
          health: node.health,
          status: node.status,
          timestamp: new Date(),
        })
      );
    } catch (error: unknown) {
      log.error({ err: error, providerId }, "Failed to collect metrics for provider");
    }
  }
}

// ─── Metrics update (post-publish) ───────────────────────────────────────────

/**
 * Update errorRate and averageResponseTime for each provider after a publish batch.
 */
export function updateProviderMetrics(
  results: Map<ProviderId, PublishResult>,
  providerNodes: Map<ProviderId, ProviderNode>
): void {
  for (const [providerId, result] of results) {
    const node = providerNodes.get(providerId);
    if (!node) continue;

    if (result.status === "failed") {
      node.loadMetrics.errorRate = Math.min(1, node.loadMetrics.errorRate + 0.1);
    } else {
      node.loadMetrics.errorRate = Math.max(0, node.loadMetrics.errorRate - 0.05);
    }

    if (result.duration) {
      node.loadMetrics.averageResponseTime =
        (node.loadMetrics.averageResponseTime + result.duration) / 2;
    }
  }
}

// ─── Failover condition evaluation ───────────────────────────────────────────

function evaluateCondition(condition: FailoverCondition, node: ProviderNode): boolean {
  let currentValue: number;

  switch (condition.type) {
    case "error_rate":
      currentValue = node.loadMetrics.errorRate;
      break;
    case "response_time":
      currentValue = node.loadMetrics.averageResponseTime;
      break;
    case "availability":
      currentValue = node.health.status === "healthy" ? 1 : 0;
      break;
    default:
      return false;
  }

  switch (condition.operator) {
    case "gt":
      return currentValue > condition.threshold;
    case "lt":
      return currentValue < condition.threshold;
    case "eq":
      return currentValue === condition.threshold;
    default:
      return false;
  }
}

/**
 * Returns true if ANY of the given failover conditions is met for the provider node.
 */
export function evaluateFailoverConditions(
  providerId: ProviderId,
  conditions: FailoverCondition[],
  providerNodes: Map<ProviderId, ProviderNode>
): boolean {
  const node = providerNodes.get(providerId);
  if (!node) return false;

  return conditions.some((condition) => evaluateCondition(condition, node));
}
