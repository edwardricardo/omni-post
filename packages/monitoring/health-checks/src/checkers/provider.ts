import type { HealthChecker, HealthCheckResult } from "../types.js";

/**
 * Provider registry interface for health checking
 */
interface ProviderRegistry {
  checkAllProvidersHealth(): Promise<
    Map<
      string,
      {
        healthy: boolean;
        latency?: number;
        error?: string;
      }
    >
  >;
}

/**
 * Health checker for social media provider integrations
 *
 * Verifies that all registered provider adapters are responsive
 * and properly configured.
 */
export class ProviderHealthChecker implements HealthChecker {
  constructor(private providerRegistry: ProviderRegistry) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Check health of all registered providers
      const healthMap = await this.providerRegistry.checkAllProvidersHealth();

      const latency = Date.now() - startTime;

      // Analyze provider health results
      const providers = Array.from(healthMap.entries());
      const healthyProviders = providers.filter(([_, health]) => health.healthy);
      const unhealthyProviders = providers.filter(([_, health]) => !health.healthy);

      const totalProviders = providers.length;
      const healthyCount = healthyProviders.length;
      const unhealthyCount = unhealthyProviders.length;

      // Determine overall status
      let status: HealthCheckResult["status"] = "healthy";
      let message = `All ${totalProviders} providers are healthy`;

      if (totalProviders === 0) {
        status = "unhealthy";
        message = "No providers registered";
      } else if (unhealthyCount === totalProviders) {
        status = "unhealthy";
        message = `All ${totalProviders} providers are unhealthy`;
      } else if (unhealthyCount > 0) {
        status = "degraded";
        message = `${unhealthyCount} of ${totalProviders} providers are unhealthy`;
      }

      // Calculate average latency
      const avgLatency =
        providers.reduce((sum, [_, health]) => sum + (health.latency || 0), 0) /
        Math.max(providers.length, 1);

      return {
        status,
        latency,
        message,
        details: {
          totalProviders,
          healthyProviders: healthyCount,
          unhealthyProviders: unhealthyCount,
          averageLatency: Math.round(avgLatency),
          providers: Object.fromEntries(
            providers.map(([id, health]) => [
              id,
              {
                healthy: health.healthy,
                latency: health.latency,
                error: health.error,
              },
            ])
          ),
        },
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Provider health check failed",
        error: error.message,
        details: {
          errorType: error.constructor.name,
          responseTime: latency,
        },
      };
    }
  }
}
