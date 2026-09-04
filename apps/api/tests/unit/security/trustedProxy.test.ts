/**
 * @file trustedProxy.test.ts
 * @description Unit tests for the trusted-proxy trust model (ADR-0021). Locks
 *              the two selectable models and the INTERLOCK between them:
 *              `socket-only` ignores every forwarding header, `trusted-ranges`
 *              validates the IMMEDIATE PEER against an IP/CIDR allowlist, and
 *              the `trusted-ranges` model is unconstructible without at least
 *              one valid range (so "mode B with no ranges" has no runtime
 *              representation, not merely a rejected one).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  parseTrustedProxyRanges,
  buildTrustedProxyPolicy,
  isTrustedPeer,
  fastifyTrustProxyOption,
  TRUSTED_PROXY_PRESETS,
  type TrustedProxyPolicy,
} from "../../../src/security/trustedProxy.js";

describe("parseTrustedProxyRanges", () => {
  it("accepts a single IPv4 CIDR", () => {
    const result = parseTrustedProxyRanges("10.0.0.0/8");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ranges).toEqual(["10.0.0.0/8"]);
  });

  it("accepts a comma-separated list with OWS around each entry", () => {
    const result = parseTrustedProxyRanges(" 10.0.0.0/8 , 192.168.1.7 , fc00::/7 ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ranges).toEqual(["10.0.0.0/8", "192.168.1.7", "fc00::/7"]);
  });

  it("accepts every proxy-addr preset name", () => {
    for (const preset of TRUSTED_PROXY_PRESETS) {
      expect(parseTrustedProxyRanges(preset).ok).toBe(true);
    }
  });

  it("rejects an undefined value", () => {
    const result = parseTrustedProxyRanges(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not set/i);
  });

  it("rejects a value that is only separators or whitespace", () => {
    for (const raw of ["", "   ", ",", " , , "]) {
      const result = parseTrustedProxyRanges(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/no entries|not set/i);
    }
  });

  it("rejects a malformed CIDR and names the offending entry", () => {
    const result = parseTrustedProxyRanges("10.0.0.0/8, 10.0.0.0/99");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("10.0.0.0/99");
  });

  it("rejects a non-IP token and names it", () => {
    const result = parseTrustedProxyRanges("not-an-ip");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not-an-ip");
  });

  it("rejects a hostname — proxy trust is by address, never by name", () => {
    const result = parseTrustedProxyRanges("edge.internal");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("edge.internal");
  });
});

describe("buildTrustedProxyPolicy — the interlock", () => {
  it("builds the socket-only policy and carries no ranges", () => {
    const policy = buildTrustedProxyPolicy("socket-only", undefined);
    expect(policy.mode).toBe("socket-only");
    expect("ranges" in policy).toBe(false);
  });

  it("builds the trusted-ranges policy from a valid list", () => {
    const policy = buildTrustedProxyPolicy("trusted-ranges", "10.0.0.0/8");
    expect(policy.mode).toBe("trusted-ranges");
    if (policy.mode === "trusted-ranges") expect(policy.ranges).toEqual(["10.0.0.0/8"]);
  });

  it("REFUSES to build trusted-ranges with no ranges (cannot silently degrade to socket-only)", () => {
    expect(() => buildTrustedProxyPolicy("trusted-ranges", undefined)).toThrow(
      /TRUSTED_PROXY_RANGES/
    );
  });

  it("REFUSES to build trusted-ranges with an empty range list", () => {
    expect(() => buildTrustedProxyPolicy("trusted-ranges", "  ,  ")).toThrow(
      /TRUSTED_PROXY_RANGES/
    );
  });

  it("REFUSES to build trusted-ranges with a malformed range", () => {
    expect(() => buildTrustedProxyPolicy("trusted-ranges", "10.0.0.0/99")).toThrow(/10.0.0.0\/99/);
  });

  it("REFUSES socket-only paired with ranges — a list that is believed but never consulted", () => {
    expect(() => buildTrustedProxyPolicy("socket-only", "10.0.0.0/8")).toThrow(
      /TRUSTED_PROXY_RANGES/
    );
  });
});

describe("isTrustedPeer", () => {
  it("matches an address inside an IPv4 CIDR", () => {
    expect(isTrustedPeer("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
  });

  it("does not match an address outside every configured range", () => {
    expect(isTrustedPeer("203.0.113.9", ["10.0.0.0/8"])).toBe(false);
  });

  it("matches a bare single-address entry exactly", () => {
    expect(isTrustedPeer("192.168.1.7", ["192.168.1.7"])).toBe(true);
    expect(isTrustedPeer("192.168.1.8", ["192.168.1.7"])).toBe(false);
  });

  it("matches an address inside an IPv6 CIDR", () => {
    expect(isTrustedPeer("fc00::1", ["fc00::/7"])).toBe(true);
    expect(isTrustedPeer("2001:db8::1", ["fc00::/7"])).toBe(false);
  });

  it("never cross-matches an IPv4 address against an IPv6 range (or vice versa)", () => {
    expect(isTrustedPeer("10.1.2.3", ["fc00::/7"])).toBe(false);
    expect(isTrustedPeer("fc00::1", ["10.0.0.0/8"])).toBe(false);
  });

  it("expands the proxy-addr preset names to their documented ranges", () => {
    expect(isTrustedPeer("127.0.0.1", ["loopback"])).toBe(true);
    expect(isTrustedPeer("::1", ["loopback"])).toBe(true);
    expect(isTrustedPeer("169.254.1.1", ["linklocal"])).toBe(true);
    expect(isTrustedPeer("10.1.2.3", ["uniquelocal"])).toBe(true);
    expect(isTrustedPeer("192.168.4.5", ["uniquelocal"])).toBe(true);
    expect(isTrustedPeer("203.0.113.9", ["uniquelocal"])).toBe(false);
  });

  it("returns false for an unparseable address rather than throwing", () => {
    expect(isTrustedPeer("not-an-ip", ["10.0.0.0/8"])).toBe(false);
    expect(isTrustedPeer("", ["10.0.0.0/8"])).toBe(false);
  });

  it("returns false against an empty range list", () => {
    expect(isTrustedPeer("10.1.2.3", [])).toBe(false);
  });
});

describe("fastifyTrustProxyOption — what fastify 5.12.1 actually accepts", () => {
  it("maps socket-only to `false` (fastify then reads socket.remoteAddress)", () => {
    expect(fastifyTrustProxyOption({ mode: "socket-only" })).toBe(false);
  });

  it("maps trusted-ranges to the string[] proxy-addr compiles", () => {
    const policy: TrustedProxyPolicy = {
      mode: "trusted-ranges",
      ranges: ["10.0.0.0/8", "192.168.1.7"],
    };
    expect(fastifyTrustProxyOption(policy)).toEqual(["10.0.0.0/8", "192.168.1.7"]);
  });

  it("never returns a number — hop-count trust is fail-closed in fastify >= 5.12.1", () => {
    const socketOnly = fastifyTrustProxyOption({ mode: "socket-only" });
    const ranges = fastifyTrustProxyOption({ mode: "trusted-ranges", ranges: ["10.0.0.0/8"] });
    expect(typeof socketOnly).not.toBe("number");
    expect(typeof ranges).not.toBe("number");
  });

  it("never returns `true` — that trusts the leftmost, client-controlled entry", () => {
    expect(fastifyTrustProxyOption({ mode: "socket-only" })).not.toBe(true);
    expect(fastifyTrustProxyOption({ mode: "trusted-ranges", ranges: ["10.0.0.0/8"] })).not.toBe(
      true
    );
  });
});
