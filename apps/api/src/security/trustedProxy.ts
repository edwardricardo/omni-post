/**
 * @file trustedProxy.ts
 * @description The trusted-proxy trust model: which peer this app is willing to
 *              believe when it claims to be forwarding on someone else's behalf.
 *              PURE — imports `ipaddr.js` and nothing else (no env, no Fastify),
 *              so `config/env.ts` can validate against it at boot without a
 *              cycle. Two models, one interlock (ADR-0021):
 *
 *              - `socket-only`   — forwarding headers are ignored entirely; the
 *                                  bucket key is the socket peer. Always
 *                                  spoof-safe; behind a proxy every caller
 *                                  shares one bucket (availability, not bypass).
 *              - `trusted-ranges`— an IP/CIDR allowlist that `proxy-addr`
 *                                  compiles and matches against the IMMEDIATE
 *                                  PEER. This is the model fastify steers to in
 *                                  5.12.1, whose fix for GHSA-3m5p-2c4r-xxw2
 *                                  made numeric hop-count trust fail closed
 *                                  ("Hop-count-only trust cannot validate the
 *                                  immediate peer").
 *
 *              THE INTERLOCK. `trusted-ranges` is representable ONLY with at
 *              least one range: the variant's `ranges` field is a non-empty
 *              tuple type, so `{ mode: "trusted-ranges", ranges: [] }` is not a
 *              value this program can hold — it is rejected by the compiler,
 *              not by a runtime check that some later caller might skip. The
 *              boot-time refusals below exist to reject the inconsistent ENV
 *              pair at the boundary; the type is what makes the invalid state
 *              unrepresentable once past it.
 * @layer infrastructure
 */

// ipaddr.js is a CJS/UMD module whose exports cjs-module-lexer cannot statically
// detect, so a default import (not a namespace import) is required for the
// binding to carry `parse`/`parseCIDR` under Node's native ESM loader.
import ipaddr from "ipaddr.js";

/** The two selectable trust models. Mirrors the `TRUSTED_PROXY_MODE` env enum. */
export const TRUSTED_PROXY_MODES = ["socket-only", "trusted-ranges"] as const;

/** Union of the selectable trust-model names. */
export type TrustedProxyMode = (typeof TRUSTED_PROXY_MODES)[number];

/**
 * Named range presets accepted by `proxy-addr` (and therefore by fastify's
 * `trustProxy`). Kept in lockstep with `@fastify/proxy-addr`'s `IP_RANGES` so a
 * value that validates here is a value fastify can also compile.
 */
export const TRUSTED_PROXY_PRESETS = ["loopback", "linklocal", "uniquelocal"] as const;

/** Preset name -> the CIDRs `proxy-addr` expands it to (verbatim from its source). */
const PRESET_RANGES: Readonly<Record<string, readonly string[]>> = {
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  loopback: ["127.0.0.1/8", "::1/128"],
  uniquelocal: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
};

/**
 * The resolved trust model. `trusted-ranges` carries a NON-EMPTY tuple, which is
 * what makes "mode B selected but nothing configured" unrepresentable: there is
 * no way to spell that state in this type.
 */
export type TrustedProxyPolicy =
  | { readonly mode: "socket-only" }
  | { readonly mode: "trusted-ranges"; readonly ranges: readonly [string, ...string[]] };

/** Outcome of parsing the raw `TRUSTED_PROXY_RANGES` string. */
export type TrustedProxyRangesResult =
  | { readonly ok: true; readonly ranges: readonly [string, ...string[]] }
  | { readonly ok: false; readonly reason: string };

/** True when `token` is a preset name, a bare IP, or a well-formed CIDR. */
function isValidRangeToken(token: string): boolean {
  if (TRUSTED_PROXY_PRESETS.includes(token as (typeof TRUSTED_PROXY_PRESETS)[number])) {
    return true;
  }
  try {
    if (token.includes("/")) {
      ipaddr.parseCIDR(token);
      return true;
    }
    ipaddr.parse(token);
    return true;
  } catch {
    // A hostname, a typo, or an out-of-range prefix length all land here. Proxy
    // trust is by address only: a name would have to be resolved at request
    // time, and whoever controls that resolution would control who is trusted.
    return false;
  }
}

/**
 * @function parseTrustedProxyRanges
 * @description Split, trim and validate the raw comma-separated
 *   `TRUSTED_PROXY_RANGES` value. Never throws — returns a discriminated result
 *   so both the env schema (which reports every issue at once) and the policy
 *   builder (which refuses to boot) can consume it.
 * @param raw - Raw env value, or `undefined` when the variable is unset.
 * @returns `{ ok: true, ranges }` with a non-empty tuple, or `{ ok: false, reason }`.
 */
