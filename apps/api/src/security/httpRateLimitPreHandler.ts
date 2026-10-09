/**
 * @file httpRateLimitPreHandler.ts
 * @description Fastify preHandler that enforces inbound HTTP rate limiting
 *              through the technology-free `RateLimiterPort` (token bucket).
 *              Holds the per-path rule table, matches the route pattern to its
 *              rule (first `startsWith` wins, else the default), keys the bucket
 *              by client IP + resource path, and translates the port decision into
 *              `X-RateLimit-*` headers + a 429 with `Retry-After`. The port
 *              stays framework-free; this module is the Fastify adapter.
 *              Fail-open: a limiter error lets the request through.
 * @layer infrastructure
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiterPort } from "@ports/core";
import { logger } from "../lib/logger.js";
import { resolveClientIp } from "./resolveClientIp.js";

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
  // Public short-link redirect. Sized to resist shortCode enumeration: the
  // per-IP bucket is shared across ALL /r/* paths (see the namespaced
  // pre-handler below), so a scanner cannot get a fresh 100/min budget per
  // guessed code. Caps a single IP to REDIRECT.maxRequests redirect lookups
  // per window regardless of how many distinct shortCodes it probes.
  REDIRECT: { windowMs: 60_000, maxRequests: 60 },
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
 *  The credential-verification endpoints carry the strict AUTH preset
 *  (5 / 15 min) to blunt brute-force:
 *   - `/auth/login`, `/auth/refresh` — admin/backend credential endpoints.
 *   - `/auth/customer/login`, `/auth/customer/refresh` — client-portal
 *     credential endpoints (the Next client relays browser calls here). The
 *     MFA step-2 route `/auth/customer/login/mfa` is covered by the
 *     `/auth/customer/login` rule via `startsWith` prefix matching — do not
 *     add a separate (redundant) rule for it. These
 *     do NOT prefix-match `/auth/login` / `/auth/refresh` under `startsWith`,
 *     so they need their own rules or they fall through to the 100/min default
 *     and client login stays brute-forceable. The route-level
 *     `config.rateLimit` on those Fastify routes is inert (@fastify/rate-limit
 *     is never registered), so this table is the only real cap.
 *  The full-path prefixes replace the historical `/accounts$` rule, whose
 *  literal `$` never prefix-matched a real URL — so the AUTH preset was DEAD.
 *  Each prefix stays scoped to its own endpoint (no cross-shadowing). */
export const STANDARD_ROUTE_RULES: readonly HttpRateLimitRule[] = [
  { path: "/health", config: RateLimitConfigs.HEALTH },
  { path: "/publish/", config: RateLimitConfigs.STRICT },
  { path: "/media/", config: RateLimitConfigs.UPLOAD },
  { path: "/auth/login", config: RateLimitConfigs.AUTH },
  { path: "/auth/refresh", config: RateLimitConfigs.AUTH },
  { path: "/auth/customer/login", config: RateLimitConfigs.AUTH },
  { path: "/auth/customer/refresh", config: RateLimitConfigs.AUTH },
];

export interface HttpRateLimitOptions {
  readonly defaultConfig: RateLimitConfig;
  readonly rules: readonly HttpRateLimitRule[];
}

/** The rule input and key of a request no route matched. Every registered
 *  pattern begins with `/`, so it cannot collide with one, and every unmatched
 *  URL from one IP shares its bucket: a 404 is the cheapest request to vary. */
const UNROUTED = "!unrouted";

/** A route pattern's named parameter (`:id`) or its wildcard tail (`*`). */
const ROUTE_PARAM = /:(\w+)|\*/g;

/**
 * @function resourcePath
 * @description Rebuilds the path a request names from its matched route pattern
 *   and the parameter values Fastify parsed for it, so every spelling the router
 *   resolves to one resource yields one string. A parameter without a scalar
 *   value keeps its token, which widens the key to the route, never narrows it.
 * @param pattern - The matched route pattern (`req.routeOptions.url`).
 * @param params - The parsed route parameters (`req.params`).
 * @returns The pattern with each parameter replaced by its parsed value.
 */
