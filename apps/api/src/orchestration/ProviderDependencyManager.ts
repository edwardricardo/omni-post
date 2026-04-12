/**
 * @file ProviderDependencyManager.ts
 * @description Manages complex provider dependencies, execution order, and retry policies
 *              with intelligent dependency resolution and deadlock detection.
 * @layer infrastructure
 */

import { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import {
  ProviderDependency,
  PublishResult,
  OrchestrationError as _OrchestrationError,
  OrchestrationResult,
  ConflictResolutionStrategy as _ConflictResolutionStrategy,
} from "@shared/orchestration";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { EventService } from "../events/EventService";
import {
  DependencyNode,
  DependencyGraph,
  ExecutionContext,
  DependencyValidation,
  generateDependencyId,
  calculateRetryDelay,
  evaluateCondition,
} from "./dependencyTypes.js";
import { DependencyGraphBuilder } from "./DependencyGraphBuilder.js";

export class ProviderDependencyManager {
  private prisma: PrismaClient;
  private redis: Redis;
  private eventService: EventService;
  private activeDependencyGraphs = new Map<string, DependencyGraph>();
  private graphBuilder = new DependencyGraphBuilder();

  constructor(dependencies: { prisma: PrismaClient; redis: Redis; eventService: EventService }) {
    this.prisma = dependencies.prisma;
    this.redis = dependencies.redis;
    this.eventService = dependencies.eventService;
  }

  /**
   * Build dependency graph from provider dependencies
   */
  async buildDependencyGraph(
    providers: ProviderId[],
    dependencies: ProviderDependency[]
  ): Promise<OrchestrationResult<DependencyGraph>> {
    return this.graphBuilder.buildDependencyGraph(providers, dependencies);
  }

  /**
   * Validate provider dependencies
   */
  async validateDependencies(
    providers: ProviderId[],
    dependencies: ProviderDependency[]
  ): Promise<DependencyValidation> {
    return this.graphBuilder.validateDependencies(providers, dependencies);
  }

  /**
   * Get next ready providers for execution
   */
  async getReadyProviders(
    graphId: string,
    context: ExecutionContext
  ): Promise<OrchestrationResult<ProviderId[]>> {
    try {
      const graph = this.activeDependencyGraphs.get(graphId);
      if (!graph) {
        return {
          ok: false,
          error: {
            id: generateDependencyId(),
            type: "validation",
            message: `Dependency graph not found: ${graphId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      const readyProviders: ProviderId[] = [];

      // Check each ready node for actual readiness
      for (const providerId of graph.readyNodes) {
        const node = graph.nodes.get(providerId)!;

        // Skip if already completed or running
        if (node.status === "completed" || node.status === "running") {
          continue;
        }

        // Check if all dependencies are satisfied
        const dependenciesSatisfied = await this.checkDependenciesSatisfied(node, graph, context);

        if (dependenciesSatisfied) {
          // Check retry policy if node previously failed
          if (node.status === "failed" && node.nextRetryAt && node.nextRetryAt > new Date()) {
            continue; // Not ready for retry yet
          }

          readyProviders.push(providerId);
        }
      }

      return { ok: true, value: readyProviders };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: generateDependencyId(),
          type: "system",
          message: `Failed to get ready providers: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Update provider status and propagate readiness
   */
  async updateProviderStatus(
    graphId: string,
    providerId: ProviderId,
    status: DependencyNode["status"],
    result?: PublishResult
  ): Promise<OrchestrationResult<void>> {
    try {
      const graph = this.activeDependencyGraphs.get(graphId);
      if (!graph) {
        return {
          ok: false,
          error: {
            id: generateDependencyId(),
            type: "validation",
            message: `Dependency graph not found: ${graphId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      const node = graph.nodes.get(providerId);
      if (!node) {
        return {
          ok: false,
          error: {
            id: generateDependencyId(),
            type: "validation",
            message: `Provider not found in graph: ${providerId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      // Update node status
      node.status = status;
      if (result) {
        node.result = result;
      }

      // Handle status-specific logic
      switch (status) {
        case "completed":
          await this.handleProviderCompletion(graph, providerId);
          break;

        case "failed":
          await this.handleProviderFailure(graph, providerId, result);
          break;

        case "running":
          // Remove from ready nodes
          graph.readyNodes.delete(providerId);
          break;
      }

      // Update dependency graph cache
      await this.cacheGraph(graphId, graph);

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: generateDependencyId(),
          type: "system",
          message: `Failed to update provider status: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Calculate retry delay for failed provider
   */
  calculateRetryDelay(
    retryCount: number,
    retryPolicy: Parameters<typeof calculateRetryDelay>[1]
  ): number {
    return calculateRetryDelay(retryCount, retryPolicy);
  }

  /**
   * Check if deadlock exists in current state
   */
  async detectDeadlock(graphId: string): Promise<boolean> {
    const graph = this.activeDependencyGraphs.get(graphId);
    if (!graph) {
      return false;
    }

    // Check if there are any pending nodes but no ready nodes
    const hasPendingNodes = Array.from(graph.nodes.values()).some(
      (node) => node.status === "pending" || node.status === "blocked"
    );

    const hasReadyNodes = graph.readyNodes.size > 0;

    // Deadlock exists if there are pending nodes but no ready nodes
    return hasPendingNodes && !hasReadyNodes;
  }

  /**
   * Resolve deadlock by identifying and handling blocking issues
   */
  async resolveDeadlock(
    graphId: string,
    context: ExecutionContext
  ): Promise<OrchestrationResult<string[]>> {
    try {
      const graph = this.activeDependencyGraphs.get(graphId);
      if (!graph) {
        return {
          ok: false,
          error: {
            id: generateDependencyId(),
            type: "validation",
            message: `Dependency graph not found: ${graphId}`,
            retryable: false,
            occurredAt: new Date(),
          },
        };
      }

      const resolutionActions: string[] = [];

      // Find nodes that are blocking progress
      for (const [providerId, node] of graph.nodes) {
        if (node.status === "failed") {
          // Check if this failed node is blocking others
          const blockedDependents = Array.from(node.dependents).filter(
            (depId) => graph.nodes.get(depId)?.status === "blocked"
          );

          if (blockedDependents.length > 0) {
            // Apply conflict resolution strategy
            switch (context.conflictResolution) {
              case "BEST_EFFORT":
                // Mark dependents as ready to continue without this provider
                for (const depId of blockedDependents) {
                  const depNode = graph.nodes.get(depId)!;
                  depNode.dependencies.delete(providerId);
                  if (depNode.dependencies.size === 0) {
                    depNode.status = "pending";
                    graph.readyNodes.add(depId);
                  }
                }
                resolutionActions.push(
                  `Bypassed failed provider ${providerId} for best-effort execution`
                );
                break;

              case "FAIL_FAST":
                // Mark all dependents as failed
                for (const depId of blockedDependents) {
                  graph.nodes.get(depId)!.status = "failed";
                }
                resolutionActions.push(`Failed dependent providers due to ${providerId} failure`);
                break;

              case "CONTINUE_ON_ERROR":
                // Similar to best effort but log as continuation
                for (const depId of blockedDependents) {
                  const depNode = graph.nodes.get(depId)!;
                  depNode.dependencies.delete(providerId);
                  if (depNode.dependencies.size === 0) {
                    depNode.status = "pending";
                    graph.readyNodes.add(depId);
                  }
                }
                resolutionActions.push(`Continued execution despite ${providerId} failure`);
                break;
            }
          }
        }
      }

      // Update cache
      await this.cacheGraph(graphId, graph);

      return { ok: true, value: resolutionActions };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: generateDependencyId(),
          type: "system",
          message: `Failed to resolve deadlock: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get dependency graph statistics
   */
  async getGraphStatistics(graphId: string): Promise<{
    totalProviders: number;
    completedProviders: number;
    failedProviders: number;
    pendingProviders: number;
    readyProviders: number;
    blockedProviders: number;
    averageDependencyDepth: number;
    estimatedCompletion: Date | null;
  }> {
    const graph = this.activeDependencyGraphs.get(graphId);
    if (!graph) {
      return {
        totalProviders: 0,
        completedProviders: 0,
        failedProviders: 0,
        pendingProviders: 0,
        readyProviders: 0,
        blockedProviders: 0,
        averageDependencyDepth: 0,
        estimatedCompletion: null,
      };
    }

    const nodes = Array.from(graph.nodes.values());

    return {
      totalProviders: nodes.length,
      completedProviders: nodes.filter((n) => n.status === "completed").length,
      failedProviders: nodes.filter((n) => n.status === "failed").length,
      pendingProviders: nodes.filter((n) => n.status === "pending").length,
      readyProviders: graph.readyNodes.size,
      blockedProviders: nodes.filter((n) => n.status === "blocked").length,
      averageDependencyDepth: this.calculateAverageDependencyDepth(graph),
      estimatedCompletion: this.estimateCompletion(graph),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async checkDependenciesSatisfied(
    node: DependencyNode,
    graph: DependencyGraph,
    _context: ExecutionContext
  ): Promise<boolean> {
    for (const depId of node.dependencies) {
      const depNode = graph.nodes.get(depId)!;

      // Check if dependency is completed successfully
      if (depNode.status !== "completed") {
        return false;
      }

      // Check dependency condition if specified
      const dependency = await this.getDependencyConfig(node.providerId, depId);
      if (dependency?.condition && depNode.result) {
        const conditionMet = await evaluateCondition(dependency.condition, depNode.result);
        if (!conditionMet) {
          return false;
        }
      }
    }

    return true;
  }

  private async handleProviderCompletion(
    graph: DependencyGraph,
    providerId: ProviderId
  ): Promise<void> {
    const node = graph.nodes.get(providerId)!;

    // Check if any dependents are now ready
    for (const dependentId of node.dependents) {
      const dependentNode = graph.nodes.get(dependentId)!;

      // Check if all dependencies of the dependent are now satisfied
      const allDepsSatisfied = Array.from(dependentNode.dependencies).every(
        (depId) => graph.nodes.get(depId)?.status === "completed"
      );

      if (allDepsSatisfied && dependentNode.status === "pending") {
        graph.readyNodes.add(dependentId);
      }
    }
  }

  private async handleProviderFailure(
    graph: DependencyGraph,
    providerId: ProviderId,
    _result?: PublishResult
  ): Promise<void> {
    const node = graph.nodes.get(providerId)!;

    // Increment retry count
    node.retryCount++;

    // Check if we should retry
    const dependency = await this.getDependencyConfig(providerId, "self");
    if (dependency?.retryPolicy && node.retryCount < dependency.retryPolicy.maxAttempts) {
      // Schedule retry
      const delay = calculateRetryDelay(node.retryCount - 1, dependency.retryPolicy);
      node.nextRetryAt = new Date(Date.now() + delay);
      node.status = "pending"; // Reset to pending for retry
      graph.readyNodes.add(providerId);
    } else {
      // Mark dependents as blocked
      for (const dependentId of node.dependents) {
        const dependentNode = graph.nodes.get(dependentId)!;
        if (dependentNode.status === "pending") {
          dependentNode.status = "blocked";
          graph.readyNodes.delete(dependentId);
        }
      }
    }
  }

  private calculateAverageDependencyDepth(graph: DependencyGraph): number {
    const depths = Array.from(graph.nodes.values()).map((node) => node.dependencies.size);
    return depths.length > 0 ? depths.reduce((sum, depth) => sum + depth, 0) / depths.length : 0;
  }

  private estimateCompletion(graph: DependencyGraph): Date | null {
    // Simple estimation based on remaining providers and average execution time
    const remaining = Array.from(graph.nodes.values()).filter(
      (n) => n.status === "pending" || n.status === "blocked"
    );

    if (remaining.length === 0) {
      return new Date(); // Already completed
    }

    // Estimate 30 seconds per provider (rough estimate)
    const estimatedMs = remaining.length * 30000;
    return new Date(Date.now() + estimatedMs);
  }

  private async cacheGraph(graphId: string, graph: DependencyGraph): Promise<void> {
    await this.redis.setex(
      `dependency:graph:${graphId}`,
      3600, // 1 hour
      JSON.stringify({
        ...graph,
        nodes: Array.from(graph.nodes.entries()),
        readyNodes: Array.from(graph.readyNodes),
      })
    );
  }

  private async getDependencyConfig(
    _providerId: ProviderId,
    _depId: string
  ): Promise<ProviderDependency | null> {
    // This would typically fetch from a configuration store
    // For now, return null (no specific config)
    return null;
  }
}
