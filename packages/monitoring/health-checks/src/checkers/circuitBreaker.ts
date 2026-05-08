/**
 * @file circuitBreaker.ts
 * @description Health checker that inspects the circuit-breaker monitor to report degraded or
 *              unhealthy status when breakers are open across registered services.
 * @layer infrastructure
 */
import type { HealthChecker, HealthCheckResult } from "../types.js";

interface CircuitBreakerMonitor {
  getAllServicesStatus(): Array<{
    service: string;
    overallHealth: "healthy" | "degraded" | "unhealthy";
    operations: Array<{
      state: "open" | "closed" | "half-open";
    }>;
  }>;
}

export class CircuitBreakerHealthChecker implements HealthChecker {
  constructor(private circuitBreakerMonitor: CircuitBreakerMonitor) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const services = this.circuitBreakerMonitor.getAllServicesStatus();
      const latency = Date.now() - startTime;

      if (services.length === 0) {
        return {
          status: "healthy",
          latency,
          message: "No circuit breakers registered",
          details: {
            servicesCount: 0,
          },
        };
      }

      // Analyze overall circuit breaker health
      let healthyCount = 0;
      let degradedCount = 0;
      let unhealthyCount = 0;
      const serviceDetails: Array<{
        name: string;
        overallHealth: "healthy" | "degraded" | "unhealthy";
        openCircuits: number;
        halfOpenCircuits: number;
        totalOperations: number;
      }> = [];

      for (const service of services) {
        serviceDetails.push({
          name: service.service,
          overallHealth: service.overallHealth,
          openCircuits: service.operations.filter((op) => op.state === "open").length,
          halfOpenCircuits: service.operations.filter((op) => op.state === "half-open").length,
          totalOperations: service.operations.length,
        });

        switch (service.overallHealth) {
          case "healthy":
            healthyCount++;
            break;
          case "degraded":
            degradedCount++;
            break;
          case "unhealthy":
            unhealthyCount++;
            break;
        }
      }

      // Determine overall status
      let status: HealthCheckResult["status"] = "healthy";
      let message = "All circuit breakers are healthy";

      if (unhealthyCount > 0) {
        status = "unhealthy";
        message = `${unhealthyCount} services have unhealthy circuit breakers`;
      } else if (degradedCount > 0) {
        status = "degraded";
        message = `${degradedCount} services have degraded circuit breakers`;
      }

      return {
        status,
        latency,
        message,
        details: {
          totalServices: services.length,
          healthyServices: healthyCount,
          degradedServices: degradedCount,
          unhealthyServices: unhealthyCount,
          services: serviceDetails,
        },
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Circuit breaker health check failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
