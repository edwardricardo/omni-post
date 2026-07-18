/**
 * @file resolveClientIp.parity.test.ts
 * @description Native-vs-resolver parity: proves that a real Fastify instance
 *              configured with numeric `trustProxy` produces a `request.ip` that
 *              equals the canonical `xff[len - hops]` derivation on the happy
 *              path, AND documents the ONE place `@fastify/proxy-addr` diverges
 *              (a chain SHORTER than the trusted hop count yields the leftmost,
 *              client-controlled entry). The resolver overrides that divergence
 *              by failing closed to the socket, which this test locks in.
 * @layer infrastructure
 */

import { describe, it, expect, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { resolveClientIp, normalizeIp } from "../../../src/security/resolveClientIp.js";

/** Canonical hand-rolled oracle: rightmost-minus-(hops-1), i.e. xff[len - hops]. */
function canonSelect(socket: string, xff: readonly string[], hops: number): string {
  if (hops === 0 || xff.length < hops) return socket;
  return xff[xff.length - hops] ?? socket;
}

const apps: FastifyInstance[] = [];

/** Build a Fastify app whose /ip route echoes proxy-addr's `request.ip`. */
async function appWithHops(hops: number): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy: hops });
  app.get("/ip", async (request) => ({ ip: request.ip }));
  await app.ready();
  apps.push(app);
  return app;
}

async function nativeIp(
  app: FastifyInstance,
  xff: string | undefined,
  socket: string
): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/ip",
    remoteAddress: socket,
    ...(xff !== undefined && { headers: { "x-forwarded-for": xff } }),
  });
  return (res.json() as { ip: string }).ip;
}

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
});

describe("native @fastify/proxy-addr vs canonical xff[len-hops] (happy path)", () => {
  const socket = "10.0.0.1";

  it("hops=1 selects the rightmost entry (== xff[len-1])", async () => {
    const app = await appWithHops(1);
    const native = await nativeIp(app, "1.1.1.1, 2.2.2.2", socket);
    expect(normalizeIp(native)).toBe(normalizeIp(canonSelect(socket, ["1.1.1.1", "2.2.2.2"], 1)));
    expect(normalizeIp(native)).toBe("2.2.2.2");
  });

  it("hops=2 selects xff[len-2]", async () => {
    const app = await appWithHops(2);
    const native = await nativeIp(app, "1.1.1.1, 2.2.2.2, 3.3.3.3", socket);
    expect(normalizeIp(native)).toBe(
      normalizeIp(canonSelect(socket, ["1.1.1.1", "2.2.2.2", "3.3.3.3"], 2))
    );
    expect(normalizeIp(native)).toBe("2.2.2.2");
  });

  it("hops=1 with an Azure-style IP:port entry normalizes identically", async () => {
    const app = await appWithHops(1);
    const native = await nativeIp(app, "1.1.1.1, 4.4.4.4:5678", socket);
    // proxy-addr may or may not keep the port; normalizeIp collapses both to 4.4.4.4.
    expect(normalizeIp(native)).toBe("4.4.4.4");
  });

  it("hops=1 with an IPv4-mapped IPv6 entry normalizes identically", async () => {
    const app = await appWithHops(1);
    const native = await nativeIp(app, "1.1.1.1, ::ffff:5.5.5.5", socket);
    expect(normalizeIp(native)).toBe("5.5.5.5");
  });
});

describe("documented divergence — chain shorter than hops", () => {
  const socket = "10.0.0.1";

  it("native request.ip returns the LEFTMOST entry (the spoof) when len < hops", async () => {
    const app = await appWithHops(2);
    const native = await nativeIp(app, "9.9.9.9", socket);
    // Decision point: @fastify/proxy-addr walks off the short chain and returns
    // the client-controlled leftmost entry — NOT the socket.
    expect(normalizeIp(native)).toBe("9.9.9.9");
    // The canonical oracle fails closed to the socket instead.
    expect(canonSelect(socket, ["9.9.9.9"], 2)).toBe(socket);
  });

  it("resolveClientIp OVERRIDES the native divergence and fails to the socket", async () => {
    const app = await appWithHops(2);
    const native = await nativeIp(app, "9.9.9.9", socket);
    const resolved = resolveClientIp(
      { ip: native, socket: { remoteAddress: socket }, headers: { "x-forwarded-for": "9.9.9.9" } },
      2
    );
    expect(resolved).toBe(socket);
    expect(resolved).not.toBe("9.9.9.9");
  });
});
