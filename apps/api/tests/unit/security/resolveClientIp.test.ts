/**
 * @file resolveClientIp.test.ts
 * @description Unit tests for the canonical client-IP resolver. Locks the
 *              security-critical invariants: IPv4/IPv6 normalization (port strip,
 *              mapped/case/zone), right-anchored hop-count derivation,
 *              spoof-resistance (rotating the leftmost X-Forwarded-For entry maps
 *              to the SAME bucket), and fail-closed-to-socket (absent chain,
 *              chain shorter than the trusted hop count, or an invalid token
 *              resolve to the socket peer — NEVER the client-controlled entry).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  resolveClientIp,
  normalizeIp,
  type ClientIpRequest,
} from "../../../src/security/resolveClientIp.js";

/**
 * Replicates `@fastify/proxy-addr`'s numeric-hop selection so the tests can feed
 * `request.ip` exactly as Fastify would compute it for a given socket + chain +
 * hop count. addrs = [socket, ...xffReversed]; ip = addrs[min(hops, len-1)].
 */
function proxyAddrOracle(socket: string, xff: readonly string[], hops: number): string {
  const addrs = [socket, ...[...xff].reverse()];
  const idx = Math.min(hops, addrs.length - 1);
  return addrs[idx] ?? socket;
}

function makeRequest(params: {
  socket: string;
  xff?: string | string[];
  hops: number;
}): ClientIpRequest {
  const entries =
    params.xff === undefined
      ? []
      : (Array.isArray(params.xff) ? params.xff.join(",") : params.xff)
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.length > 0);
  const headers: Record<string, string | string[] | undefined> =
    params.xff === undefined ? {} : { "x-forwarded-for": params.xff };
  return {
    ip: proxyAddrOracle(params.socket, entries, params.hops),
    socket: { remoteAddress: params.socket },
    headers,
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

describe("resolveClientIp — hop-count derivation (happy path)", () => {
  it("selects the rightmost entry when hops=1", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: "1.1.1.1, 2.2.2.2", hops: 1 });
    expect(resolveClientIp(req, 1)).toBe("2.2.2.2");
  });

  it("selects rightmost-minus-(hops-1) when hops=2", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: "1.1.1.1, 2.2.2.2", hops: 2 });
    expect(resolveClientIp(req, 2)).toBe("1.1.1.1");
  });

  it("normalizes the selected entry (port strip)", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: "1.1.1.1, 2.2.2.2:9999", hops: 1 });
    expect(resolveClientIp(req, 1)).toBe("2.2.2.2");
  });

  it("normalizes the selected entry (IPv4-mapped IPv6)", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: "1.1.1.1, ::ffff:2.2.2.2", hops: 1 });
    expect(resolveClientIp(req, 1)).toBe("2.2.2.2");
  });

  it("joins multiple x-forwarded-for header instances before counting", () => {
    const req = makeRequest({
      socket: "10.0.0.1",
      xff: ["1.1.1.1, 2.2.2.2", "3.3.3.3"],
      hops: 2,
    });
    // Combined chain: [1.1.1.1, 2.2.2.2, 3.3.3.3]; hops=2 -> index len-2 = 2.2.2.2.
    expect(resolveClientIp(req, 2)).toBe("2.2.2.2");
  });

  it("maps distinct client IPs to distinct buckets", () => {
    const a = makeRequest({ socket: "10.0.0.1", xff: "junk, 5.5.5.5", hops: 1 });
    const b = makeRequest({ socket: "10.0.0.1", xff: "junk, 6.6.6.6", hops: 1 });
    expect(resolveClientIp(a, 1)).not.toBe(resolveClientIp(b, 1));
  });
});

describe("resolveClientIp — spoof-resistance (MERGE-BLOCKING)", () => {
  it("maps a rotating leftmost X-Forwarded-For entry to the SAME bucket", () => {
    // Attacker rotates the leftmost (client-controlled) entry each request; the
    // trusted-edge rightmost entry (hops=1) is constant -> one stable bucket.
    const r1 = makeRequest({ socket: "10.0.0.1", xff: "1.1.1.1, 9.9.9.9", hops: 1 });
    const r2 = makeRequest({ socket: "10.0.0.1", xff: "2.2.2.2, 9.9.9.9", hops: 1 });
    const r3 = makeRequest({ socket: "10.0.0.1", xff: "3.3.3.3, 9.9.9.9", hops: 1 });
    const k1 = resolveClientIp(r1, 1);
    expect(k1).toBe("9.9.9.9");
    expect(resolveClientIp(r2, 1)).toBe(k1);
    expect(resolveClientIp(r3, 1)).toBe(k1);
  });

  it("does not let a longer forged chain shift the trusted-edge selection", () => {
    const honest = makeRequest({ socket: "10.0.0.1", xff: "9.9.9.9", hops: 1 });
    const forged = makeRequest({
      socket: "10.0.0.1",
      xff: "1.1.1.1, 2.2.2.2, 3.3.3.3, 9.9.9.9",
      hops: 1,
    });
    expect(resolveClientIp(forged, 1)).toBe(resolveClientIp(honest, 1));
  });
});

describe("resolveClientIp — fail-closed to socket (MERGE-BLOCKING)", () => {
  it("resolves to the socket peer when hops=0", () => {
    const req = makeRequest({ socket: "10.0.0.1", xff: "1.2.3.4, 5.6.7.8", hops: 0 });
    expect(resolveClientIp(req, 0)).toBe("10.0.0.1");
  });

  it("resolves to the socket peer when X-Forwarded-For is absent", () => {
    const req = makeRequest({ socket: "10.0.0.1", hops: 1 });
    const result = resolveClientIp(req, 1);
    expect(result).toBe("10.0.0.1");
  });

  it("resolves to the socket when the chain is shorter than hops (NOT entries[0])", () => {
    // proxy-addr alone would return the leftmost "9.9.9.9" here — the resolver
    // MUST override that and fail to the socket.
    const req = makeRequest({ socket: "10.0.0.1", xff: "9.9.9.9", hops: 2 });
    const result = resolveClientIp(req, 2);
    expect(result).toBe("10.0.0.1");
    expect(result).not.toBe("9.9.9.9");
  });

  it("resolves to the socket when the selected token is not a valid IP", () => {
    const req: ClientIpRequest = {
      ip: "not-an-ip",
      socket: { remoteAddress: "10.0.0.1" },
      headers: { "x-forwarded-for": "not-an-ip" },
    };
    expect(resolveClientIp(req, 1)).toBe("10.0.0.1");
  });

  it("normalizes the socket fallback (IPv4-mapped IPv6)", () => {
    const req = makeRequest({ socket: "::ffff:10.0.0.1", hops: 1 });
    expect(resolveClientIp(req, 1)).toBe("10.0.0.1");
  });

  it("returns 'unknown' only when neither the chain nor the socket yields an IP", () => {
    const req: ClientIpRequest = {
      ip: "garbage",
      socket: { remoteAddress: undefined },
      headers: {},
    };
    expect(resolveClientIp(req, 0)).toBe("unknown");
  });
});
