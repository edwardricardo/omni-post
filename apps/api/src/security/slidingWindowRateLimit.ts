import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import Redis from "ioredis";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import { logger } from "../lib/logger.js";

interface SlidingWindowConfig {
  windowMs: number;
  maxRequests: number;
  precision?: number; // Number of sub-windows (default: 10)
  skipList?: string[];
  keyGenerator?: (req: FastifyRequest) => string;
  onLimitReached?: (req: FastifyRequest, key: string) => void;
  enableGeoBlocking?: boolean;
  enableUserAgentTracking?: boolean;
  enableProgressiveBlocking?: boolean;
}

interface _WindowData {
  timestamps: number[];
  blockedUntil?: number;
  violations: number;
  firstSeen: number;
}

/**
 * Predefined rate limit configurations for common use cases
 */
export const SlidingWindowConfigs = {
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    enableProgressiveBlocking: true,
  },
  API: {
    windowMs: 60000, // 1 minute
    maxRequests: 100,
    enableProgressiveBlocking: true,
  },
  HEALTH: {
    windowMs: 60000, // 1 minute
    maxRequests: 1000,
    enableProgressiveBlocking: false,
  },
} as const;

export class SlidingWindowRateLimit {
  private redis: Redis;
  private metrics: ApiMetrics;
  private globalConfig: SlidingWindowConfig;
  private suspiciousPatterns: Map<string, number> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(redis: Redis, metrics: ApiMetrics, globalConfig: SlidingWindowConfig) {
    this.redis = redis;
    this.metrics = metrics;
    this.globalConfig = {
      precision: 10,
      enableGeoBlocking: true,
      enableUserAgentTracking: true,
      enableProgressiveBlocking: true,
      ...globalConfig,
      ...(globalConfig.skipList ? { skipList: globalConfig.skipList } : {}),
      ...(globalConfig.keyGenerator ? { keyGenerator: globalConfig.keyGenerator } : {}),
      ...(globalConfig.onLimitReached ? { onLimitReached: globalConfig.onLimitReached } : {}),
    };

    // Setup Redis error handling
    this.redis.on("error", (err) => {
      logger.error({ err }, "Redis connection error in sliding window rate limiter");
    });

    // Clean up suspicious patterns every hour
    this.cleanupTimer = setInterval(() => this.cleanupSuspiciousPatterns(), 60 * 60 * 1000);
  }

