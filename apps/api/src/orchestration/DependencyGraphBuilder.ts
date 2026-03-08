/**
 * Dependency Graph Builder
 *
 * Responsible for constructing, validating, and analyzing dependency graphs
 * for provider execution ordering. Contains pure graph logic with no
 * external dependencies on PrismaClient, Redis, or EventService.
 *
 * Extracted from ProviderDependencyManager as part of H8 large-file splitting.
 *
 * @module orchestration/DependencyGraphBuilder
 */

import type { ProviderDependency, OrchestrationResult } from "@shared/orchestration";
import type { ProviderId } from "../providers/providerAdapter.interface";
import type { DependencyGraph, DependencyValidation } from "./dependencyTypes.js";
import { generateDependencyId } from "./dependencyTypes.js";

export class DependencyGraphBuilder {
  /**
   * Build dependency graph from provider dependencies
   */
  buildDependencyGraph(
    providers: ProviderId[],
    dependencies: ProviderDependency[]
  ): OrchestrationResult<DependencyGraph> {
    try {
      const graph: DependencyGraph = {
        nodes: new Map(),
        executionOrder: [],
        hasCycles: false,
        readyNodes: new Set(),
      };

      // Initialize nodes
      for (const providerId of providers) {
        graph.nodes.set(providerId, {
          providerId,
          dependencies: new Set(),
          dependents: new Set(),
          status: "pending",
          retryCount: 0,
        });
      }

      // Build dependency relationships
      for (const dependency of dependencies) {
        const node = graph.nodes.get(dependency.providerId);
        if (!node) {
          return {
            ok: false,
            error: {
              id: generateDependencyId(),
              type: "validation",
              message: `Provider not found in dependency: ${dependency.providerId}`,
              retryable: false,
              occurredAt: new Date(),
            },
          };
        }

        for (const depProvider of dependency.dependsOn) {
          if (!graph.nodes.has(depProvider)) {
            return {
              ok: false,
              error: {
                id: generateDependencyId(),
                type: "validation",
                message: `Dependency provider not found: ${depProvider}`,
                retryable: false,
                occurredAt: new Date(),
              },
            };
          }

          node.dependencies.add(depProvider);
          graph.nodes.get(depProvider)!.dependents.add(dependency.providerId);
        }
      }

      // Detect cycles
      const cycleDetection = this.detectCycles(graph);
      if (cycleDetection.hasCycles) {
        return {
          ok: false,
          error: {
            id: generateDependencyId(),
            type: "validation",
            message: `Circular dependencies detected: ${cycleDetection.cycle?.join(" -> ")}`,
            retryable: false,
            occurredAt: new Date(),
            context: { cycle: cycleDetection.cycle },
          },
        };
      }

      // Calculate execution order using topological sort
      const executionOrder = this.topologicalSort(graph);
      if (!executionOrder.ok) {
        return executionOrder;
      }

      graph.executionOrder = executionOrder.value;

      // Identify initially ready nodes (no dependencies)
      for (const [providerId, node] of graph.nodes) {
        if (node.dependencies.size === 0) {
          graph.readyNodes.add(providerId);
        }
      }

      return { ok: true, value: graph };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: generateDependencyId(),
          type: "system",
          message: `Failed to build dependency graph: ${errorMessage}`,
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Validate provider dependencies for correctness and potential issues
   */
  validateDependencies(
    providers: ProviderId[],
    dependencies: ProviderDependency[]
  ): DependencyValidation {
    const validation: DependencyValidation = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
    };

    // Check for self-dependencies
    for (const dependency of dependencies) {
      if (dependency.dependsOn.includes(dependency.providerId)) {
        validation.isValid = false;
        validation.errors.push(`Self-dependency detected: ${dependency.providerId}`);
      }
    }

    // Check for missing providers
    const allReferencedProviders = new Set([
      ...providers,
      ...dependencies.flatMap((d) => [d.providerId, ...d.dependsOn]),
    ]);

    for (const providerId of allReferencedProviders) {
      if (!providers.includes(providerId)) {
        validation.errors.push(`Referenced provider not in execution list: ${providerId}`);
        validation.isValid = false;
      }
    }

    // Check for potential performance issues
    const maxDependencyDepth = this.calculateMaxDependencyDepth(dependencies);
    if (maxDependencyDepth > 5) {
      validation.warnings.push(
        `Deep dependency chain detected (depth: ${maxDependencyDepth}). Consider simplifying.`
      );
    }

    // Check for isolated providers (no dependencies or dependents)
    const connectedProviders = new Set(dependencies.flatMap((d) => [d.providerId, ...d.dependsOn]));
    for (const providerId of providers) {
      if (!connectedProviders.has(providerId)) {
        validation.suggestions.push(
          `Provider ${providerId} has no dependencies. Consider using SIMULTANEOUS strategy for better performance.`
        );
      }
    }

    return validation;
  }

  /**
   * Detect cycles in the dependency graph using DFS
   */
  detectCycles(graph: DependencyGraph): { hasCycles: boolean; cycle?: ProviderId[] } {
    const visited = new Set<ProviderId>();
    const recursionStack = new Set<ProviderId>();

    for (const [providerId] of graph.nodes) {
      if (!visited.has(providerId)) {
        const cycle = this.dfsForCycle(graph, providerId, visited, recursionStack, []);
        if (cycle) {
          return { hasCycles: true, cycle };
        }
      }
    }

    return { hasCycles: false };
  }

  /**
   * Compute topological sort (execution order) for the dependency graph
   */
  topologicalSort(graph: DependencyGraph): OrchestrationResult<ProviderId[]> {
    const inDegree = new Map<ProviderId, number>();
    const queue: ProviderId[] = [];
    const result: ProviderId[] = [];

    // Calculate in-degree for each node
    for (const [providerId, node] of graph.nodes) {
      inDegree.set(providerId, node.dependencies.size);
      if (node.dependencies.size === 0) {
        queue.push(providerId);
      }
    }

    while (queue.length > 0) {
      const currentProvider = queue.shift()!;
      result.push(currentProvider);

      const currentNode = graph.nodes.get(currentProvider)!;
      for (const dependent of currentNode.dependents) {
        const newInDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newInDegree);

        if (newInDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    if (result.length !== graph.nodes.size) {
      return {
        ok: false,
        error: {
          id: generateDependencyId(),
          type: "validation",
          message: "Circular dependency detected during topological sort",
          retryable: false,
          occurredAt: new Date(),
        },
      };
    }

    return { ok: true, value: result };
  }

  /**
   * Calculate the maximum depth of the dependency chain
   */
  calculateMaxDependencyDepth(dependencies: ProviderDependency[]): number {
    const depths = new Map<ProviderId, number>();
    const visiting = new Set<ProviderId>();

    const calculateDepth = (providerId: ProviderId): number => {
      if (depths.has(providerId)) {
        return depths.get(providerId)!;
      }

      // Detect cycles (including self-dependencies)
      if (visiting.has(providerId)) {
        depths.set(providerId, 0);
        return 0;
      }

      visiting.add(providerId);

      const dependency = dependencies.find((d) => d.providerId === providerId);
      if (!dependency || dependency.dependsOn.length === 0) {
        depths.set(providerId, 0);
        visiting.delete(providerId);
        return 0;
      }

      const maxDepDepth = Math.max(...dependency.dependsOn.map(calculateDepth));
      const depth = maxDepDepth + 1;
      depths.set(providerId, depth);
      visiting.delete(providerId);
      return depth;
    };

    return Math.max(...dependencies.map((d) => calculateDepth(d.providerId)));
  }

  /**
   * DFS helper for cycle detection
   */
  private dfsForCycle(
    graph: DependencyGraph,
    providerId: ProviderId,
    visited: Set<ProviderId>,
    recursionStack: Set<ProviderId>,
    path: ProviderId[]
  ): ProviderId[] | null {
    visited.add(providerId);
    recursionStack.add(providerId);
    path.push(providerId);

    const node = graph.nodes.get(providerId)!;
    for (const depId of node.dependencies) {
      if (!visited.has(depId)) {
        const cycle = this.dfsForCycle(graph, depId, visited, recursionStack, [...path]);
        if (cycle) return cycle;
      } else if (recursionStack.has(depId)) {
        // Found a cycle
        const cycleStart = path.indexOf(depId);
        return [...path.slice(cycleStart), depId];
      }
    }

    recursionStack.delete(providerId);
    return null;
  }
}
