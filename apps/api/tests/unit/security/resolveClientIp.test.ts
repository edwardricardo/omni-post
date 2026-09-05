/**
 * @file resolveClientIp.test.ts
 * @description Unit tests for the canonical client-IP resolver under the
 *              trusted-peer model (ADR-0021). Locks the security-critical
 *              invariants: IPv4/IPv6 normalization (port strip, mapped/case/
 *              zone), socket-only ignoring every forwarding header, trusted-
 *              ranges keying on the address a TRUSTED proxy vouched for, and
 *              fail-closed-to-socket whenever the IMMEDIATE PEER is not itself a
 *              configured proxy — never the client-controlled entry.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  resolveClientIp,
  normalizeIp,
  type ClientIpRequest,
} from "../../../src/security/resolveClientIp.js";
import type { TrustedProxyPolicy } from "../../../src/security/trustedProxy.js";

const SOCKET_ONLY: TrustedProxyPolicy = { mode: "socket-only" };
const TRUSTED_RANGES: TrustedProxyPolicy = { mode: "trusted-ranges", ranges: ["10.0.0.0/8"] };

/**
 * Replicates `@fastify/proxy-addr`'s trusted-peer walk so tests can feed
 * `request.ip` exactly as fastify would compute it. addrs = [socket, ...xff
 * reversed]; walk left while each address is trusted; the result is the first
 * untrusted address, or the leftmost entry when the whole inner chain is
 * trusted.
 */
function proxyAddrOracle(socket: string, xff: readonly string[], trusted: (ip: string) => boolean) {
  const addrs = [socket, ...[...xff].reverse()];
  for (let i = 0; i < addrs.length - 1; i += 1) {
    const current = addrs[i];
    if (current === undefined || !trusted(current)) return current ?? socket;
  }
  return addrs[addrs.length - 1] ?? socket;
}

const inTenNet = (ip: string): boolean => ip.startsWith("10.");

function makeRequest(params: { socket: string; xff?: readonly string[] }): ClientIpRequest {
  return {
    ip: proxyAddrOracle(params.socket, params.xff ?? [], inTenNet),
    socket: { remoteAddress: params.socket },
  };
}

