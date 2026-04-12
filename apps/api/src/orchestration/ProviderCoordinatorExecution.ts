/**
 * @file ProviderCoordinatorExecution.ts
 * @description Pure functions for provider scoring, content publishing, and coordinated
 *              execution strategies (parallel, sequential, optimized).
 * @layer infrastructure
 */

import type { PublishResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";
import type { CoordinationJob, ProviderNode } from "./providerCoordinatorTypes.js";
import { AppError } from "../lib/errors/AppError.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

// ─── Scoring ─────────────────────────────────────────────────────────────────

interface ProviderScore {
  providerId: ProviderId;
  score: number;
  reasoning: string[];
  estimatedLatency: number;
  loadScore: number;
}

/**
 * Score a list of providers based on health, load, response time, and error rate.
 * Returns the list sorted descending by score (best first).
 */
export function scoreProviders(
  providers: ProviderId[],
  providerNodes: Map<ProviderId, ProviderNode>,
  _content: CanonicalPost,
  _criteria: Record<string, unknown>
): ProviderScore[] {
  const scores: ProviderScore[] = [];

  for (const providerId of providers) {
    const node = providerNodes.get(providerId);
    if (!node) continue;

    let score = 0;
    const reasoning: string[] = [];

    // Base score from configuration
    score += node.configuration.priority * 0.1;
    score += node.configuration.weight * 0.1;
    reasoning.push(`Base priority: ${node.configuration.priority}`);

    // Health score
    if (node.health.status === "healthy") {
      score += 0.3;
      reasoning.push("Provider is healthy");
    } else {
      score -= 0.2;
      reasoning.push("Provider has health issues");
    }

    // Load score
    const loadScore =
      1 - node.loadMetrics.activeRequests / node.configuration.maxConcurrentRequests;
    score += loadScore * 0.2;
    reasoning.push(`Load score: ${Math.round(loadScore * 100)}%`);

    // Response time score
    const responseTimeScore = Math.max(0, 1 - node.loadMetrics.averageResponseTime / 5000);
    score += responseTimeScore * 0.2;
    reasoning.push(`Response time score: ${Math.round(responseTimeScore * 100)}%`);

    // Error rate score
    const errorRateScore = Math.max(0, 1 - node.loadMetrics.errorRate);
    score += errorRateScore * 0.2;
    reasoning.push(`Error rate score: ${Math.round(errorRateScore * 100)}%`);

    scores.push({
      providerId,
      score,
      reasoning,
      estimatedLatency: node.loadMetrics.averageResponseTime,
      loadScore,
    });
  }

  // Sort by score descending (best first)
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

// ─── Publishing ───────────────────────────────────────────────────────────────

/**
 * Publish content to a single provider node.
 * Mutates the node's loadMetrics in-place (activeRequests, requestsPerMinute,
 * averageResponseTime) to reflect the completed request.
 * Throws if the provider is not active or not found.
 */
async function publishToProviderNode(
  providerId: ProviderId,
  content: CanonicalPost,
  providerNodes: Map<ProviderId, ProviderNode>
): Promise<PublishResult> {
  const startTime = Date.now();
  const node = providerNodes.get(providerId);

  if (!node || node.status !== "active") {
    throw AppError.externalService(providerId, `Provider ${providerId} is not available`);
  }

  try {
    node.loadMetrics.activeRequests++;

    const renderResult = node.adapter.render(content);
    if (!renderResult.ok) {
      throw AppError.internal(`Content rendering failed: ${renderResult.error}`);
    }

    const publishResult = await node.adapter.publish({
      channelId: "default",
      post: renderResult.value,
      dedupeKey: `${content.id}_${providerId}`,
      config: { connectedAt: new Date() },
    });

    const duration = Date.now() - startTime;

    if (publishResult.ok) {
      const result: PublishResult = {
        providerId,
        status: "success",
        providerPostId: publishResult.value.providerPostId,
        publishedAt: publishResult.value.publishedAt,
        retryCount: 0,
        duration,
      };
      if (publishResult.value.url) {
        result.url = publishResult.value.url;
      }
      return result;
    } else {
      return { providerId, status: "failed", error: publishResult.error, retryCount: 0, duration };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;
    return { providerId, status: "failed", error: errorMessage, retryCount: 0, duration };
  } finally {
    node.loadMetrics.activeRequests--;
    node.loadMetrics.requestsPerMinute++;
    node.loadMetrics.averageResponseTime =
      (node.loadMetrics.averageResponseTime + (Date.now() - startTime)) / 2;
  }
}

// ─── Execution strategies ─────────────────────────────────────────────────────

/**
 * Execute publishing to all job providers in parallel (fire-and-forget, collects all results).
 */
export async function executeParallel(
  job: CoordinationJob,
  content: CanonicalPost,
  providerNodes: Map<ProviderId, ProviderNode>
): Promise<Map<ProviderId, PublishResult>> {
  const results = new Map<ProviderId, PublishResult>();
  const promises = job.providers.map(async (providerId) => {
    try {
      const result = await publishToProviderNode(providerId, content, providerNodes);
      results.set(providerId, result);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.set(providerId, {
        providerId,
        status: "failed",
        error: errorMessage,
        retryCount: 0,
        duration: 0,
      });
    }
  });

  await Promise.allSettled(promises);
  return results;
}

/**
 * Execute publishing to all job providers one-by-one. Supports per-provider failover
 * when `job.metadata.failoverEnabled` is true.
 *
 * The `handleFailoverFn` callback is injected to avoid a circular dependency on the
 * main ProviderCoordinator class — it delegates back to `coordinator.handleFailover()`.
 */
export async function executeSequential(
  job: CoordinationJob,
  content: CanonicalPost,
  providerNodes: Map<ProviderId, ProviderNode>,
  handleFailoverFn: (
    failedProvider: ProviderId,
    content: CanonicalPost,
    jobId: string
  ) => Promise<{ ok: boolean; value?: ProviderId }>
): Promise<Map<ProviderId, PublishResult>> {
  const results = new Map<ProviderId, PublishResult>();

  for (const providerId of job.providers) {
    try {
      const result = await publishToProviderNode(providerId, content, providerNodes);
      results.set(providerId, result);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.set(providerId, {
        providerId,
        status: "failed",
        error: errorMessage,
        retryCount: 0,
        duration: 0,
      });

      if (job.metadata.failoverEnabled) {
        const failoverResult = await handleFailoverFn(providerId, content, job.id);
        if (failoverResult.ok && failoverResult.value) {
          try {
            const fallbackResult = await publishToProviderNode(
              failoverResult.value,
              content,
              providerNodes
            );
            results.set(failoverResult.value, fallbackResult);
          } catch (fallbackError) {
            log.error(
              { err: fallbackError, failoverProvider: failoverResult.value },
              "Failover also failed"
            );
          }
        }
      }
    }
  }

  return results;
}

/**
 * Optimized execution: fast providers (avg response time < 1 s) run in parallel,
 * slow providers run sequentially.
 */
export async function executeOptimized(
  job: CoordinationJob,
  content: CanonicalPost,
  providerNodes: Map<ProviderId, ProviderNode>,
  handleFailoverFn: (
    failedProvider: ProviderId,
    content: CanonicalPost,
    jobId: string
  ) => Promise<{ ok: boolean; value?: ProviderId }>
): Promise<Map<ProviderId, PublishResult>> {
  const fastProviders: ProviderId[] = [];
  const slowProviders: ProviderId[] = [];

  for (const providerId of job.providers) {
    const node = providerNodes.get(providerId);
    if (node && node.loadMetrics.averageResponseTime < 1000) {
      fastProviders.push(providerId);
    } else {
      slowProviders.push(providerId);
    }
  }

  const results = new Map<ProviderId, PublishResult>();

  if (fastProviders.length > 0) {
    const fastResults = await executeParallel(
      { ...job, providers: fastProviders },
      content,
      providerNodes
    );
    for (const [pid, result] of fastResults) {
      results.set(pid, result);
    }
  }

  if (slowProviders.length > 0) {
    const slowResults = await executeSequential(
      { ...job, providers: slowProviders },
      content,
      providerNodes,
      handleFailoverFn
    );
    for (const [pid, result] of slowResults) {
      results.set(pid, result);
    }
  }

  return results;
}
