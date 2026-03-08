/**
 * Dependency Types for Provider Dependency Management
 *
 * Defines the core interfaces used by the dependency graph builder
 * and the provider dependency manager for orchestrating provider
 * execution order, status tracking, and deadlock resolution.
 *
 * @module orchestration/dependencyTypes
 */

import type {
  ConflictResolutionStrategy,
  DependencyCondition,
  PublishResult,
  RetryPolicy,
} from "@shared/orchestration";
import type { ProviderId } from "../providers/providerAdapter.interface";

export interface DependencyNode {
  providerId: ProviderId;
  dependencies: Set<ProviderId>;
  dependents: Set<ProviderId>;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  result?: PublishResult;
  retryCount: number;
  nextRetryAt?: Date;
}

export interface DependencyGraph {
  nodes: Map<ProviderId, DependencyNode>;
  executionOrder: ProviderId[];
  hasCycles: boolean;
  readyNodes: Set<ProviderId>;
}

export interface ExecutionContext {
  planId: string;
  conflictResolution: ConflictResolutionStrategy;
  globalRetryPolicy: RetryPolicy;
  timeout: number;
  startedAt: Date;
}

export interface DependencyValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Generate a unique identifier for dependency operations.
 */
export function generateDependencyId(): string {
  return `dep_${Date.now()}_${crypto.randomUUID().slice(0, 9)}`;
}

/**
 * Calculate retry delay based on retry count and policy.
 */
export function calculateRetryDelay(retryCount: number, retryPolicy: RetryPolicy): number {
  const { baseDelay, maxDelay, backoffStrategy } = retryPolicy;

  let delay: number;
  switch (backoffStrategy) {
    case "linear":
      delay = baseDelay * (retryCount + 1);
      break;
    case "exponential":
      delay = baseDelay * Math.pow(2, retryCount);
      break;
    case "fixed":
    default:
      delay = baseDelay;
      break;
  }

  return Math.min(delay, maxDelay);
}

/**
 * Evaluate a dependency condition against a publish result.
 */
export async function evaluateCondition(
  condition: DependencyCondition,
  result: PublishResult
): Promise<boolean> {
  switch (condition.type) {
    case "success":
      return result.status === "success";
    case "completion":
      return result.status !== "skipped";
    case "custom":
      return condition.customCheck ? condition.customCheck(result) : true;
    default:
      return true;
  }
}