describe("normalizeIp", () => {
  it("returns undefined for absent input", () => {
    expect(normalizeIp(undefined)).toBeUndefined();
    expect(normalizeIp(null)).toBeUndefined();
    expect(normalizeIp("")).toBeUndefined();
  });

  it("strips a port suffix from an IPv4 address (Azure App Gateway form)", () => {
    expect(normalizeIp("1.2.3.4:5678")).toBe("1.2.3.4");
  });

  it("strips a port suffix from a bracketed IPv6 address", () => {
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
  });

  it("collapses an IPv4-mapped IPv6 address to dotted IPv4", () => {
    expect(normalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("lowercases and compresses IPv6 to a single canonical form", () => {
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
  });

  it("drops the IPv6 zone identifier", () => {
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
  });

  it("returns undefined for a non-IP token", () => {
    expect(normalizeIp("not-an-ip")).toBeUndefined();
    expect(normalizeIp("999.999.999.999")).toBeUndefined();
  });
});

describe("resolveClientIp — socket-only model", () => {
  it("returns the socket peer and ignores the forwarding chain entirely", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: ["1.2.3.4", "5.6.7.8"] });
    expect(resolveClientIp(req, SOCKET_ONLY)).toBe("10.0.0.1");
  });

  it("ignores a request.ip that disagrees with the socket", () => {
    // Under socket-only fastify sets request.ip FROM the socket, so a divergent
    // value can only come from an upstream regression. The resolver must not
    // inherit it.
    const req: ClientIpRequest = {
      ip: "203.0.113.9",
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(resolveClientIp(req, SOCKET_ONLY)).toBe("10.0.0.1");
  });

  it("normalizes the socket peer (IPv4-mapped IPv6)", () => {
    const req = makeRequest({ socket: "::ffff:10.0.0.1" });
    expect(resolveClientIp(req, SOCKET_ONLY)).toBe("10.0.0.1");
  });

  it("collapses every caller behind one proxy into a single bucket (the accepted cost)", () => {
    const a = makeRequest({ socket: "10.0.0.1", xff: ["1.1.1.1"] });
    const b = makeRequest({ socket: "10.0.0.1", xff: ["2.2.2.2"] });
    expect(resolveClientIp(a, SOCKET_ONLY)).toBe(resolveClientIp(b, SOCKET_ONLY));
  });
});

describe("resolveClientIp — trusted-ranges model", () => {
  it("returns the address the trusted proxy vouched for", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: ["203.0.113.9"] });
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("203.0.113.9");
  });

  it("keeps distinct clients in distinct buckets (the reason this model exists)", () => {
    const a = makeRequest({ socket: "10.0.0.1", xff: ["203.0.113.9"] });
    const b = makeRequest({ socket: "10.0.0.1", xff: ["198.51.100.7"] });
    expect(resolveClientIp(a, TRUSTED_RANGES)).not.toBe(resolveClientIp(b, TRUSTED_RANGES));
  });

  it("walks past a chain of trusted proxies to the first untrusted address", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: ["203.0.113.9", "10.0.0.2"] });
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("203.0.113.9");
  });

  it("normalizes the selected entry (port strip)", () => {
    const req: ClientIpRequest = {
      ip: "203.0.113.9:9999",
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("203.0.113.9");
  });

  it("normalizes the selected entry (IPv4-mapped IPv6)", () => {
    const req: ClientIpRequest = {
      ip: "::ffff:203.0.113.9",
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("203.0.113.9");
  });

  it("ignores a forged leftmost entry appended behind the trusted edge", () => {
    // The edge appends the attacker's real address on the right of whatever it
    // sent, so the walk stops at the attacker and the forgery is never selected.
    const forged = makeRequest({ socket: "10.0.0.1", xff: ["1.1.1.1", "203.0.113.9"] });
    const honest = makeRequest({ socket: "10.0.0.1", xff: ["203.0.113.9"] });
    expect(resolveClientIp(forged, TRUSTED_RANGES)).toBe("203.0.113.9");
    expect(resolveClientIp(forged, TRUSTED_RANGES)).toBe(resolveClientIp(honest, TRUSTED_RANGES));
  });

  it("maps a rotating forged leftmost entry to the SAME bucket", () => {
    const keys = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((spoof) =>
      resolveClientIp(
        makeRequest({ socket: "10.0.0.1", xff: [spoof, "203.0.113.9"] }),
        TRUSTED_RANGES
      )
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("203.0.113.9");
  });
});

describe("resolveClientIp — fail-closed to socket (MERGE-BLOCKING)", () => {
  it("ignores the forwarding chain when the IMMEDIATE PEER is not a trusted proxy", () => {
    // A direct client (untrusted socket) claiming a forwarded identity. This is
    // the check hop-counting could not perform and the reason fastify 5.12.1
    // made the numeric form fail closed.
    const req: ClientIpRequest = {
      ip: "198.51.100.7",
      socket: { remoteAddress: "203.0.113.9" },
    };
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("203.0.113.9");
    expect(resolveClientIp(req, TRUSTED_RANGES)).not.toBe("198.51.100.7");
  });

  it("does not let an untrusted peer mint fresh buckets by rotating request.ip", () => {
    const keys = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((claimed) =>
      resolveClientIp({ ip: claimed, socket: { remoteAddress: "203.0.113.9" } }, TRUSTED_RANGES)
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("203.0.113.9");
  });

  it("resolves to the socket when the selected token is not a valid IP", () => {
    const req: ClientIpRequest = {
      ip: "not-an-ip",
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("10.0.0.1");
  });

  it("resolves to the socket when there is no forwarding chain at all", () => {
    const req = makeRequest({ socket: "10.0.0.1" });
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("10.0.0.1");
  });

  it("normalizes the socket fallback (IPv4-mapped IPv6)", () => {
    const req: ClientIpRequest = {
      ip: "not-an-ip",
      socket: { remoteAddress: "::ffff:10.0.0.1" },
    };
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("10.0.0.1");
  });

  it("returns 'unknown' when neither the peer nor the chain yields an IP", () => {
    const req: ClientIpRequest = { ip: "garbage", socket: { remoteAddress: undefined } };
    expect(resolveClientIp(req, SOCKET_ONLY)).toBe("unknown");
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("unknown");
  });

  it("returns 'unknown' rather than a claimed IP when the socket is absent", () => {
    // No socket means no peer to validate, so nothing may be believed.
    const req: ClientIpRequest = { ip: "203.0.113.9", socket: undefined };
    expect(resolveClientIp(req, TRUSTED_RANGES)).toBe("unknown");
  });
});
