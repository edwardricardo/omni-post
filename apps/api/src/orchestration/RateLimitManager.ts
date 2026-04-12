/**
 * @file RateLimitManager.ts
 * @description Manages rate limiting for provider requests with token bucket algorithm
 *              and distributed rate limiting via Redis.
 * @layer infrastructure
 */

import Redis from "ioredis";
import type { ProviderId } from "../providers/providerAdapter.interface";
import { OrchestrationResult } from "@shared/orchestration";
import { AppError } from "../lib/errors/AppError.js";

interface RateLimitConfig {
  requestsPerMinute: number;
  burstSize: number;
  enabled: boolean;
}

interface RateLimitStatus {
  allowed: boolean;
  remainingTokens: number;
  resetAt: Date;
  retryAfterMs?: number;
}

export class RateLimitManager {
  private redis: Redis;
  private configs = new Map<ProviderId, RateLimitConfig>();

  constructor(dependencies: { redis: Redis }) {
    this.redis = dependencies.redis;
  }

  /**
   * Configure rate limit for a provider
   */
  async configureRateLimit(
    providerId: ProviderId,
    config: RateLimitConfig
  ): Promise<OrchestrationResult<void>> {
    try {
      this.configs.set(providerId, config);

      // Store in Redis for distributed systems
      await this.redis.setex(
        `ratelimit:config:${providerId}`,
        86400, // 24 hours
        JSON.stringify(config)
      );

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to configure rate limit: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Check if request is allowed under rate limit
   */
  async checkRateLimit(providerId: ProviderId): Promise<OrchestrationResult<RateLimitStatus>> {
    try {
      const config = await this.getRateLimitConfig(providerId);
      if (!config.enabled) {
        return {
          ok: true,
          value: {
            allowed: true,
            remainingTokens: config.burstSize,
            resetAt: new Date(Date.now() + 60000),
          },
        };
      }

      const key = `ratelimit:tokens:${providerId}`;
      const now = Date.now();
      const windowMs = 60000; // 1 minute

      // Token bucket algorithm using Redis
      const result = await this.redis.multi().get(key).get(`${key}:lastRefill`).exec();

      if (!result) {
        throw AppError.internal("Redis transaction failed");
      }

      let tokens = config.burstSize;
      let lastRefill = now;

      if (result[0] && result[0][1]) {
        tokens = parseInt(result[0][1] as string, 10);
      }

      if (result[1] && result[1][1]) {
        lastRefill = parseInt(result[1][1] as string, 10);
      }

      // Calculate tokens to add based on time elapsed
      const elapsedMs = now - lastRefill;
      const tokensToAdd = Math.floor((elapsedMs / windowMs) * config.requestsPerMinute);

      if (tokensToAdd > 0) {
        tokens = Math.min(config.burstSize, tokens + tokensToAdd);
        lastRefill = now;
      }

      if (tokens > 0) {
        // Consume token
        tokens--;
        await this.redis
          .multi()
          .setex(key, 300, tokens.toString()) // 5 minutes TTL
          .setex(`${key}:lastRefill`, 300, lastRefill.toString())
          .exec();

        return {
          ok: true,
          value: {
            allowed: true,
            remainingTokens: tokens,
            resetAt: new Date(lastRefill + windowMs),
          },
        };
      } else {
        // Rate limit exceeded
        const resetAt = new Date(lastRefill + windowMs);
        const retryAfterMs = resetAt.getTime() - now;

        return {
          ok: true,
          value: {
            allowed: false,
            remainingTokens: 0,
            resetAt,
            retryAfterMs,
          },
        };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Rate limit check failed: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Reset rate limit for a provider
   */
  async resetRateLimit(providerId: ProviderId): Promise<OrchestrationResult<void>> {
    try {
      const key = `ratelimit:tokens:${providerId}`;
      await this.redis.del(key, `${key}:lastRefill`);

      return { ok: true, value: undefined };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to reset rate limit: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Get current rate limit status for a provider
   */
  async getRateLimitStats(providerId: ProviderId): Promise<OrchestrationResult<RateLimitStatus>> {
    try {
      const config = await this.getRateLimitConfig(providerId);
      const key = `ratelimit:tokens:${providerId}`;
      const now = Date.now();

      const result = await this.redis.multi().get(key).get(`${key}:lastRefill`).exec();

      if (!result) {
        throw AppError.internal("Redis transaction failed");
      }

      let tokens = config.burstSize;
      let lastRefill = now;

      if (result[0] && result[0][1]) {
        tokens = parseInt(result[0][1] as string, 10);
      }

      if (result[1] && result[1][1]) {
        lastRefill = parseInt(result[1][1] as string, 10);
      }

      return {
        ok: true,
        value: {
          allowed: tokens > 0,
          remainingTokens: tokens,
          resetAt: new Date(lastRefill + 60000),
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: {
          id: this.generateId(),
          type: "system",
          message: `Failed to get rate limit stats: ${errorMessage}`,
          retryable: true,
          occurredAt: new Date(),
        },
      };
    }
  }

  /**
   * Private methods
   */

  private async getRateLimitConfig(providerId: ProviderId): Promise<RateLimitConfig> {
    // Check in-memory cache first
    let config = this.configs.get(providerId);

    if (!config) {
      // Try to load from Redis
      const stored = await this.redis.get(`ratelimit:config:${providerId}`);
      if (stored) {
        config = JSON.parse(stored) as RateLimitConfig;
        this.configs.set(providerId, config);
      } else {
        // Use default config
        config = {
          requestsPerMinute: 100,
          burstSize: 20,
          enabled: true,
        };
        this.configs.set(providerId, config);
      }
    }

    return config;
  }

  private generateId(): string {
    return `ratelimit_${Date.now()}_${crypto.randomUUID().slice(0, 9)}`;
  }
}
