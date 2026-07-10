/**
 * @file httpRateLimitPreHandler.ts
 * @description Fastify preHandler that enforces inbound HTTP rate limiting
 *              through the technology-free `RateLimiterPort` (token bucket).
 *              This is the SINGLE canonical HTTP rate-limit mechanism (see
 *              ADR-0019 + SECURITY_CANON §Rate Limiting): the legacy
 *              `@fastify/rate-limit` route-config path is dead and removed.
 *              Holds the per-path rule table, matches a request URL to its
 *              rule (first `startsWith` match wins, else the default), keys the
 *              bucket by client IP + URL, and translates the port decision into
 *              `X-RateLimit-*` headers + a 429 with `Retry-After`. The port
 *              stays framework-free; this module is the Fastify adapter.
 *              The IP used for the bucket key is derived from a TRUSTED proxy
 *              hop (env `TRUSTED_PROXY_HOP_COUNT`) so a spoofed `X-Forwarded-For`
 *              cannot evade the cap.
 *              Fail-OPEN: a limiter error lets the request through and emits a
 *              loud warning metric/log — a fail-closed limiter would be a DoS
 *              amplifier, contradicting ADR-0015's fail-open + alerting posture.
 * @layer infrastructure
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiterPort } from "@ports/core";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

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

/**
 * Sensitive authentication endpoints carrying the AUTH preset (5 req / 15 min).
 * These are listed FIRST so they win the first-`startsWith`-match. Each `path`
 * is a literal request-URL prefix — `startsWith("/auth/customer/login")` matches
 * `POST /auth/customer/login`. The longer customer paths are listed before the
 * shorter core ones, but since every entry here uses the SAME AUTH config the
 * ordering among them is moot; order only matters relative to the broader rules.
 *
 * Rationale (ADR-0019 + SECURITY_CANON §Rate Limiting): credential endpoints are
 * the highest-value brute-force/credential-stuffing surface (NIST 800-63B-4
 * §Rate Limiting, OWASP API4:2023, OWASP Auth Cheat Sheet). Customer login is
 * additionally BruteForceProtectionPort-gated (ADR-0015, account-based); this
 * HTTP IP-based cap is the defence-in-depth layer for the routes BF does not
 * cover (register / refresh / password-reset / core auth login + refresh /
 * admin-plane login + refresh).
 * `/auth/customer/register` is the public registration route; the privilege-
 * escalating admin `/auth/register` route was removed in a prior slice and is
 * intentionally NOT listed here.
 */
const AUTH_ROUTE_RULES: readonly HttpRateLimitRule[] = [
  { path: "/auth/customer/login", config: RateLimitConfigs.AUTH },
  // Customer login step 2 (MFA challenge completion). The `/auth/customer/login`
  // prefix above already covers this URL, but it is listed EXPLICITLY because
  // AUTH_ROUTE_RULES is the documented inventory of credential endpoints
  // (SECURITY_CANON §How to extend #5) — implicit prefix coverage is exactly how
  // an entry silently disappears in a refactor. The bucket key is `ip:path`, so
  // step 1 and step 2 get independent 5/15min buckets.
  { path: "/auth/customer/login/mfa", config: RateLimitConfigs.AUTH },
  { path: "/auth/customer/register", config: RateLimitConfigs.AUTH },
  { path: "/auth/customer/refresh", config: RateLimitConfigs.AUTH },
  { path: "/auth/customer/request-password-reset", config: RateLimitConfigs.AUTH },
  { path: "/auth/customer/reset-password", config: RateLimitConfigs.AUTH },
  { path: "/auth/login", config: RateLimitConfigs.AUTH },
  { path: "/auth/refresh", config: RateLimitConfigs.AUTH },
  // Admin-plane credential routes. These are LITERAL prefixes (not a broad
  // `/admin/auth`) so the AUTH cap covers only login + token refresh — the
  // highest-value admin brute-force/credential-stuffing surface — while the
  // frequently-polled authenticated reads the admin SPA drives (`/admin/auth/me`,
  // `/admin/auth/mfa/status`, `/admin/auth/sessions`) stay on STANDARD (100/min).
  // Pre-fix these fell through to STANDARD, a 20x weaker cap on admin login.
  { path: "/admin/auth/login", config: RateLimitConfigs.AUTH },
  { path: "/admin/auth/refresh", config: RateLimitConfigs.AUTH },
  // MFA enrollment verification. The rule prefix-covers the LIVE authenticated
  // `/auth/mfa/verify-setup` (a TOTP guessing surface at enrollment). The old
  // unauthenticated login-flow `/auth/mfa/verify` orphan was retired — customer
  // login MFA now runs through `/auth/customer/login/mfa` (listed above, with
  // its own per-account BruteForceProtectionPort gate).
  { path: "/auth/mfa/verify", config: RateLimitConfigs.AUTH },
];

