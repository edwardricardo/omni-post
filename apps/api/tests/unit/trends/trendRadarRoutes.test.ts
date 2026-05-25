/**
 * @file trendRadarRoutes.test.ts
 * @description Unit tests for the trend-radar route plugin via Fastify
 *              `inject()`. Covers: happy path returning the use case
 *              output as `{ ok, data }`, 401 when `requireClientAuth`
 *              doesn't populate `request.customerUser`, 403 when the
 *              `accountId` query param does not match the JWT account
 *              (IDOR defence), 400 on invalid limit, and 500 mapping of
 *              UseCaseError. The auth middleware is mocked at module
 *              load to inject a `customerUser`, isolating the route
 *              logic from JWT verification.
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";

const FAKE_AUTHED_ACCOUNT = "acc-authed";

vi.mock("../../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: {
    headers: Record<string, string | undefined>;
    customerUser?: { accountId: string };
  }) => {
    if (request.headers["x-test-skip-auth"] === "true") return;
    request.customerUser = { accountId: FAKE_AUTHED_ACCOUNT };
  },
}));

import Fastify, { type FastifyInstance } from "fastify";
import { ok, err } from "@shared/types";
import { Container } from "../../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import type { GetTrendRadarQuery } from "@core/application/trends/GetTrendRadarQuery.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

function makeQuery(
  result: { scored: Array<Record<string, unknown>>; total: number } | UseCaseError
): { query: GetTrendRadarQuery; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => (result instanceof UseCaseError ? err(result) : ok(result)));
  return { query: { execute } as unknown as GetTrendRadarQuery, execute };
}

async function buildApp(query: GetTrendRadarQuery): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = new Container();
  container.registerInstance(TOKENS.GetTrendRadarQuery, query);
  app.decorate("container", container);
  const { trendRadarRoutes } = await import("../../../src/trends/trendRadarRoutes.js");
  await app.register(trendRadarRoutes);
  return app;
}

describe("trendRadarRoutes — GET /trends/radar", () => {
  let app: FastifyInstance;

  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 200 with `{ok, data: { scored, total }}` on success", async () => {
    const sample = {
      scored: [
        {
          topic: "#AIArt",
          platform: "TIKTOK",
          source: "PERPLEXITY_WEB",
          sourceUrl: null,
          relevanceScore: 9,
          postIdea: null,
          bestPlatform: null,
          urgency: "TODAY",
          volume: null,
          fetchedAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
    };
    const { query, execute } = makeQuery(sample);
    app = await buildApp(query);

    const response = await app.inject({ method: "GET", url: "/trends/radar" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: typeof sample };
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(1);
    expect(body.data.scored[0]?.topic).toBe("#AIArt");
    expect(execute).toHaveBeenCalledWith({
      accountId: FAKE_AUTHED_ACCOUNT,
      limit: 20,
    });
  });

  it("returns 401 when requireClientAuth does not populate customerUser", async () => {
    const { query, execute } = makeQuery({ scored: [], total: 0 });
    app = await buildApp(query);

    const response = await app.inject({
      method: "GET",
      url: "/trends/radar",
      headers: { "x-test-skip-auth": "true" },
    });

    expect(response.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 403 when the accountId query param does not match the JWT account", async () => {
    const { query, execute } = makeQuery({ scored: [], total: 0 });
    app = await buildApp(query);

    const response = await app.inject({
      method: "GET",
      url: "/trends/radar?accountId=other-account",
    });

    expect(response.statusCode).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts a matching accountId query param", async () => {
    const { query, execute } = makeQuery({ scored: [], total: 0 });
    app = await buildApp(query);

    const response = await app.inject({
      method: "GET",
      url: `/trends/radar?accountId=${FAKE_AUTHED_ACCOUNT}`,
    });

    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalled();
  });

  it("returns 400 when limit is over the 50 ceiling", async () => {
    const { query } = makeQuery({ scored: [], total: 0 });
    app = await buildApp(query);

    const response = await app.inject({
      method: "GET",
      url: "/trends/radar?limit=9999",
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 500 when the use case fails with a UseCaseError", async () => {
    const { query } = makeQuery(
      new UseCaseError("Failed to fetch trend radar", USE_CASE_ERRORS.INTERNAL_ERROR)
    );
    app = await buildApp(query);

    const response = await app.inject({ method: "GET", url: "/trends/radar" });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Failed to fetch trend radar/);
  });

  it("forwards a custom limit within range to the use case", async () => {
    const { query, execute } = makeQuery({ scored: [], total: 0 });
    app = await buildApp(query);

    await app.inject({ method: "GET", url: "/trends/radar?limit=35" });

    expect(execute).toHaveBeenCalledWith({
      accountId: FAKE_AUTHED_ACCOUNT,
      limit: 35,
    });
  });
});
