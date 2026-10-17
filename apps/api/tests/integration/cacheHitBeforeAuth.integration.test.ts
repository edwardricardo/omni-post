/**
 * @file cacheHitBeforeAuth.integration.test.ts
 * @description Proves, over the real app, Postgres and Redis, that the HTTP response
 *              cache never hands one caller's cached response to a caller the route
 *              would refuse. A HIT skips the route's handler and the ownership check it
 *              makes, so a cache key that does not name the caller turns the route's
 *              access check into decoration; a HIT answered before the route's own hooks
 *              would do the same to its authentication. Tenant A loads its own project
 *              dashboard; tenant B (no access to the project) and an anonymous caller then
 *              send the identical query and must be refused by the route itself, never
 *              served A's body (CWE-639, CWE-306). An expired token must be refused too,
 *              although the entry its request would read is in the cache. Every route a
 *              cached rule declares public must answer a caller with no credentials, which
 *              catches an authenticating hook the boot guard cannot see. The last case
 *              proves the cache key names the caller without carrying the caller's
 *              bearer token, since the key is echoed in `X-Cache-Key` and stored as a
 *              Redis key name.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { until } from "@packages/vitest-shared/determinism";
import type { PrismaClient } from "@infra/prisma";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { createApp } from "../../src/index.js";
import { env } from "../../src/config/env.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";
import { CACHE_CONFIG, generateApiCacheKey } from "../../src/lib/cache/cacheConfig.js";
import { createRedisConnection } from "../../src/lib/redis.js";

/** How long a case waits for the fire-and-forget cache write of a MISS to land. */
const CACHE_WRITE_DEADLINE_MS = 2000;

/**
 * The key prefix the composition root gives the cache manager's Redis client
 * (`keyPrefix: "api:"` in `setupServices.ts`). A tag index `tag:<tag>` lives on the
 * wire as `api:tag:<tag>`, and holds each cache key unprefixed as a member.
 */
const CACHE_WIRE_PREFIX = "api:";

/**
 * @method expiredTokenFor
 * @description Mints a customer access token that expired a minute ago, signed with the
 *   secret, claims, issuer and audience `signCustomerAccessToken` uses, so the only reason
 *   `requireClientAuth` refuses it is its expiry.
 * @param accountId - The account the token authenticates
 * @returns The raw JWT, without the `Bearer ` scheme
 */