  // True sliding window algorithm using Redis sorted sets
  async checkRateLimit(req: FastifyRequest): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    windowInfo: {
      requestsInWindow: number;
      oldestRequest: number;
      newestRequest: number;
    };
  }> {
    const key = this.generateKey(req);
    const now = Date.now();
    const windowStart = now - this.globalConfig.windowMs;
    const config = this.globalConfig;

    try {
      // Check if currently blocked
      const blockKey = `${key}:block`;
      const blockedUntil = await this.redis.get(blockKey);
      if (blockedUntil && now < parseInt(blockedUntil)) {
        this.metrics.metrics.rateLimitBlocked.inc({
          type: "progressive_block",
          path: this.getRequestPath(req),
        });
        return {
          allowed: false,
          remaining: 0,
          resetTime: parseInt(blockedUntil),
          windowInfo: {
            requestsInWindow: config.maxRequests,
            oldestRequest: now,
            newestRequest: now,
          },
        };
      }

      // Use Redis pipeline for atomic operations
      const member = `${now}-${randomUUID()}`;
      const pipeline = this.redis.pipeline();

      // Remove expired entries and add current request
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, member);
      pipeline.zcount(key, windowStart, now);
      pipeline.zrange(key, 0, 0);
      pipeline.zrange(key, -1, -1);
      pipeline.expire(key, Math.ceil(config.windowMs / 1000) + 60);

      const results = await pipeline.exec();

      if (!results) {
        throw new Error("Redis pipeline failed");
      }

      const requestsInWindow = (results[2]?.[1] as number) || 0;
      const oldestRequestData = (results[3]?.[1] as string[]) || [];
      const newestRequestData = (results[4]?.[1] as string[]) || [];

      const oldestRequest =
        oldestRequestData.length > 0 ? parseInt(oldestRequestData[0]?.split("-")[0] || "0") : now;
      const newestRequest =
        newestRequestData.length > 0 ? parseInt(newestRequestData[0]?.split("-")[0] || "0") : now;

      // Enhanced suspicious activity detection
      await this.detectSuspiciousActivity(req, key, requestsInWindow, now);

      // Check if limit exceeded
      if (requestsInWindow > config.maxRequests) {
        // Remove the request we just added since it exceeds the limit
        await this.redis.zrem(key, member);

        // Apply progressive blocking if enabled
        if (config.enableProgressiveBlocking) {
          await this.applyProgressiveBlocking(key, requestsInWindow - config.maxRequests);
        }

        this.metrics.metrics.rateLimitBlocked.inc({
          type: "sliding_window_exceeded",
          path: this.getRequestPath(req),
        });

        if (config.onLimitReached) {
          config.onLimitReached(req, key);
        }

        return {
          allowed: false,
          remaining: 0,
          resetTime: oldestRequest + config.windowMs,
          windowInfo: { requestsInWindow, oldestRequest, newestRequest },
        };
      }

      // Calculate precise remaining requests
      const remaining = Math.max(0, config.maxRequests - requestsInWindow);

      this.metrics.metrics.rateLimitRequests.inc({
        status: "allowed",
        path: this.getRequestPath(req),
      });

      return {
        allowed: true,
        remaining,
        resetTime: oldestRequest + config.windowMs,
        windowInfo: { requestsInWindow, oldestRequest, newestRequest },
      };
    } catch (_error) {
      logger.error({ err: _error }, "Sliding window rate limit check failed");
      this.metrics.metrics.rateLimitErrors.inc({ error_type: "sliding_window_failure" });

      // Fail open - allow request on error
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetTime: now + config.windowMs,
        windowInfo: { requestsInWindow: 0, oldestRequest: now, newestRequest: now },
      };
    }
  }

  private generateKey(req: FastifyRequest): string {
    const ip = this.extractIP(req);
    const userAgent = req.headers["user-agent"] || "unknown";

    if (this.globalConfig.keyGenerator) {
      return this.globalConfig.keyGenerator(req);
    }

    // Enhanced key generation with multiple factors
    const factors = [`sw_rate_limit:${ip}`];

    if (this.globalConfig.enableUserAgentTracking) {
      const uaFingerprint = this.createUserAgentFingerprint(userAgent);
      factors.push(`ua:${uaFingerprint}`);
    }

    // Add user ID if authenticated (from JWT or session)
    const userId = this.extractUserId(req);
    if (userId) {
      factors.push(`user:${userId}`);
    }

    return factors.join(":");
  }

  private extractIP(req: FastifyRequest): string {
    // Enhanced IP extraction with proxy support
    const forwarded = req.headers["x-forwarded-for"] as string;
    if (forwarded) {
      const ips = forwarded.split(",").map((ip) => ip.trim());
      return ips[0] || "unknown"; // First IP is the original client
    }

    const realIP = req.headers["x-real-ip"] as string;
    if (realIP) return realIP;

    const cfConnectingIP = req.headers["cf-connecting-ip"] as string;
    if (cfConnectingIP) return cfConnectingIP; // Cloudflare

    return req.socket.remoteAddress || "unknown";
  }

  private extractUserId(req: FastifyRequest): string | null {
    // Extract user ID from JWT token or session
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        // Would need to decode JWT here - simplified for now
        return null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private createUserAgentFingerprint(userAgent: string): string {
    // Create a more sophisticated fingerprint
    const normalized = userAgent
      .toLowerCase()
      .replace(/[\d.]+/g, "X") // Replace version numbers
      .replace(/[^\w\s]/g, "") // Remove special chars
      .slice(0, 50); // Limit length

    return Buffer.from(normalized).toString("base64").slice(0, 16);
  }

  private getRequestPath(req: FastifyRequest): string {
    return req.routeOptions?.url || req.url || "unknown";
  }

  private async detectSuspiciousActivity(
    req: FastifyRequest,
    key: string,
    requestsInWindow: number,
    now: number
  ): Promise<void> {
    const suspiciousThreshold = this.globalConfig.maxRequests * 0.8; // 80% of limit

    if (requestsInWindow > suspiciousThreshold) {
      const suspiciousKey = key.split(":")[1] || "unknown"; // Extract IP/identifier
      const currentViolations = this.suspiciousPatterns.get(suspiciousKey) || 0;
      this.suspiciousPatterns.set(suspiciousKey, currentViolations + 1);

      // Log suspicious activity
      this.metrics.metrics.rateLimitRequests.inc({
        status: "suspicious",
        path: this.getRequestPath(req),
      });

      // If pattern persists, add to Redis blacklist temporarily
      if (currentViolations > 5) {
        const blacklistKey = `blacklist:${suspiciousKey}`;
        await this.redis.setex(blacklistKey, 300, now.toString()); // 5 min blacklist
      }
    }
  }

  private async applyProgressiveBlocking(key: string, _violations: number): Promise<void> {
    const blockKey = `${key}:block`;
    const violationKey = `${key}:violations`;

    // Get current violation count
    const currentViolations = await this.redis.incr(violationKey);
    await this.redis.expire(violationKey, 3600); // Reset violations after 1 hour

    // Progressive blocking durations (in milliseconds)
    const blockDurations = [
      5 * 60 * 1000, // 5 minutes
      15 * 60 * 1000, // 15 minutes
      60 * 60 * 1000, // 1 hour
      6 * 60 * 60 * 1000, // 6 hours
      24 * 60 * 60 * 1000, // 24 hours
    ];

    const durationIndex = Math.min(currentViolations - 1, blockDurations.length - 1);
    const blockDuration = blockDurations[durationIndex] || 60000; // Default 1 minute
    const blockUntil = Date.now() + blockDuration;

    await this.redis.setex(blockKey, Math.ceil(blockDuration / 1000), blockUntil.toString());
  }

  private cleanupSuspiciousPatterns(): void {
    // Clean up old entries to prevent memory leaks
    if (this.suspiciousPatterns.size > 10000) {
      this.suspiciousPatterns.clear();
    }
  }

  /**
   * Cleanup method to clear the internal timer
   * Should be called when the rate limiter is no longer needed (e.g., in tests or during shutdown)
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.suspiciousPatterns.clear();
  }

  // Fastify plugin for sliding window rate limiting
  getPlugin() {
    const self = this;
    return async function slidingWindowRateLimitPlugin(
      fastify: FastifyInstance<any, any, any, any, ZodTypeProvider>
    ) {
      fastify.addHook("preHandler", async (request, reply) => {
        try {
          // Skip rate limiting for whitelisted paths
          const requestPath = self.getRequestPath(request);
          if (self.globalConfig.skipList?.some((path) => requestPath.startsWith(path))) {
            return;
          }

          const result = await self.checkRateLimit(request);

          // Add comprehensive rate limit headers
          reply.header("X-RateLimit-Limit", self.globalConfig.maxRequests.toString());
          reply.header("X-RateLimit-Remaining", result.remaining.toString());
          reply.header("X-RateLimit-Reset", result.resetTime.toString());
          reply.header("X-RateLimit-Window", self.globalConfig.windowMs.toString());
          reply.header(
            "X-RateLimit-Requests-In-Window",
            result.windowInfo.requestsInWindow.toString()
          );

          if (!result.allowed) {
            const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
            reply.header("Retry-After", retryAfter.toString());

            reply.code(429);
            return reply.send({
              ok: false,
              error: "RATE_LIMIT_EXCEEDED",
              message: "Request rate limit exceeded. Please slow down.",
              retryAfter: new Date(result.resetTime).toISOString(),
              windowInfo: result.windowInfo,
            });
          }
        } catch (error) {
          logger.error({ err: error }, "Sliding window rate limiting plugin error");
          self.metrics.metrics.rateLimitErrors.inc({ error_type: "plugin_error" });
        }
      });
    };
  }
}
