/**
 * @file resolveClientIp.parity.test.ts
 * @description Native-vs-resolver parity against a REAL Fastify instance, under
 *              the trusted-peer model (ADR-0021). Proves three things the
 *              resolver's contract depends on and which only real fastify can
 *              establish:
 *
 *              1. The `trustProxy` value this repo now passes is one fastify
 *                 5.12.1 honours, and it resolves `request.ip` to the address a
 *                 TRUSTED proxy vouched for.
 *              2. A NUMBER no longer buys anything: fastify's fix for
 *                 GHSA-3m5p-2c4r-xxw2 makes `getTrustProxyFn` return
 *                 `() => false` for a numeric `trustProxy`, so `request.ip`
 *                 degrades to the socket peer. This test pins that behaviour so
 *                 nobody "restores" hop counting and believes it works.
 *              3. The documented divergence is still real in its NEW form: when
 *                 the whole inner chain is trusted, proxy-addr returns the
 *                 LEFTMOST entry. That is correct when the ranges list only real
 *                 proxies, and it is exactly why the ranges must be narrow.
 *
 *              PREDECESSOR NOTE. This file previously locked numeric hop-count
 *              parity (`request.ip === xff[len - hops]`). That contract was not
 *              broken by this change — it was deleted upstream by the advisory
 *              fix, and 5 of its 6 assertions turn red on 5.12.1 because
 *              `request.ip` is the socket for every request. It is rewritten,
 *              not repaired.
 * @layer infrastructure
 */

import { describe, it, expect, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { resolveClientIp, normalizeIp } from "../../../src/security/resolveClientIp.js";
import {
  fastifyTrustProxyOption,
  type TrustedProxyPolicy,
} from "../../../src/security/trustedProxy.js";

const SOCKET_ONLY: TrustedProxyPolicy = { mode: "socket-only" };
const TRUSTED_RANGES: TrustedProxyPolicy = { mode: "trusted-ranges", ranges: ["10.0.0.0/8"] };

const apps: FastifyInstance[] = [];

/** Build a Fastify app whose /ip route echoes proxy-addr's `request.ip`. */
async function appWith(trustProxy: false | string[] | number): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy } as Parameters<typeof Fastify>[0]);
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

describe("native fastify honours the trustProxy value this repo passes", () => {
  it("trusted-ranges: request.ip is the address the trusted proxy vouched for", async () => {
    const app = await appWith(fastifyTrustProxyOption(TRUSTED_RANGES));
    const native = await nativeIp(app, "203.0.113.9", "10.0.0.1");
    expect(normalizeIp(native)).toBe("203.0.113.9");
  });

  it("trusted-ranges: the walk stops at the first UNTRUSTED address in the chain", async () => {
    const app = await appWith(fastifyTrustProxyOption(TRUSTED_RANGES));
    // Chain (left to right): forged, real client, inner proxy. The edge appended
    // the client's real address, so the forgery is never selected.
    const native = await nativeIp(app, "1.1.1.1, 203.0.113.9, 10.0.0.2", "10.0.0.1");
    expect(normalizeIp(native)).toBe("203.0.113.9");
  });

  it("trusted-ranges: an UNTRUSTED socket peer gets no forwarded identity at all", async () => {
    const app = await appWith(fastifyTrustProxyOption(TRUSTED_RANGES));
    const native = await nativeIp(app, "1.1.1.1", "203.0.113.9");
    expect(normalizeIp(native)).toBe("203.0.113.9");
    expect(normalizeIp(native)).not.toBe("1.1.1.1");
  });

  it("socket-only: request.ip is the socket peer regardless of the chain", async () => {
    const app = await appWith(fastifyTrustProxyOption(SOCKET_ONLY));
    const native = await nativeIp(app, "1.1.1.1, 2.2.2.2", "10.0.0.1");
    expect(normalizeIp(native)).toBe("10.0.0.1");
  });

  it("resolver and native agree on the happy path (no divergence to correct)", async () => {
    const app = await appWith(fastifyTrustProxyOption(TRUSTED_RANGES));
    const socket = "10.0.0.1";
    const native = await nativeIp(app, "203.0.113.9", socket);
    const resolved = resolveClientIp(
      { ip: native, socket: { remoteAddress: socket } },
      TRUSTED_RANGES
    );
    expect(resolved).toBe(normalizeIp(native));
    expect(resolved).toBe("203.0.113.9");
  });
});

describe("numeric trustProxy is fail-closed in fastify >= 5.12.1 (do not restore it)", () => {
  it("a numeric trustProxy resolves request.ip to the SOCKET, not xff[len - hops]", async () => {
    // getTrustProxyFn returns `() => false` for a number, so proxy-addr trusts
    // nothing and `request.ip` is the socket peer. A hop count therefore buys
    // exactly nothing while LOOKING like configuration — the trap ADR-0021
    // removed. The cast is deliberate: `number` was dropped from the public
    // trustProxy type in the same release, so this can only be expressed by
    // going around the type, which is itself the point.
    const app = await appWith(2);
    const native = await nativeIp(app, "1.1.1.1, 2.2.2.2, 3.3.3.3", "10.0.0.1");
    expect(normalizeIp(native)).toBe("10.0.0.1");
    expect(normalizeIp(native)).not.toBe("2.2.2.2");
  });

  it("a numeric trustProxy cannot be produced by the policy translation", () => {
    expect(typeof fastifyTrustProxyOption(SOCKET_ONLY)).not.toBe("number");
    expect(typeof fastifyTrustProxyOption(TRUSTED_RANGES)).not.toBe("number");
  });
});

describe("documented divergence — a fully trusted chain yields the LEFTMOST entry", () => {
  it("native returns the client-controlled leftmost entry when every inner hop is trusted", async () => {
    const app = await appWith(fastifyTrustProxyOption(TRUSTED_RANGES));
    // Every address behind the leftmost is inside 10.0.0.0/8, so the walk runs
    // off the end of the chain and returns whatever the leftmost claims.
    const native = await nativeIp(app, "1.1.1.1, 10.0.0.3, 10.0.0.2", "10.0.0.1");
    expect(normalizeIp(native)).toBe("1.1.1.1");
  });

  it("the resolver does NOT override this — the defence is narrow ranges, not a guard", async () => {
    // Stated honestly rather than papered over: this case is indistinguishable
    // per-request from the legitimate single-hop case (XFF=[client] behind a
    // trusted edge ALSO returns the leftmost entry). The only thing separating
    // them is whether the configured ranges contain anything but real proxies,
    // which is a deployment property. See SECURITY_CANON.md §Rate Limiting
    // "Range breadth is the whole security boundary".
    const app = await appWith(fastifyTrustProxyOption(TRUSTED_RANGES));
    const socket = "10.0.0.1";
    const native = await nativeIp(app, "1.1.1.1, 10.0.0.3, 10.0.0.2", socket);
    const resolved = resolveClientIp(
      { ip: native, socket: { remoteAddress: socket } },
      TRUSTED_RANGES
    );
    expect(resolved).toBe("1.1.1.1");
  });

  it("but an untrusted PEER still fails closed, whatever request.ip claims", async () => {
    // The guard that does bite: proxy-addr and the resolver both refuse to let a
    // directly-connected client speak for anyone else.
    const resolved = resolveClientIp(
      { ip: "1.1.1.1", socket: { remoteAddress: "203.0.113.9" } },
      TRUSTED_RANGES
    );
    expect(resolved).toBe("203.0.113.9");
  });
});