export function parseTrustedProxyRanges(raw: string | undefined): TrustedProxyRangesResult {
  if (raw === undefined) {
    return { ok: false, reason: "TRUSTED_PROXY_RANGES is not set" };
  }
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const [first, ...rest] = tokens;
  if (first === undefined) {
    return { ok: false, reason: "TRUSTED_PROXY_RANGES has no entries" };
  }

  const invalid = tokens.filter((token) => !isValidRangeToken(token));
  if (invalid.length > 0) {
    return {
      ok: false,
      reason:
        `TRUSTED_PROXY_RANGES has invalid entries: ${invalid.join(", ")}. ` +
        `Each entry must be an IP, a CIDR, or one of: ${TRUSTED_PROXY_PRESETS.join(", ")}.`,
    };
  }

  return { ok: true, ranges: [first, ...rest] };
}

/**
 * @method buildTrustedProxyPolicy
 * @description Resolve the env pair into the single policy value the rest of the
 *   app consumes. Throws on an inconsistent pair rather than picking a default:
 *   silently degrading `trusted-ranges` to `socket-only` would turn a
 *   misconfiguration into a permanent, invisible loss of per-client rate-limit
 *   buckets, and silently ignoring ranges under `socket-only` would leave an
 *   operator believing a list is consulted when it never is.
 * @param mode - Validated `TRUSTED_PROXY_MODE`.
 * @param rawRanges - Raw `TRUSTED_PROXY_RANGES`, or `undefined` when unset.
 * @returns The resolved policy; the `trusted-ranges` variant is non-empty by construction.
 */
export function buildTrustedProxyPolicy(
  mode: TrustedProxyMode,
  rawRanges: string | undefined
): TrustedProxyPolicy {
  const parsed = parseTrustedProxyRanges(rawRanges);

  if (mode === "socket-only") {
    if (parsed.ok) {
      throw new Error(
        "TRUSTED_PROXY_MODE=socket-only but TRUSTED_PROXY_RANGES is set. Under socket-only " +
          "every forwarding header is ignored, so the list would never be consulted while " +
          "reading as though it were. Set TRUSTED_PROXY_MODE=trusted-ranges to use it, or " +
          "clear TRUSTED_PROXY_RANGES."
      );
    }
    return { mode: "socket-only" };
  }

  if (!parsed.ok) {
    throw new Error(
      `TRUSTED_PROXY_MODE=trusted-ranges requires TRUSTED_PROXY_RANGES: ${parsed.reason}. ` +
        "Refusing to boot rather than falling back to socket-only, which would collapse " +
        "every caller into one shared rate-limit bucket without saying so."
    );
  }

  return { mode: "trusted-ranges", ranges: parsed.ranges };
}

/** True when `cidr` (a CIDR or bare IP of the same kind) contains `addr`. */
function matchesRange(addr: ipaddr.IPv4 | ipaddr.IPv6, cidr: string): boolean {
  try {
    if (cidr.includes("/")) {
      const parsed = ipaddr.parseCIDR(cidr);
      // `match` throws on a kind mismatch, so gate on kind first.
      return parsed[0].kind() === addr.kind() && addr.match(parsed);
    }
    const single = ipaddr.parse(cidr);
    return single.kind() === addr.kind() && single.toString() === addr.toString();
  } catch {
    return false;
  }
}

/**
 * @function isTrustedPeer
 * @description Whether `ip` is one of the proxies this deployment is willing to
 *   believe. This is the check hop-counting could not perform, and the reason
 *   fastify 5.12.1 made the numeric form fail closed.
 * @param ip - Normalized IP of the immediate peer.
 * @param ranges - Configured IP/CIDR/preset entries.
 * @returns `true` only when the address parses AND falls inside a configured range.
 */
export function isTrustedPeer(ip: string, ranges: readonly string[]): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  return ranges.some((token) => {
    const expanded = PRESET_RANGES[token] ?? [token];
    return expanded.some((cidr) => matchesRange(addr, cidr));
  });
}

/**
 * @function fastifyTrustProxyOption
 * @description Translate the policy into the exact `trustProxy` value fastify
 *   5.12.1 accepts (`boolean | string | string[] | TrustProxyFunction`).
 *
 *   Two values are deliberately unreachable from here. A NUMBER, because
 *   `getTrustProxyFn` returns `() => false` for it since 5.12.1, so a numeric
 *   option is a silent no-op that reads like configuration. And `true`, because
 *   it trusts the leftmost — client-controlled — `X-Forwarded-For` entry
 *   (ERR_ERL_PERMISSIVE_TRUST_PROXY; CWE-807/290/348).
 * @param policy - The resolved trust model.
 * @returns `false` for socket-only, or the range list for trusted-ranges.
 */
export function fastifyTrustProxyOption(policy: TrustedProxyPolicy): false | string[] {
  return policy.mode === "socket-only" ? false : [...policy.ranges];
}
