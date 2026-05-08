/**
 * @file types.ts
 * @description Shared types for the health-check system — HealthStatus, HealthCheckResult,
 *              DependencyHealth, SystemHealthReport, HealthAlert, and the HealthChecker contract.
 * @layer infrastructure
 */

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  status: HealthStatus;
  latency: number;
  message?: string;
  details?: Record<string, unknown>;
  error?: string;
}

export interface DependencyHealth {
  name: string;
  type: "database" | "cache" | "queue" | "storage" | "external_api" | "circuit_breaker";
  status: HealthStatus;
  latency: number;
  message: string;
  details: Record<string, unknown>;
  lastChecked: Date;
  critical: boolean;
}

export interface SystemHealthReport {
  overall: HealthStatus;
  score: number;
  timestamp: Date;
  uptime: number;
  dependencies: DependencyHealth[];
  metrics: {
    memory: NodeJS.MemoryUsage;
    cpu: number;
    activeConnections: number;
    requestsInFlight: number;
  };
  alerts: HealthAlert[];
}

export interface HealthAlert {
  id: string;
  level: "warning" | "error" | "critical";
  message: string;
  dependency?: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface HealthCheckConfig {
  timeout: number;
  interval: number;
  retries: number;
  alertThresholds: {
    degradedLatency: number;
    unhealthyLatency: number;
    criticalFailureCount: number;
  };
}

export interface HealthChecker {
  check(): Promise<HealthCheckResult>;
}
