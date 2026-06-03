/**
 * @file httpRateLimitPreHandler.ts
 * @description Fastify preHandler that enforces inbound HTTP rate limiting
 *              through the technology-free `RateLimiterPort` (token bucket).
 *              Holds the per-path rule table, matches a request URL to its
 *              rule (first `startsWith` match wins, else the default), keys the
 *              bucket by client IP + URL, and translates the port decision into
 *              `X-RateLimit-*` headers + a 429 with `Retry-After`. The port
 *              stays framework-free; this module is the Fastify adapter.
 *              Fail-open: a limiter error lets the request through.
 * @layer infrastructure
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiterPort } from "@ports/core";
import { logger } from "../lib/logger.js";

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface HttpRateLimitRule {
  readonly path: string;
  readonly config: RateLimitConfig;
  /** Documentation-only hint for the intended sub-path; NOT used for matching
   *  (matching is `startsWith(path)`), preserving the historical behaviour. */
  readonly contains?: string;
}

/** Rate limit presets per endpoint class. */
export const RateLimitConfigs = {
  STANDARD: { windowMs: 60_000, maxRequests: 100 },
  HEALTH: { windowMs: 60_000, maxRequests: 120 },
  STRICT: { windowMs: 60_000, maxRequests: 10 },
  AUTH: { windowMs: 900_000, maxRequests: 5 },
  UPLOAD: { windowMs: 300_000, maxRequests: 20 },
  CRITICAL_EXPENSIVE: { windowMs: 60_000, maxRequests: 5 },
  HEAVY_EXPENSIVE: { windowMs: 60_000, maxRequests: 10 },
  MODERATE_EXPENSIVE: { windowMs: 60_000, maxRequests: 20 },
} as const;

/**
 * Expensive endpoints needing stricter caps than STANDARD (DoS prevention).
 * `contains` is retained as provenance metadata only — matching is by `path`
 * prefix, first match wins, as the limiter has always behaved.
 */
export const EXPENSIVE_ENDPOINT_RULES: readonly HttpRateLimitRule[] = [
  { path: "/analytics/project/", config: RateLimitConfigs.CRITICAL_EXPENSIVE, contains: "/full" },
  { path: "/analytics/cross-platform", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/analytics/roi/calculate", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/analytics/engagement/predictions", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/admin/accounts/export", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/admin/audit/export", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/ml/content/optimize", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/ml/hashtag/suggestions", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
  { path: "/ml/sentiment/analyze", config: RateLimitConfigs.CRITICAL_EXPENSIVE },
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
  { path: "/analytics/project/", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/analytics/post/", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/analytics/channel/", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/admin/dashboard/metrics", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/ml/content/analyze", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/webhooks/logs", config: RateLimitConfigs.MODERATE_EXPENSIVE },
  { path: "/audit/logs/search", config: RateLimitConfigs.MODERATE_EXPENSIVE },
] as const;

/** Standard route rules applied before the expensive ones (first match wins).
 *  `/accounts$` carries a literal `$`: with prefix matching it never matches a
 *  real URL, so account routes resolve to the default — this preserves the
 *  historical wiring exactly. Changing it would alter production caps. */
export const STANDARD_ROUTE_RULES: readonly HttpRateLimitRule[] = [
  { path: "/health", config: RateLimitConfigs.HEALTH },
  { path: "/publish/", config: RateLimitConfigs.STRICT },
  { path: "/media/", config: RateLimitConfigs.UPLOAD },
  { path: "/accounts$", config: RateLimitConfigs.AUTH },
];

export interface HttpRateLimitOptions {
  readonly defaultConfig: RateLimitConfig;
  readonly rules: readonly HttpRateLimitRule[];
}

function clientIp(req: FastifyRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const fwd = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const real = req.headers["x-real-ip"];
  const realIp = Array.isArray(real) ? real[0] : real;
  return fwd?.split(",")[0]?.trim() || (realIp as string) || req.socket.remoteAddress || "unknown";
}

function findConfig(
  url: string,
  rules: readonly HttpRateLimitRule[],
  defaultConfig: RateLimitConfig
): RateLimitConfig {
  for (const rule of rules) {
    if (url.startsWith(rule.path)) return rule.config;
  }
  return defaultConfig;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/**
 * @function createHttpRateLimitPreHandler
 * @description Builds a Fastify preHandler bound to a `RateLimiterPort` and a
 *   rule table. Each request consumes one permit from a `ip:url`-keyed bucket
 *   whose capacity/window come from the matched rule.
 * @param rateLimiter - The injected token-bucket port (HTTP-scoped instance).
 * @param options - Default config + ordered rule table.
 * @returns A Fastify preHandler hook.
 */
export function createHttpRateLimitPreHandler(
  rateLimiter: RateLimiterPort,
  options: HttpRateLimitOptions
): PreHandler {
  const { defaultConfig, rules } = options;
  return async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    try {
      const config = findConfig(req.url, rules, defaultConfig);
      const key = `${clientIp(req)}:${req.url}`;
      const decision = await rateLimiter.tryConsume(key, {
        capacity: config.maxRequests,
        refillWindowMs: config.windowMs,
      });

      reply.header("X-RateLimit-Remaining", decision.remaining.toString());
      reply.header("X-RateLimit-Reset", decision.resetAtMs.toString());

      if (!decision.allowed) {
        reply.header("Retry-After", Math.ceil((decision.retryAfterMs ?? 0) / 1000).toString());
        reply.code(429);
        return reply.send({
          ok: false,
          error: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again later.",
          retryAfter: new Date(decision.resetAtMs).toISOString(),
        });
      }
      return undefined;
    } catch (error: unknown) {
      // Fail-open: a limiter outage must not block traffic.
      logger.error({ err: error }, "Rate limiting error");
      return undefined;
    }
  };
}