function resourcePath(pattern: string, params: unknown): string {
  const values: Readonly<Record<string, unknown>> =
    typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
  return pattern.replace(ROUTE_PARAM, (token: string, name: string | undefined) => {
    const value = values[name ?? "*"];
    return typeof value === "string" || typeof value === "number" ? String(value) : token;
  });
}

function findConfig(
  route: string,
  rules: readonly HttpRateLimitRule[],
  defaultConfig: RateLimitConfig
): RateLimitConfig {
  for (const rule of rules) {
    if (route.startsWith(rule.path)) return rule.config;
  }
  return defaultConfig;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** The bucket one request is charged to: its key and the capacity/window it carries. */
interface RateLimitBucket {
  readonly key: string;
  readonly config: RateLimitConfig;
}

/**
 * @function createBucketPreHandler
 * @description Builds the preHandler both public factories share: it charges one
 *   permit to the bucket `bucketFor` derives, emits the `X-RateLimit-*` headers,
 *   and answers a denial with a 429 carrying `Retry-After`. The bucket is derived
 *   inside the guarded block, so an error deriving it fails open like a limiter
 *   error does.
 * @param rateLimiter - The injected token-bucket port (HTTP-scoped instance).
 * @param bucketFor - Derives the bucket a request is charged to.
 * @returns A Fastify preHandler hook.
 */
function createBucketPreHandler(
  rateLimiter: RateLimiterPort,
  bucketFor: (req: FastifyRequest) => RateLimitBucket
): PreHandler {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    try {
      const { key, config } = bucketFor(req);
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

/**
 * @function createNamespacedRateLimitPreHandler
 * @description Builds a Fastify preHandler that keys the bucket by a FIXED
 *   namespace + client IP — deliberately IGNORING the request URL. Unlike the
 *   per-path limiter (which keys by `ip:<resource path>`), this shares one bucket
 *   across every URL under the namespace, so a path whose final segment is a
 *   caller-controlled identifier (e.g. the public redirect `/r/:shortCode`)
 *   cannot be enumerated one fresh bucket per guessed value. This is the
 *   mandatory anti-enumeration control for the capability-URL redirect
 *   (canon-verified: W3C TAG names rate limiting the code namespace as the
 *   enumeration countermeasure). Fail-open, same as the per-path limiter.
 * @param rateLimiter - The injected token-bucket port (HTTP-scoped instance).
 * @param namespace - Stable bucket namespace (e.g. "redirect").
 * @param config - Capacity + window for the shared per-IP bucket.
 * @returns A Fastify preHandler hook.
 */
export function createNamespacedRateLimitPreHandler(
  rateLimiter: RateLimiterPort,
  namespace: string,
  config: RateLimitConfig
): PreHandler {
  return createBucketPreHandler(rateLimiter, (req) => ({
    key: `${namespace}:${resolveClientIp(req)}`,
    config,
  }));
}

/**
 * @function createHttpRateLimitPreHandler
 * @description Builds a Fastify preHandler bound to a `RateLimiterPort` and a
 *   rule table. Each request consumes one permit from an `ip:<resource path>`
 *   bucket whose capacity/window come from the rule its route pattern matches.
 *   Measured: a query string, fragment, percent-encoding or absolute-form target
 *   reaches one handler under many `req.url`s, so neither input reads `req.url`;
 *   the key keeps the resource because a pattern-only key put every saga's
 *   status polling (`GET /sagas/:sagaId`) in one bucket and 429'd it.
 * @param rateLimiter - The injected token-bucket port (HTTP-scoped instance).
 * @param options - Default config + ordered rule table.
 * @returns A Fastify preHandler hook.
 */
export function createHttpRateLimitPreHandler(
  rateLimiter: RateLimiterPort,
  options: HttpRateLimitOptions
): PreHandler {
  const { defaultConfig, rules } = options;
  return createBucketPreHandler(rateLimiter, (req) => {
    const pattern = req.routeOptions.url;
    const resource = pattern === undefined ? UNROUTED : resourcePath(pattern, req.params);
    return {
      key: `${resolveClientIp(req)}:${resource}`,
      config: findConfig(pattern ?? UNROUTED, rules, defaultConfig),
    };
  });
}
