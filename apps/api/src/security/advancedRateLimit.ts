/**
 * @file advancedRateLimit.ts
 * @description Advanced Redis-based rate limiter with configurable rules, bucket state tracking,
 *              burst protection, and per-route rate limit configuration.
 * @layer infrastructure
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import Redis from "ioredis";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import { logger } from "../lib/logger.js";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipList?: string[];
  keyGenerator?: (req: FastifyRequest) => string;
  onLimitReached?: (req: FastifyRequest, key: string) => void;
  testMode?: boolean;
}

interface RateLimitRule {
  path: string | RegExp;
  method?: string | string[];
  config: RateLimitConfig;
}

interface BucketState {
  count: number;
  resetTime: number;
  blocked: boolean;
  blockExpiry?: number;
}

export class AdvancedRateLimit {
  private redis: Redis;
  private metrics: ApiMetrics;
  private rules: RateLimitRule[] = [];
  private globalConfig: RateLimitConfig;

  constructor(redis: Redis, metrics: ApiMetrics, globalConfig: RateLimitConfig) {
    this.redis = redis;
    this.metrics = metrics;
    this.globalConfig = globalConfig;

    // Add Redis connection error handling
    this.redis.on("error", (err) => {
      logger.error({ err }, "Redis connection error in advanced rate limiter");
    });

    this.redis.on("connect", () => {
      logger.debug("Redis connected successfully for advanced rate limiter");
    });
  }

  // Add path-specific rate limiting rules
  addRule(rule: RateLimitRule) {
    this.rules.push(rule);
  }

  // Default key generator: IP + User-Agent fingerprint for better tracking
  private defaultKeyGenerator = (req: FastifyRequest): string => {
    const ip = this.extractIP(req);
    const userAgent = req.headers["user-agent"] || "unknown";
    const fingerprint = this.createFingerprint(userAgent);
    return `rate_limit:${ip}:${fingerprint}`;
  };

  private extractIP(req: FastifyRequest): string {
    // Check for forwarded IP headers (for reverse proxies)
    const forwarded = req.headers["x-forwarded-for"] as string;
    if (forwarded) {
      const firstIP = forwarded.split(",")[0];
      return firstIP ? firstIP.trim() : req.ip || "127.0.0.1";
    }

    const realIP = req.headers["x-real-ip"] as string;
    if (realIP) return realIP;

    return req.socket.remoteAddress || "unknown";
  }

  private createFingerprint(userAgent: string): string {
    // Create a simple fingerprint from user agent
    return (
      userAgent.length.toString(36) +
      userAgent
        .slice(-10)
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase()
    );
  }

  // Find matching rule for request
  private findMatchingRule(req: FastifyRequest): RateLimitRule | null {
    // Use req.url as fallback when routeOptions.url is not available (during testing)
    const requestPath = req.routeOptions?.url || req.url || "";

    for (const rule of this.rules) {
      const pathMatches =
        typeof rule.path === "string"
          ? requestPath === rule.path || requestPath.startsWith(rule.path)
          : rule.path.test(requestPath);

      if (pathMatches) {
        if (
          !rule.method ||
          (Array.isArray(rule.method)
            ? rule.method.includes(req.method)
            : rule.method === req.method)
        ) {
          return rule;
        }
      }
    }
    return null;
  }

  // Check and update rate limit for a request
  async checkRateLimit(
    req: FastifyRequest
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const rule = this.findMatchingRule(req) || { path: "global", config: this.globalConfig };
    const config = rule.config;

    // Skip rate limiting for whitelisted paths
    const requestPath = req.routeOptions?.url || req.url || "";
    if (config.skipList?.some((path) => requestPath.startsWith(path))) {
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetTime: Date.now() + config.windowMs,
      };
    }

    const keyGenerator = config.keyGenerator || this.defaultKeyGenerator;
    const key = keyGenerator(req);
    const now = Date.now();

    // Fail-open: if Redis is not ready, allow the request immediately
    if (this.redis.status !== "ready") {
      this.metrics.metrics.rateLimitErrors.inc({ error_type: "redis_not_ready" });
      return { allowed: true, remaining: config.maxRequests, resetTime: now + config.windowMs };
    }

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      pipeline.hgetall(key);
      pipeline.expire(key, Math.ceil(config.windowMs / 1000) + 60); // Add buffer to TTL

      const results = await pipeline.exec();
      const bucketData = (results?.[0]?.[1] as Record<string, string>) || {};

      const bucket: BucketState = {
        count: parseInt(bucketData.count || "0"),
        resetTime: parseInt(bucketData.resetTime || "0"),
        blocked: bucketData.blocked === "true",
        ...(bucketData.blockExpiry ? { blockExpiry: parseInt(bucketData.blockExpiry) } : {}),
      };

      // Check if currently blocked (for suspicious behavior)
      if (bucket.blocked && bucket.blockExpiry && now < bucket.blockExpiry) {
        this.metrics.metrics.rateLimitBlocked.inc({
          type: "security_block",
          path: requestPath || "unknown",
        });
        return { allowed: false, remaining: 0, resetTime: bucket.blockExpiry };
      }

      // Reset bucket if window expired
      if (now > bucket.resetTime) {
        bucket.count = 0;
        bucket.resetTime = now + config.windowMs;
        bucket.blocked = false;
        delete bucket.blockExpiry;
      }

      // Check if limit exceeded
      if (bucket.count >= config.maxRequests) {
        // Progressive blocking: block for longer periods on repeated violations
        const blockDuration = this.calculateBlockDuration(bucket.count - config.maxRequests);
        bucket.blocked = true;
        bucket.blockExpiry = now + blockDuration;

        // Update bucket in Redis
        await this.redis.hmset(key, {
          count: bucket.count.toString(),
          resetTime: bucket.resetTime.toString(),
          blocked: "true",
          blockExpiry: bucket.blockExpiry.toString(),
        });

        this.metrics.metrics.rateLimitBlocked.inc({
          type: "limit_exceeded",
          path: requestPath || "unknown",
        });

        if (config.onLimitReached) {
          config.onLimitReached(req, key);
        }

        return { allowed: false, remaining: 0, resetTime: bucket.blockExpiry };
      }

      // Increment counter
      bucket.count++;

      // Update bucket in Redis
      await this.redis.hmset(key, {
        count: bucket.count.toString(),
        resetTime: bucket.resetTime.toString(),
        blocked: "false",
      });

      this.metrics.metrics.rateLimitRequests.inc({
        status: "allowed",
        path: requestPath || "unknown",
      });

      return {
        allowed: true,
        remaining: config.maxRequests - bucket.count,
        resetTime: bucket.resetTime,
      };
    } catch (_error: unknown) {
      logger.error({ err: _error }, "Rate limit check failed");
      // On Redis failure, allow request but log error
      this.metrics.metrics.rateLimitErrors.inc({ error_type: "redis_failure" });
      return { allowed: true, remaining: config.maxRequests, resetTime: now + config.windowMs };
    }
  }

  private calculateBlockDuration(violations: number): number {
    // Progressive blocking: 1min, 5min, 15min, 1hour, 6hour
    const baseDuration = 60 * 1000; // 1 minute
    const multipliers = [1, 5, 15, 60, 360];
    const multiplier = multipliers[Math.min(violations - 1, multipliers.length - 1)] || 1;
    return baseDuration * multiplier;
  }

  // Fastify plugin for rate limiting
  getPlugin() {
    const self = this;
    return async function rateLimitPlugin(
      fastify: FastifyInstance<any, any, any, any, ZodTypeProvider>
    ) {
      logger.debug("AdvancedRateLimit plugin registration function called");
      fastify.addHook("preHandler", async (request, reply) => {
        logger.debug({ method: request.method, url: request.url }, "Rate limiting check");
        try {
          const result = await self.checkRateLimit(request);
          logger.debug(
            { allowed: result.allowed, remaining: result.remaining, resetTime: result.resetTime },
            "Rate limit result"
          );

          // Always add rate limit headers
          reply.header("X-RateLimit-Remaining", result.remaining.toString());
          reply.header("X-RateLimit-Reset", result.resetTime.toString());

          if (!result.allowed) {
            logger.warn(
              { method: request.method, url: request.url },
              "Request blocked by rate limiting"
            );
            reply.code(429);
            return reply.send({
              ok: false,
              error: "RATE_LIMIT_EXCEEDED",
              message: "Too many requests. Please try again later.",
              retryAfter: new Date(result.resetTime).toISOString(),
            });
          }
        } catch (_error: unknown) {
          logger.error({ err: _error }, "Rate limiting plugin error");
          // On error, allow request but log the issue
          self.metrics.metrics.rateLimitErrors.inc({ error_type: "plugin_error" });
        }
      });
    };
  }
}

// Predefined rate limit configurations
export const RateLimitConfigs = {
  // Very strict for sensitive endpoints
  STRICT: { windowMs: 60_000, maxRequests: 10 }, // 10 req/min

  // Standard for regular API endpoints
  STANDARD: { windowMs: 60_000, maxRequests: 100 }, // 100 req/min

  // Lenient for public/read-only endpoints
  LENIENT: { windowMs: 60_000, maxRequests: 300 }, // 300 req/min

  // Very lenient for health checks
  HEALTH: { windowMs: 60_000, maxRequests: 600 }, // 600 req/min

  // Test configuration for health checks (lower limit for testing)
  HEALTH_TEST: { windowMs: 60_000, maxRequests: 50, testMode: true }, // 50 req/min for testing

  // Extremely strict for authentication
  AUTH: { windowMs: 900_000, maxRequests: 5 }, // 5 req/15min

  // File upload restrictions
  UPLOAD: { windowMs: 300_000, maxRequests: 20 }, // 20 req/5min
} as const;
