/**
 * @file listeningRoutes.test.ts
 * @description Unit tests for the brand-listening routes. Uses a real Fastify
 *   instance with a fake DI container (returning stub query use cases) and a
 *   mocked customer-auth middleware, exercising auth, validation, and the
 *   success envelope via app.inject.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";

vi.mock("../../../src/auth/customerAuthMiddleware.js", async () => {
  const { createCustomerAuthMock } = await import("../helpers/mockAuthMiddleware.js");
  return createCustomerAuthMock();
});

const Fastify = (await import("fastify")).default;
const { listeningRoutes } = await import("../../../src/listening/listeningRoutes.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const sovDto = {
  projectId: PROJECT_ID,
  since: new Date("2026-04-01T00:00:00Z"),
  until: new Date("2026-05-01T00:00:00Z"),
  brandCount: 8,
  marketCount: 4,
  totalCount: 12,
  sov: 2,
  byProvider: [],
  bySentiment: { positive: 0, neutral: 0, negative: 0, unscored: 12 },
};

const getShareOfVoiceQuery = { execute: vi.fn().mockResolvedValue(ok(sovDto)) };
const listMentionsQuery = {
  execute: vi.fn().mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false })),
};

function fakeToken(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "cust-1",
      accountId,
      roleName: "OWNER",
      permissions: [],
      type: "customer",
    })
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

let app: import("fastify").FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  const container = {
    resolve: (token: symbol) => {
      if (token === TOKENS.GetShareOfVoiceQuery) return getShareOfVoiceQuery;
      if (token === TOKENS.ListMentionsQuery) return listMentionsQuery;
      throw new Error(`unexpected token: ${String(token)}`);
    },
  };
  app.decorate("container", container);
  await app.register(listeningRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("listeningRoutes", () => {
  it("rejects an unauthenticated share-of-voice request with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/listening/share-of-voice?projectId=${PROJECT_ID}`,
    });
    assert.strictEqual(res.statusCode, 401);
  });

  it("returns Share of Voice for an authenticated request", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/listening/share-of-voice?projectId=${PROJECT_ID}`,
      headers: { authorization: `Bearer ${fakeToken("acc-1")}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json() as { ok: boolean; data: { sov: number; brandCount: number } };
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.data.sov, 2);
    assert.strictEqual(body.data.brandCount, 8);

    expect(getShareOfVoiceQuery.execute).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-1", projectId: PROJECT_ID })
    );
  });

  it("returns 400 when projectId is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/listening/share-of-voice`,
      headers: { authorization: `Bearer ${fakeToken("acc-1")}` },
    });
    assert.strictEqual(res.statusCode, 400);
  });

  it("returns the mention feed for an authenticated request", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/listening/mentions?projectId=${PROJECT_ID}&kind=BRAND`,
      headers: { authorization: `Bearer ${fakeToken("acc-1")}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.json() as { ok: boolean; data: { items: unknown[] } };
    assert.strictEqual(body.ok, true);
    assert.deepStrictEqual(body.data.items, []);
    expect(listMentionsQuery.execute).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-1", projectId: PROJECT_ID, kind: "BRAND" })
    );
  });

  it("returns 400 for an invalid kind filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/listening/mentions?projectId=${PROJECT_ID}&kind=BOGUS`,
      headers: { authorization: `Bearer ${fakeToken("acc-1")}` },
    });
    assert.strictEqual(res.statusCode, 400);
  });
});
