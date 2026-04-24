/**
 * @file redis.ts
 * @description Health checker for Redis connectivity — issues PING and reports latency, plus
 *              cache manager statistics when available.
 * @layer infrastructure
 */
import type { HealthChecker, HealthCheckResult } from "../types.js";
import type { RedisCacheManager } from "@adapters/cache-redis";
import type Redis from "ioredis";

export class RedisHealthChecker implements HealthChecker {
  constructor(private redis: Redis) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Test basic connectivity
      const pong = await this.redis.ping();
      if (pong !== "PONG") {
        throw new Error("Redis ping failed");
      }

      // Test read/write operations
      const testKey = `health_check:${Date.now()}`;
      const testValue = "health_check_value";

      await this.redis.set(testKey, testValue, "EX", 10);
      const retrievedValue = await this.redis.get(testKey);
      await this.redis.del(testKey);

      if (retrievedValue !== testValue) {
        throw new Error("Redis read/write test failed");
      }

      const latency = Date.now() - startTime;

      // Get Redis info
      const info = await this.redis.info();
      const memoryInfo = this.parseRedisInfo(info, "memory");
      const clientsInfo = this.parseRedisInfo(info, "clients");

      let status: HealthCheckResult["status"] = "healthy";
      let message = "Redis is healthy";

      // Check memory usage
      const usedMemory = parseInt(memoryInfo["used_memory"] || "0");
      const maxMemory = parseInt(memoryInfo["maxmemory"] || "0");

      if (maxMemory > 0 && usedMemory / maxMemory > 0.9) {
        status = "degraded";
        message = "Redis memory usage is high";
      }

      // Check response time
      if (latency > 1000) {
        status = "degraded";
        message = "Redis response time elevated";
      }

      return {
        status,
        latency,
        message,
        details: {
          responseTime: latency,
          usedMemory: usedMemory,
          maxMemory: maxMemory,
          memoryUsagePercent: maxMemory > 0 ? Math.round((usedMemory / maxMemory) * 100) : 0,
          connectedClients: parseInt(clientsInfo["connected_clients"] || "0"),
          version: this.parseRedisInfo(info, "server")["redis_version"] || "unknown",
        },
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Redis connection failed",
        error: error instanceof Error ? error.message : String(error),
        details: {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
        },
      };
    }
  }

  private parseRedisInfo(info: string, section: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = info.split("\r\n");
    let inSection = false;

    for (const line of lines) {
      if (line.startsWith(`# ${section.charAt(0).toUpperCase() + section.slice(1)}`)) {
        inSection = true;
        continue;
      }
      if (line.startsWith("#")) {
        inSection = false;
        continue;
      }
      if (inSection && line.includes(":")) {
        const [key, value] = line.split(":");
        if (key && value !== undefined) {
          result[key] = value;
        }
      }
    }

    return result;
  }
}

export class CacheHealthChecker implements HealthChecker {
  constructor(private cacheManager: RedisCacheManager) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Use the cache manager's built-in health check
      const healthResult = await this.cacheManager.healthCheck();

      if (!healthResult.ok) {
        return {
          status: "unhealthy",
          latency: Date.now() - startTime,
          message: "Cache health check failed",
          error: "Cache manager health check returned error",
        };
      }

      // Get cache statistics
      const statsResult = await this.cacheManager.getStats();
      const stats = statsResult.ok ? statsResult.value : null;

      const latency = Date.now() - startTime;

      return {
        status: healthResult.value.status,
        latency,
        message: `Cache is ${healthResult.value.status}`,
        details: {
          responseTime: latency,
          cacheLatency: healthResult.value.latency,
          stats: stats
            ? {
                hitRate: stats.hitRate,
                totalKeys: stats.totalKeys,
                memoryUsage: stats.memoryUsage,
              }
            : null,
        },
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      return {
        status: "unhealthy",
        latency,
        message: "Cache health check failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
