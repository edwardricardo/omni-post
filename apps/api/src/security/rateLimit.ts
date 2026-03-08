import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import Redis from "ioredis";
import { logger } from "../lib/logger.js";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitRule {
  path: string;
  config: RateLimitConfig;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export class RateLimit {
  private redis: Redis;
  private rules: RateLimitRule[] = [];
  private defaultConfig: RateLimitConfig;

  constructor(redis: Redis, defaultConfig: RateLimitConfig) {
    this.redis = redis;
    this.defaultConfig = defaultConfig;
  }

  addRule(path: string, config: RateLimitConfig) {
    this.rules.push({ path, config });
  }

  private findConfig(url: string): RateLimitConfig {
    // Find matching rule by checking if URL starts with rule path
    for (const rule of this.rules) {
      if (url.startsWith(rule.path)) {
        return rule.config;
      }
    }
    return this.defaultConfig;
  }

  private getClientKey(req: FastifyRequest): string {
    // Simple client identification by IP
    const ip =
      (req.headers["x-forwarded-for"] as string) ||
      (req.headers["x-real-ip"] as string) ||
      req.socket.remoteAddress ||
      "unknown";
    const clientIp = Array.isArray(ip) ? ip[0] : ip?.split(",")[0]?.trim() || "unknown";
    return `ratelimit:${clientIp}:${req.url}`;
  }

  async checkRateLimit(req: FastifyRequest): Promise<RateLimitResult> {
    const config = this.findConfig(req.url);
    const key = this.getClientKey(req);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Use Redis sorted set for sliding window
      const member = `${now}-${randomUUID()}`;
      const pipeline = this.redis.pipeline();

      // Remove old entries outside the window
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current requests in window
      pipeline.zcard(key);

      // Add current request
      pipeline.zadd(key, now, member);

      // Set expiration
      pipeline.expire(key, Math.ceil(config.windowMs / 1000) + 1);

      const results = await pipeline.exec();

      if (!results) {
        throw new Error("Redis pipeline failed");
      }

      const currentCount = (results[1]?.[1] as number) || 0;
      const resetTime = now + config.windowMs;

      if (currentCount >= config.maxRequests) {
        // Remove the request we just added since it's rejected
        await this.redis.zrem(key, member);

        return {
          allowed: false,
          remaining: 0,
          resetTime,
        };
      }

      return {
        allowed: true,
        remaining: config.maxRequests - currentCount - 1,
        resetTime,
      };
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Rate limit check failed");
      // On Redis failure, allow request
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetTime: now + config.windowMs,
      };
    }
  }
}

// Rate limit configurations for different endpoint types
export const RateLimitConfigs = {
  STANDARD: { windowMs: 60_000, maxRequests: 100 }, // 100 req/min - standard API endpoints
  HEALTH: { windowMs: 60_000, maxRequests: 120 }, // 120 req/min - health checks
  STRICT: { windowMs: 60_000, maxRequests: 10 }, // 10 req/min - strict limiting
  AUTH: { windowMs: 900_000, maxRequests: 5 }, // 5 req/15min - authentication attempts
  UPLOAD: { windowMs: 300_000, maxRequests: 20 }, // 20 req/5min - file uploads

  // Expensive endpoint configurations (SECURITY: DoS prevention)
  CRITICAL_EXPENSIVE: { windowMs: 60_000, maxRequests: 5 }, // 5 req/min - most expensive operations
  HEAVY_EXPENSIVE: { windowMs: 60_000, maxRequests: 10 }, // 10 req/min - heavy operations
  MODERATE_EXPENSIVE: { windowMs: 60_000, maxRequests: 20 }, // 20 req/min - moderate operations
} as const;

/**
 * Expensive endpoint mappings for DoS protection
 * These endpoints perform resource-intensive operations
 */
export const EXPENSIVE_ENDPOINT_RULES = [
  // CRITICAL: 5 req/min - Complex aggregations, ML inference, large exports
  { path: "/analytics/project/", config: RateLimitConfigs.CRITICAL_EXPENSIVE, contains: "/full" },
  { path: "/analytics/cross-platform", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/analytics/roi/calculate", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/analytics/engagement/predictions", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/admin/accounts/export", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/admin/audit/export", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/ml/content/optimize", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/ml/hashtag/suggestions", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/ml/sentiment/analyze", config: RateLimitConfigs.CRITICAL_EXPENSIVE },

  // HEAVY: 10 req/min - Full-text search, complex queries
  { path: "/posts/search", config: RateLimitConfigs.HEAVY_EXPENSIVE },
  { path: "/analytics/project/", config: RateLimitConfigs.HEAVY_EXPENSIVE, contains: "/reports" },
  { path: "/analytics/realtime/dashboard", config: RateLimitConfigs.HEAVY_EXPENSIVE },
  { path: "/analytics/geo/heatmap", config: RateLimitConfigs.HEAVY_EXPENSIVE },
  {
    path: "/analytics/threads/",
    config: RateLimitConfigs.HEAVY_EXPENSIVE,
    contains: "/performance",
  },
  { path: "/admin/accounts/", config: RateLimitConfigs.HEAVY_EXPENSIVE, contains: "/usage" },
  { path: "/webhooks/events/search", config: RateLimitConfigs.HEAVY_EXPENSIVE },

  // MODERATE: 20 req/min - Standard analytics
  { path: "/analytics/project/", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/analytics/post/", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/analytics/channel/", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/admin/dashboard/metrics", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/ml/content/analyze", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/webhooks/logs", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/audit/logs/search", config: RateLimitConfigs.MODERATE_EXPENSIVE },
] as const;
