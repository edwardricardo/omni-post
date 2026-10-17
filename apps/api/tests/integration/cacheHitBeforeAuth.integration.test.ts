/**
 * @file cacheHitBeforeAuth.integration.test.ts
 * @description Proves, over the real app, Postgres and Redis, that the HTTP response
 *              cache never hands one caller's cached response to a caller the route
 *              would refuse. The cache answers a HIT from a global `onRequest` hook, so
 *              no route `preHandler` runs on a hit: a cache key that does not name the
 *              caller turns the route's auth gate into decoration. Tenant A loads its
 *              own project dashboard; tenant B (no access to the project) and an
 *              anonymous caller then send the identical query and must be refused by the
 *              route itself, never served A's body (CWE-639, CWE-306). The last case
 *              proves the cache key names the caller without carrying the caller's
 *              bearer token, since the key is echoed in `X-Cache-Key` and stored as a
 *              Redis key name.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { createApp } from "../../src/index.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

/** How long a case waits for the fire-and-forget cache write of a MISS to land. */
const CACHE_WRITE_DEADLINE_MS = 2000;

/**
 * @method tokenFor
 * @description Mints a customer access token bound to the given account. The dashboard
 *   route reads the caller's account from the verified token, so the token IS the
 *   caller identity the cache key has to discriminate.
 * @param accountId - The account the token authenticates
 * @returns The raw JWT, without the `Bearer ` scheme
 */