/** Standard route rules applied before the expensive ones (first match wins).
 *  The AUTH rules above are concatenated FIRST so an auth URL never falls
 *  through to a broader rule. NOTE: account routes (`/accounts*`) are
 *  intentionally NOT listed — they resolve to the STANDARD default. The old
 *  `/accounts$` rule was dead (literal `$` never matches under prefix matching);
 *  promoting it to a real `/accounts` AUTH prefix was rejected because it caps
 *  authenticated GET reads the client SPA polls (`/accounts/:id/projects`,
 *  `/accounts/:id/usage`) at 5/15min — an availability regression. Rate-limiting
 *  account CREATION (`POST /accounts`) is tracked separately (the limiter is
 *  method-agnostic today). */
export const STANDARD_ROUTE_RULES: readonly HttpRateLimitRule[] = [
  ...AUTH_ROUTE_RULES,
  { path: "/health", config: RateLimitConfigs.HEALTH },
  { path: "/publish/", config: RateLimitConfigs.STRICT },
  { path: "/media/", config: RateLimitConfigs.UPLOAD },
];

export interface HttpRateLimitOptions {
  readonly defaultConfig: RateLimitConfig;
  readonly rules: readonly HttpRateLimitRule[];
}

/**
 * @function resolveClientIp
 * @description Derive the rate-limit key IP from a TRUSTED proxy hop instead of
 *   blindly trusting the leftmost `X-Forwarded-For` entry (which any client can
 *   spoof to evade an IP-keyed cap). `X-Forwarded-For` is built left-to-right:
 *   the original client is leftmost and each proxy APPENDS the address it saw on
 *   the right. With `trustedHops` reverse proxies in front of the app, the only
 *   non-forgeable entries are the rightmost `trustedHops` ones; the real client
 *   is the entry at index `len - trustedHops`. Entries to the left of that are
 *   attacker-controlled and ignored. Falls back to `X-Real-IP`, then the raw
 *   socket address.
 * @param forwarded - Raw `x-forwarded-for` header value(s).
 * @param realIp - Raw `x-real-ip` header value(s).
 * @param socketAddress - `req.socket.remoteAddress` (the direct peer).
 * @param trustedHops - Number of trusted reverse-proxy hops (env-configured).
 * @returns The trusted client IP, or `"unknown"` when nothing resolves.
 */
export function resolveClientIp(
  forwarded: string | string[] | undefined,
  realIp: string | string[] | undefined,
  socketAddress: string | undefined,
  trustedHops: number
): string {
  const fwdHeader = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  if (fwdHeader) {
    const chain = fwdHeader
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (chain.length > 0) {
      // Clamp: never index left of the start (a request with fewer hops than
      // configured means a direct/misconfigured caller — take the leftmost
      // trusted entry available rather than throwing).
      const index = Math.max(0, chain.length - trustedHops);
      const trusted = chain[index];
      if (trusted) return trusted;
    }
  }

  const realHeader = Array.isArray(realIp) ? realIp[0] : realIp;
  if (realHeader) return realHeader;

  return socketAddress || "unknown";
}

function clientIp(req: FastifyRequest): string {
  return resolveClientIp(
    req.headers["x-forwarded-for"],
    req.headers["x-real-ip"],
    req.socket.remoteAddress,
    env.TRUSTED_PROXY_HOP_COUNT
  );
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
      // Key + match on the PATH only (strip the query string). The query is
      // attacker-controlled on a body-driven POST, so keying on the full URL
      // would let `/auth/login?x=1`, `?x=2`, ... rotate buckets and evade the
      // AUTH cap (CWE-307 brute-force). Stripping the query keeps per-resource
      // granularity for param routes while making the cap unforgeable.
      const path = req.url.split("?")[0] ?? req.url;
      const config = findConfig(path, rules, defaultConfig);
      const key = `${clientIp(req)}:${path}`;
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
      // Fail-OPEN: a limiter/store outage must not block traffic. A fail-closed
      // limiter would turn one Redis blip into a full outage of every protected
      // route — a worse DoS surface than the protection itself (ADR-0015 §7,
      // OWASP/NIST anti-DoS canon). The trade-off is that this path is silent by
      // design, so it MUST be alertable: emit a loud, structured WARN carrying a
      // stable `threat_type` so operational alerting can fire on it. SECURITY_CANON
      // §Rate Limiting makes alerting on this signal REQUIRED.
      logger.warn(
        { err: error, threat_type: "http_rate_limit_failopen", layer: "infrastructure" },
        "HTTP rate limiter failed open — request allowed through; alert and investigate the limiter store"
      );
      return undefined;
    }
  };
}
