/**
 * @file analyticsRoutes.flags.test.ts
 * @description Pins how the customer analytics routes read their boolean query
 *              flags: GET /analytics/roi (`byChannel`) and GET
 *              /analytics/cross-platform (`includeCompetitive`). The requests go
 *              through the real route plugin and the real container; the two use
 *              cases are replaced by spies so the assertion is on the input each
 *              flag produces, which is the only place the flag is observable
 *              without the database behind those use cases.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const { CUSTOMER_PRINCIPAL } = vi.hoisted(() => ({
  CUSTOMER_PRINCIPAL: {
    id: "customer-user-analytics-flags",
    accountId: "c0000000-0000-4000-8000-0000000000b1",
    roleId: "customer-role-owner",
    roleName: "OWNER",
    permissions: ["analytics:read"] as readonly string[],
  },
}));

vi.mock("../../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: { customerUser?: unknown }) => {
    request.customerUser = { ...CUSTOMER_PRINCIPAL };
  },
}));

vi.mock("../../../src/lib/logger.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return {
    ...original,
    logger: noopLogger,
    httpLogger: noopLogger,
    dbLogger: noopLogger,
    authLogger: noopLogger,
    providerLogger: noopLogger,
    webhookLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

import { createMockPrismaModule } from "../helpers/mockPrisma.js";

const { mockPrisma } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

const Fastify = (await import("fastify")).default;
const { analyticsRoutes } = await import("../../../src/analytics/analyticsRoutes.js");
const { createRouteTestContainer } = await import("../helpers/testContainer.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");
const { prisma } = await import("@infra/prisma");
const { NoopBackgroundTaskScheduler } = await import("@observability/background-scheduler");
const { InMemoryCacheAdapter } = await import("@adapters/cache-redis");

/** A use case double that succeeds with an empty payload and records its input. */
function makeUseCaseSpy() {
  return {
    execute: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, value: {} })),
  };
}

const calculateROI = makeUseCaseSpy();
const getCrossPlatform = makeUseCaseSpy();

let app: FastifyInstance;

describe("analyticsRoutes (customer) boolean query flags", () => {
  beforeAll(async () => {
    app = Fastify({ logger: false });
    const container = createRouteTestContainer({ prisma: prisma as never });
    // Registered before the plugin resolves them: the 30-second metrics poll and
    // the Redis-backed cache adapter must not be constructed by this suite.
    container.registerInstance(TOKENS.BackgroundTaskScheduler, new NoopBackgroundTaskScheduler());
    container.registerInstance(TOKENS.CachePort, new InMemoryCacheAdapter());
    container.registerInstance(TOKENS.CalculateROIUseCase, calculateROI);
    container.registerInstance(TOKENS.GetCrossPlatformAnalyticsUseCase, getCrossPlatform);
    app.decorate("container", container);
    await app.register(analyticsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calculateROI.execute.mockClear();
    getCrossPlatform.execute.mockClear();
  });

  describe("GET /analytics/roi byChannel", () => {
    it("passes byChannel false to the use case when the flag is false", async () => {
      const res = await app.inject({ method: "GET", url: "/analytics/roi?byChannel=false" });

      expect(res.statusCode).toBe(200);
      expect(calculateROI.execute).toHaveBeenCalledWith(
        expect.objectContaining({ byChannel: false })
      );
    });

    it("passes byChannel true to the use case when the flag is true", async () => {
      const res = await app.inject({ method: "GET", url: "/analytics/roi?byChannel=true" });

      expect(res.statusCode).toBe(200);
      expect(calculateROI.execute).toHaveBeenCalledWith(
        expect.objectContaining({ byChannel: true })
      );
    });

    it("leaves byChannel out of the use case input when the flag is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/analytics/roi" });

      expect(res.statusCode).toBe(200);
      const input = calculateROI.execute.mock.calls[0]?.[0];
      expect(input).not.toHaveProperty("byChannel");
    });

    it.each(["yes", "1", "TRUE", ""])(
      "answers 400 without running the use case when byChannel is %j",
      async (value) => {
        const res = await app.inject({ method: "GET", url: `/analytics/roi?byChannel=${value}` });

        expect(res.statusCode).toBe(400);
        expect(calculateROI.execute).not.toHaveBeenCalled();
      }
    );
  });

  describe("GET /analytics/cross-platform includeCompetitive", () => {
    it("passes includeCompetitive false to the use case when the flag is false", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/analytics/cross-platform?includeCompetitive=false",
      });

      expect(res.statusCode).toBe(200);
      expect(getCrossPlatform.execute).toHaveBeenCalledWith(
        expect.objectContaining({ includeCompetitive: false })
      );
    });

    it("passes includeCompetitive true to the use case when the flag is true", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/analytics/cross-platform?includeCompetitive=true",
      });

      expect(res.statusCode).toBe(200);
      expect(getCrossPlatform.execute).toHaveBeenCalledWith(
        expect.objectContaining({ includeCompetitive: true })
      );
    });

    it("leaves includeCompetitive out of the use case input when the flag is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/analytics/cross-platform" });

      expect(res.statusCode).toBe(200);
      const input = getCrossPlatform.execute.mock.calls[0]?.[0];
      expect(input).not.toHaveProperty("includeCompetitive");
    });

    it.each(["yes", "1", "TRUE", ""])(
      "answers 400 without running the use case when includeCompetitive is %j",
      async (value) => {
        const res = await app.inject({
          method: "GET",
          url: `/analytics/cross-platform?includeCompetitive=${value}`,
        });

        expect(res.statusCode).toBe(400);
        expect(getCrossPlatform.execute).not.toHaveBeenCalled();
      }
    );
  });
});
