/**
 * Provider Coordinator Types
 *
 * Type definitions for provider coordination including load metrics, configuration,
 * routing decisions, failover strategies, and load balancing. Used by ProviderCoordinator
 * and ProviderHealthMonitor.
 *
 * @module orchestration/providerCoordinatorTypes
 */
import type { ComponentHealth } from "@shared/orchestration";
import type {
  ProviderId,
  ProviderAdapter,
  ProviderMetadata,
} from "../providers/providerAdapter.interface";

export interface LoadMetrics {
  activeRequests: number;
  requestsPerMinute: number;
  averageResponseTime: number;
  errorRate: number;
  queueDepth: number;
  resourceUtilization: number;
  capacity: number;
  throughput: number;
}

export interface ProviderConfiguration {
  priority: number;
  weight: number;
  maxConcurrentRequests: number;
  timeoutMs: number;
  retryPolicy: {
    maxAttempts: number;
    backoffMs: number;
    exponentialBackoff: boolean;
  };
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    recoveryTimeMs: number;
  };
  rateLimit: {
    requestsPerMinute: number;
    burstSize: number;
  };
}

export interface ProviderNodeExtended {
  id: ProviderId;
  adapter: ProviderAdapter;
  metadata: ProviderMetadata;
  status: "active" | "inactive" | "maintenance" | "failed";
  health: ComponentHealth;
  loadMetrics: LoadMetrics;
  configuration: ProviderConfiguration;
  lastHealthCheck: Date;
  failureCount: number;
  lastFailure?: Date;
}

export interface RoutingDecision {
  selectedProvider: ProviderId;
  reasoning: string[];
  confidence: number;
  alternativeProviders: ProviderId[];
  estimatedLatency: number;
  loadScore: number;
}

export interface FailoverStrategy {
  primaryProvider: ProviderId;
  fallbackProviders: ProviderId[];
  strategy: "immediate" | "graceful" | "manual";
  conditions: FailoverCondition[];
}

export interface FailoverCondition {
  type: "error_rate" | "response_time" | "availability" | "custom";
  threshold: number;
  timeWindowMs: number;
  operator: "gt" | "lt" | "eq";
}

export interface LoadBalancingStrategy {
  type: "round_robin" | "weighted" | "least_connections" | "response_time" | "custom";
  parameters: Record<string, unknown>;
  enabled: boolean;
}

export interface CoordinationJob {
  id: string;
  type: "publish" | "update" | "delete" | "analytics" | "health_check";
  postId: string;
  providers: import("../providers/providerAdapter.interface").ProviderId[];
  status: "pending" | "routing" | "executing" | "completed" | "failed";
  routing: RoutingDecision[];
  results: Map<
    import("../providers/providerAdapter.interface").ProviderId,
    import("@shared/orchestration").PublishResult
  >;
  startedAt: Date;
  completedAt?: Date;
  metadata: Record<string, any>;
}

/** Internal provider node used by ProviderCoordinator. */
export interface ProviderNode {
  id: import("../providers/providerAdapter.interface").ProviderId;
  adapter: ProviderAdapter;
  metadata: ProviderMetadata;
  status: "active" | "inactive" | "maintenance" | "failed";
  health: ComponentHealth;
  loadMetrics: LoadMetrics;
  configuration: ProviderConfiguration;
  lastHealthCheck: Date;
  failureCount: number;
  lastFailure?: Date;
}