const tokenFor = (accountId: string): string =>
  signCustomerAccessToken({
    sub: `cache-auth-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  });

/**
 * @method seedPost
 * @description Seeds a DRAFT post with one content row under the given project, so the
 *   owner's dashboard carries a post count another caller's response could not.
 * @param prisma - The owner-channel seed client
 * @param projectId - The project the post belongs to
 * @returns The id of the new post
 */
const seedPost = async (prisma: PrismaClient, projectId: string): Promise<string> => {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { accountId: true },
  });
  const post = await prisma.post.create({
    data: {
      projectId,
      accountId: project.accountId,
      status: "DRAFT",
      contents: { create: { locale: "en", body: "cache-auth owner post", tags: [] } },
    },
  });
  return post.id;
};

describe("HTTP response cache versus the route auth gate (CWE-639, CWE-306)", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  let accountAId: string;
  let accountBId: string;
  let projectAId: string;
  let tokenA: string;
  let tokenB: string;

  /** Every cache key a case caused to be written, deleted again in `after`. */
  const writtenKeys = new Set<string>();

  /**
   * @method dashboardUrl
   * @description Builds a dashboard URL for tenant A's project that no other case and no
   *   earlier run shares: `metrics` is part of the rule's `varyBy`, so a fresh value per
   *   case gives each case its own cache entry and keeps the cases independent of order.
   * @returns The request URL
   */
  const dashboardUrl = (): string =>
    `/analytics/dashboard?projectId=${projectAId}&timeRange=7d&metrics=case-${randomUUID()}`;

  /**
   * @method loadAndAwaitCacheWrite
   * @description Sends an authenticated GET that must MISS and return 200, then waits until
   *   the response is in the cache: the write happens after the reply, so a case that
   *   asserted on the next request without waiting would race it.
   * @param url - The request URL
   * @param token - The bearer token of the caller
   * @returns The response of the MISS
   */
  const loadAndAwaitCacheWrite = async (
    url: string,
    token: string
  ): Promise<LightMyRequestResponse> => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200, `the owner's own request must succeed: ${res.payload}`);
    assert.equal(res.headers["x-cache"], "MISS", "the first request of a case is a MISS");

    const key = res.headers["x-cache-key"];
    assert.equal(typeof key, "string", "a cached response names its cache key");
    const cacheKey = key as string;
    writtenKeys.add(cacheKey);

    const cache = app.cache;
    assert.ok(cache, "the app decorates the cache port");
    const deadline = Date.now() + CACHE_WRITE_DEADLINE_MS;
    while (!(await cache.has(cacheKey))) {
      assert.ok(Date.now() < deadline, `the MISS was never written under ${cacheKey}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return res;
  };

  /**
   * @method dataJson
   * @description Serializes the `data` payload of a JSON response, the part of the body a
   *   leak would carry, so two responses compare byte for byte.
   * @param res - The response to read
   * @returns The JSON text of `data`, or `undefined` when the body has none
   */
  const dataJson = (res: LightMyRequestResponse): string | undefined => {
    const body = res.json() as { data?: unknown };
    return body.data === undefined ? undefined : JSON.stringify(body.data);
  };

  before(async () => {
    prisma = createSeedPrismaClient();

    const stamp = `${Date.now()}-${randomUUID()}`;
    const accountA = await prisma.account.create({
      data: { email: `cache-auth-a-${stamp}@test.com`, name: "Cache Auth Tenant A" },
    });
    const accountB = await prisma.account.create({
      data: { email: `cache-auth-b-${stamp}@test.com`, name: "Cache Auth Tenant B" },
    });
    accountAId = accountA.id;
    accountBId = accountB.id;
    tokenA = tokenFor(accountAId);
    tokenB = tokenFor(accountBId);

    const projectA = await prisma.project.create({
      data: { accountId: accountAId, name: `Cache Auth Project A ${stamp}` },
    });
    projectAId = projectA.id;
    await seedPost(prisma, projectAId);
    await seedPost(prisma, projectAId);

    app = await createApp();
    await app.ready();
  });

  after(async () => {
    if (app) {
      const cache = app.cache;
      if (cache) {
        for (const key of writtenKeys) {
          await cache.delete(key);
        }
      }
      await app.close();
    }
    if (prisma) {
      if (projectAId) {
        await prisma.postContent.deleteMany({ where: { post: { projectId: projectAId } } });
        await prisma.post.deleteMany({ where: { projectId: projectAId } });
        await prisma.project.deleteMany({ where: { id: projectAId } });
      }
      const accountIds = [accountAId, accountBId].filter((id): id is string => id !== undefined);
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
      await prisma.$disconnect();
    }
  });

  it("serves the owner's cached dashboard back to the owner, so the cache is live", async () => {
    const url = dashboardUrl();
    const first = await loadAndAwaitCacheWrite(url, tokenA);

    const second = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    assert.equal(second.statusCode, 200);
    assert.equal(second.headers["x-cache"], "HIT", "the owner's repeat request is a HIT");
    assert.equal(dataJson(second), dataJson(first), "the HIT is the owner's own body");
  });

  it("refuses another tenant the owner's cached dashboard and lets the route answer 403", async () => {
    const url = dashboardUrl();
    const owner = await loadAndAwaitCacheWrite(url, tokenA);
    const ownerData = dataJson(owner);
    assert.ok(ownerData, "the owner's dashboard carries a data payload");

    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    assert.notEqual(res.headers["x-cache"], "HIT", "another tenant must never get a cache HIT");
    assert.equal(res.statusCode, 403, `the route refuses a tenant without access: ${res.payload}`);
    assert.notEqual(dataJson(res), ownerData, "no byte of the owner's dashboard reaches tenant B");
    assert.notEqual(res.payload, owner.payload);
  });

  it("refuses an anonymous caller the owner's cached dashboard and lets the route answer 401", async () => {
    const url = dashboardUrl();
    const owner = await loadAndAwaitCacheWrite(url, tokenA);
    const ownerData = dataJson(owner);
    assert.ok(ownerData, "the owner's dashboard carries a data payload");

    const res = await app.inject({ method: "GET", url });

    assert.notEqual(res.headers["x-cache"], "HIT", "a caller with no credentials never gets a HIT");
    assert.equal(res.statusCode, 401, `the route refuses a caller with no token: ${res.payload}`);
    assert.notEqual(dataJson(res), ownerData, "no byte of the owner's dashboard reaches anyone");
    assert.notEqual(res.payload, owner.payload);
  });

  it("names the caller in the cache key without carrying the caller's bearer token", async () => {
    // The token is minted for an account this run created, so the key is this run's alone.
    const res = await loadAndAwaitCacheWrite(`/posts?projectId=${projectAId}`, tokenA);
    const key = res.headers["x-cache-key"] as string;

    for (const fragment of tokenA.split(".")) {
      assert.ok(!key.includes(fragment), `the cache key must not carry the token: ${key}`);
    }
    assert.match(key, /authorization=sha256-[0-9a-f]{32}/, "the key names the caller by digest");
  });
});
