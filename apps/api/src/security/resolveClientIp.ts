/**
 * @file resolveClientIp.ts
 * @description THE single canonical resolver for the client IP used as the
 *              bucket key of every IP-scoped security decision (HTTP rate limit,
 *              IP allowlist, brute-force throttle). Derives the IP from a fixed
 *              number of TRUSTED proxy hops counted from the right of
 *              X-Forwarded-For (`TRUSTED_PROXY_HOP_COUNT`), normalizes it
 *              (port strip + IPv6 canonicalization) for a stable bucket key, and
 *              fails CLOSED to the socket peer — never to a client-controlled
 *              entry. No other module may read `x-forwarded-for` / `x-real-ip`
 *              for a security decision (fitness #28/#29). See SECURITY_CANON.md
 *              §Rate Limiting for the threat model and topology invariant.
 * @layer infrastructure
 */

import * as ipaddr from "ipaddr.js";
import { env } from "../config/env.js";

/** Sentinel returned when no valid IP can be derived from any source. */
const UNKNOWN_IP = "unknown";

/**
 * Minimal structural view of a Fastify request needed to derive the client IP.
 * A full `FastifyRequest` satisfies this shape, so production callers pass the
 * request directly; tests build a light literal without mocking all of Fastify.
 */
export interface ClientIpRequest {
  /** proxy-addr-resolved peer (Fastify sets this from numeric `trustProxy`). */
  readonly ip: string;
  readonly socket: { readonly remoteAddress?: string | undefined } | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
}

/** Drop an IPv6 zone identifier (`fe80::1%eth0` -> `fe80::1`). */
function stripZoneId(value: string): string {
  const pct = value.indexOf("%");
  return pct === -1 ? value : value.slice(0, pct);
}

/**
 * Strip a trailing port. Bracket-aware for `[2001:db8::1]:443`; also handles the
 * plain `1.2.3.4:5678` form emitted by Azure App Gateway and similar edges. A
 * bare IPv6 literal has >= 2 colons, so a single colon is treated as `host:port`.
 */
function stripPort(value: string): string {
  const s = value.trim();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    return end === -1 ? s : s.slice(1, end);
  }
  const firstColon = s.indexOf(":");
  if (firstColon !== -1 && firstColon === s.lastIndexOf(":")) {
    return s.slice(0, firstColon);
  }
  return s;
}

/**
 * @function normalizeIp
 * @description Canonicalize a raw IP token into one stable representation, or
 *   `undefined` when it is absent/invalid. Strips a port suffix and an IPv6 zone
 *   id, collapses `::ffff:` IPv4-mapped addresses to dotted IPv4, and lowercases
 *   / compresses IPv6. Normalization is load-bearing: without it an attacker
 *   varies the port or IPv6 spelling to mint a fresh rate-limit bucket.
 * @param raw - Raw IP token (from a header, `request.ip`, or the socket).
 * @returns The canonical IP string, or `undefined` if it is not a valid IP.
 */
export function normalizeIp(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const candidate = stripZoneId(stripPort(raw)).trim();
  if (!candidate || !ipaddr.isValid(candidate)) return undefined;
  // `process()` collapses IPv4-mapped IPv6 to IPv4; `toString()` yields the
  // canonical lowercase, fully-compressed form.
  return ipaddr.process(candidate).toString();
}

/** Join every X-Forwarded-For header instance, split, trim OWS, drop empties. */
function parseForwardedFor(header: string | string[] | undefined): string[] {
  if (header === undefined) return [];
  const joined = Array.isArray(header) ? header.join(",") : header;
  return joined
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * @function resolveClientIp
 * @description Resolve the trusted client IP for a request as a stable bucket
 *   key. On the happy path (chain at least `trustedHops` long) `request.ip` is
 *   already `xff[len - hops]` via `@fastify/proxy-addr`, so it is normalized and
 *   returned. Otherwise — `hops == 0`, an absent/short chain, or an invalid
 *   token — it fails CLOSED to the normalized socket peer. This explicitly
 *   overrides `@fastify/proxy-addr`, which returns the leftmost
 *   (client-controlled) entry when the chain is shorter than `hops`.
 * @param request - The (Fastify) request to derive the IP from.
 * @param trustedHops - Trusted reverse-proxy hop count. Defaults to the
 *   canonical `env.TRUSTED_PROXY_HOP_COUNT`; an explicit value is for tests.
 * @returns The normalized client IP, or the socket peer, or `"unknown"`.
 */
export function resolveClientIp(
  request: ClientIpRequest,
  trustedHops: number = env.TRUSTED_PROXY_HOP_COUNT
): string {
  const socket = normalizeIp(request.socket?.remoteAddress) ?? UNKNOWN_IP;

  // No trusted proxy in front: the socket peer is the only trustworthy source.
  if (trustedHops <= 0) return socket;

  // Fail-closed: when the forwarding chain is shorter than the configured
  // trusted-hop count, `request.ip` (@fastify/proxy-addr) falls back to the
  // LEFTMOST (client-controlled) entry. Never trust it — use the socket peer.
  const entries = parseForwardedFor(request.headers["x-forwarded-for"]);
  if (entries.length < trustedHops) return socket;

  // Happy path: proxy-addr already selected `xff[len - hops]` as `request.ip`.
  return normalizeIp(request.ip) ?? socket;
}
