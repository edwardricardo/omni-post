/**
 * @file resolveClientIp.ts
 * @description THE single canonical resolver for the client IP used as the
 *              bucket key of every IP-scoped security decision (HTTP rate limit,
 *              IP allowlist, brute-force throttle). Derives the IP under the
 *              configured trusted-proxy model, normalizes it (port strip + IPv6
 *              canonicalization) for a stable bucket key, and fails CLOSED to
 *              the socket peer — never to a client-controlled entry. No other
 *              module may read `x-forwarded-for` / `x-real-ip` for a security
 *              decision (fitness #28/#29). See SECURITY_CANON.md §Rate Limiting
 *              for the threat model and topology invariant, and ADR-0021 for why
 *              hop counting was replaced.
 *
 *              WHAT CHANGED, AND WHY THE GUARD STILL EARNS ITS KEEP. This
 *              resolver used to count trusted hops from the right of
 *              X-Forwarded-For, and its fail-closed guard corrected a real
 *              divergence: `@fastify/proxy-addr` returns the LEFTMOST
 *              (client-controlled) entry when the chain is shorter than the
 *              configured hop count. fastify 5.12.1 deleted numeric hop trust
 *              outright (`getTrustProxyFn` returns `() => false` for a number —
 *              "Hop-count-only trust cannot validate the immediate peer"), so
 *              that shape of divergence is gone with the model that produced it.
 *              Under `trusted-ranges` proxy-addr already stops at the first
 *              untrusted address, so the peer check below currently AGREES with
 *              it rather than correcting it. It is kept, and tested against an
 *              adversarial `request.ip`, precisely because an upstream change to
 *              that walk is the exact class of event that produced this rewrite:
 *              the resolver states the invariant itself instead of inheriting
 *              it.
 * @layer infrastructure
 */

// ipaddr.js is a CJS/UMD module whose exports cjs-module-lexer cannot statically
// detect, so `import * as ipaddr` yields a namespace WITHOUT `isValid`/`process`
// under Node's native ESM loader (tsx/prod) — a default import binds the whole
// module.exports and works in both the Node runtime and the Vitest transform.
import ipaddr from "ipaddr.js";
import { env } from "../config/env.js";
import {
  buildTrustedProxyPolicy,
  fastifyTrustProxyOption,
  isTrustedPeer,
  type TrustedProxyPolicy,
} from "./trustedProxy.js";

/** Sentinel returned when no valid IP can be derived from any source. */
const UNKNOWN_IP = "unknown";

/**
 * The deployment's resolved trust model, built once at module load. `env` has
 * already rejected an inconsistent pair, so this construction cannot fail; the
 * builder's own refusals are the second half of the same interlock.
 */
export const trustedProxyPolicy: TrustedProxyPolicy = buildTrustedProxyPolicy(
  env.TRUSTED_PROXY_MODE,
  env.TRUSTED_PROXY_RANGES
);

/**
 * The exact `trustProxy` value to hand Fastify for this deployment. Exported
 * from here so the trust model has ONE chokepoint: the module that consumes it
 * is the module that configures it, and the two cannot drift apart.
 */
export const FASTIFY_TRUST_PROXY: false | string[] = fastifyTrustProxyOption(trustedProxyPolicy);

/**
 * Minimal structural view of a Fastify request needed to derive the client IP.
 * A full `FastifyRequest` satisfies this shape, so production callers pass the
 * request directly; tests build a light literal without mocking all of Fastify.
 *
 * Headers are deliberately absent: under both models this resolver never parses
 * a forwarding header itself. `socket-only` ignores them, and `trusted-ranges`
 * delegates the chain walk to proxy-addr and validates the PEER instead.
 */
export interface ClientIpRequest {
  /** proxy-addr-resolved peer under `trusted-ranges`; the socket under `socket-only`. */
  readonly ip: string;
  readonly socket: { readonly remoteAddress?: string | undefined } | undefined;
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

/**
 * @function resolveClientIp
 * @description Resolve the trusted client IP for a request as a stable bucket
 *   key.
 *
 *   Under `socket-only` the socket peer is the only trustworthy source and every
 *   forwarding header is ignored — spoof-safe, at the cost of one shared bucket
 *   behind a proxy.
 *
 *   Under `trusted-ranges` the forwarded identity is believed ONLY when the
 *   IMMEDIATE PEER is itself a configured proxy; otherwise a directly-connected
 *   client could assert any identity it liked. On that path `request.ip` is
 *   proxy-addr's trusted-peer walk, normalized here. Anything unexpected — an
 *   untrusted peer, an unparseable token, an absent socket — fails CLOSED to the
 *   socket peer, never to a claimed one.
 * @param request - The (Fastify) request to derive the IP from.
 * @param policy - Trust model to apply. Defaults to the deployment's configured
 *   policy; an explicit value is for tests.
 * @returns The normalized client IP, or the socket peer, or `"unknown"`.
 */
export function resolveClientIp(
  request: ClientIpRequest,
  policy: TrustedProxyPolicy = trustedProxyPolicy
): string {
  const socket = normalizeIp(request.socket?.remoteAddress) ?? UNKNOWN_IP;

  // No trusted proxy in front: the socket peer is the only trustworthy source.
  if (policy.mode === "socket-only") return socket;

  // Fail-closed: a peer that is not one of our proxies has no standing to speak
  // for anyone else, so nothing it forwarded may be believed. `socket` is
  // UNKNOWN_IP when there is no peer at all, which is not a trusted range
  // either — so an absent socket also fails closed here.
  if (!isTrustedPeer(socket, policy.ranges)) return socket;

  return normalizeIp(request.ip) ?? socket;
}