const expiredTokenFor = (accountId: string): string => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: `cache-auth-user-${accountId}`,
      accountId,
      roleId: "role-test",
      roleName: "OWNER",
      permissions: [],
      type: "customer",
      iat: nowSeconds - 960,
      exp: nowSeconds - 60,
    },
    env.CUSTOMER_JWT_SECRET,
    { issuer: "omnipost-customer", audience: "omnipost-customer-api" }
  );
};

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
  /** A plain connection to the cache's Redis, for the tag indexes the cache port does not expose. */
  let redis: ReturnType<typeof createRedisConnection>;

  let accountAId: string;
  let accountBId: string;
  let projectAId: string;
  let tokenA: string;
  let tokenB: string;

  /**
   * Every cache key a case caused to be written, with the tags it was indexed under:
   * `after` deletes the entry and removes the key from each tag index, which a plain
   * delete leaves behind.
   */
  const writtenKeys = new Map<string, readonly string[]>();

  /**
   * @method recordCacheWrite
   * @description Records the cache key and tags a MISS response names, so `after` can
   *   remove what the response caused to be written.
   * @param res - A response that may carry `X-Cache-Key` and `X-Cache-Tags`
   * @returns The cache key, or `undefined` when the response names none
   */
  const recordCacheWrite = (res: LightMyRequestResponse): string | undefined => {
    const key = res.headers["x-cache-key"];
    if (typeof key !== "string") {
      return undefined;
    }
    const tags = res.headers["x-cache-tags"];
    writtenKeys.set(key, typeof tags === "string" && tags !== "" ? tags.split(",") : []);
    return key;
  };

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
   * @method cacheWriteLanded
   * @description Tells whether a cache write has finished: the entry is readable and its
   *   key is a member of every tag index it names. The cache manager fills its in-process
   *   layer first and indexes the tags last, so a readable entry alone does not mean the
   *   write is done, and cleanup run before the indexing would leave the key behind.
   * @param cacheKey - The key the write stored the response under
   * @returns True once the entry and every tag membership are in place
   */
  const cacheWriteLanded = async (cacheKey: string): Promise<boolean> => {
    const cache = app.cache;
    assert.ok(cache, "the app decorates the cache port");
    if (!(await cache.has(cacheKey))) {
      return false;
    }
    for (const tag of writtenKeys.get(cacheKey) ?? []) {
      if ((await redis.sismember(`${CACHE_WIRE_PREFIX}tag:${tag}`, cacheKey)) !== 1) {
        return false;
      }
    }
    return true;
  };

  /**
   * @method awaitCacheWrite
   * @description Waits until the fire-and-forget write of a MISS has finished, and fails
   *   naming the key and the time waited when it never does.
   * @param cacheKey - The key the write stores the response under
   * @returns Nothing; resolves once the write has landed
   */
  const awaitCacheWrite = async (cacheKey: string): Promise<void> => {
    await until(() => cacheWriteLanded(cacheKey), {
      description: `the MISS to be written under ${cacheKey}`,
      timeoutMs: CACHE_WRITE_DEADLINE_MS,
      intervalMs: 20,
    });
  };

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

    const cacheKey = recordCacheWrite(res);
    assert.ok(cacheKey, "a cached response names its cache key");
    await awaitCacheWrite(cacheKey);
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
    redis = createRedisConnection();

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
        for (const key of writtenKeys.keys()) {
          await cache.delete(key);
        }
      }
      if (redis) {
        for (const [key, tags] of writtenKeys) {
          for (const tag of tags) {
            await redis.srem(`${CACHE_WIRE_PREFIX}tag:${tag}`, key);
          }
        }
      }
      await app.close();
    }
    if (redis) {
      await redis.quit();
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

  it("refuses a cached dashboard to a caller whose token has expired", async () => {
    const url = dashboardUrl();
    const owner = await loadAndAwaitCacheWrite(url, tokenA);
    const ownerData = dataJson(owner);
    assert.ok(ownerData, "the owner's dashboard carries a data payload");
    const ownerKey = owner.headers["x-cache-key"] as string;

    // The entry an expired token's request would read, planted directly: the entry the
    // owner's MISS wrote, copied as written, under the key the read hook computes for the
    // same request with the expired token. No wait on the clock decides the case.
    const route = "/analytics/dashboard";
    const rule = CACHE_CONFIG[`GET:${route}`];
    assert.ok(rule?.enabled, `the ${route} rule is cached`);
    const query = Object.fromEntries(new URL(url, "http://localhost").searchParams);
    const keyFor = (token: string): string =>
      generateApiCacheKey("GET", route, {}, query, { authorization: `Bearer ${token}` });
    assert.equal(keyFor(tokenA), ownerKey, "the test builds the key the read hook builds");

    const cache = app.cache;
    assert.ok(cache, "the app decorates the cache port");
    const ownerEntry = await cache.get<unknown>(ownerKey);
    assert.ok(ownerEntry !== null, "the owner's MISS left an entry to copy");
    const expiredToken = expiredTokenFor(accountAId);
    const plantedKey = keyFor(expiredToken);
    await cache.set(plantedKey, ownerEntry, {
      ...(rule.ttl !== undefined && { ttlSeconds: rule.ttl }),
      ...(rule.tags !== undefined && { tags: rule.tags }),
    });
    writtenKeys.set(plantedKey, rule.tags ?? []);
    assert.ok(await cache.has(plantedKey), "the planted entry is in the cache");

    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    assert.notEqual(res.headers["x-cache"], "HIT", "an expired token never gets a cache HIT");
    assert.equal(res.statusCode, 401, `the route refuses an expired token: ${res.payload}`);
    assert.ok(!res.payload.includes(ownerData), "no byte of the cached dashboard is served");
  });

  it("answers a caller with no credentials on every route a cached rule declares public", async () => {
    // The boot guard refutes `public: true` only against hooks the route itself
    // carries; an authenticating hook a plugin adds with `addHook` is invisible to it.
    // A public route answers every caller, so anything but a 2xx means the declaration
    // is false or the probe is wrong, and both must surface.
    const probeParam = "anonymous-check";
    const checked: string[] = [];
    for (const [key, rule] of Object.entries(CACHE_CONFIG)) {
      if (!key.startsWith("GET:") || rule.enabled !== true || rule.public !== true) {
        continue;
      }
      const pattern = key.slice("GET:".length);
      if (!app.hasRoute({ method: "GET", url: pattern })) {
        continue;
      }

      const substitutesParams = /:[^/]+/.test(pattern);
      const res = await app.inject({
        method: "GET",
        url: pattern.replace(/:[^/]+/g, probeParam),
      });

      const probeNote =
        substitutesParams && (res.statusCode === 400 || res.statusCode === 404)
          ? ` Its path parameters were sent as "${probeParam}", and a ${res.statusCode} may ` +
            "come from that value: give the probe a value the route accepts."
          : "";
      assert.ok(
        res.statusCode >= 200 && res.statusCode < 300,
        `${key} declares public: true, yet its route answers ${res.statusCode} to a caller ` +
          `with no credentials: ${res.payload.slice(0, 300)}. A refusal from an authenticating ` +
          "hook the boot guard cannot see means one caller's cached body would reach every " +
          "other caller it admits: drop the declaration and vary the rule by " +
          `"header:authorization".${probeNote}`
      );

      // Only a 2xx MISS is written to the cache, so only then is there a write to await.
      if (res.headers["x-cache"] === "MISS") {
        const cacheKey = recordCacheWrite(res);
        if (cacheKey !== undefined) {
          await awaitCacheWrite(cacheKey);
        }
      }
      checked.push(key);
    }

    assert.ok(
      checked.length > 0,
      "no registered route has a public cached rule: this case read nothing"
    );
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
