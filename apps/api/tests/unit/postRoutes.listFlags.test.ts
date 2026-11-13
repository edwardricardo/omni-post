/**
 * @file postRoutes.listFlags.test.ts
 * @description Pins how GET /posts reads its two boolean query flags, `hasMedia`
 *              and `includeArchived`. The request goes through the real route
 *              plugin and the real container; the project-scoped list use case is
 *              replaced by a spy so the assertion is on the input each flag
 *              produces. Both flags are read only on the project-scoped branch, so
 *              every request names a project.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const { CUSTOMER_PRINCIPAL } = vi.hoisted(() => ({
  CUSTOMER_PRINCIPAL: {
    id: "customer-user-post-flags",
    accountId: "c0000000-0000-4000-8000-0000000000c1",
    roleId: "customer-role-owner",
    roleName: "OWNER",
    permissions: ["posts:read"] as readonly string[],
  },
}));

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: { customerUser?: unknown }) => {
    request.customerUser = { ...CUSTOMER_PRINCIPAL };
  },
}));

vi.mock("../../src/auth/rbacMiddleware.js", () => ({
  requirePermission: () => async () => {},
}));

vi.mock("../../src/lib/logger.js", () => {
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
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

import { createMockPrismaModule } from "./helpers/mockPrisma.js";

const { mockPrisma } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

const Fastify = (await import("fastify")).default;
const { postRoutes } = await import("../../src/posts/postRoutes.js");
const { createRouteTestContainer } = await import("./helpers/testContainer.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");

const PROJECT_ID = "d0000000-0000-4000-8000-0000000000d1";

/** A list use case double that succeeds with an empty page and records its input. */
function makeListPostsSpy() {
  return {
    execute: vi.fn(async (_input: Record<string, unknown>) => ({
      ok: true as const,
      value: { items: [], total: 0, limit: 20 },
    })),
  };
}

const listPosts = makeListPostsSpy();

let app: FastifyInstance;

describe("postRoutes GET /posts boolean query flags", () => {
  beforeAll(async () => {
    app = Fastify({ logger: false });
    const container = createRouteTestContainer({ prisma: mockPrisma.prisma as never });
    container.registerInstance(TOKENS.ListPostsUseCase, listPosts);
    app.decorate("container", container);
    await app.register(postRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    listPosts.execute.mockClear();
  });

  describe("hasMedia", () => {
    it("passes hasMedia false to the use case when the flag is false", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/posts?projectId=${PROJECT_ID}&hasMedia=false`,
      });

      expect(res.statusCode).toBe(200);
      expect(listPosts.execute).toHaveBeenCalledWith(expect.objectContaining({ hasMedia: false }));
    });

    it("passes hasMedia true to the use case when the flag is true", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/posts?projectId=${PROJECT_ID}&hasMedia=true`,
      });

      expect(res.statusCode).toBe(200);
      expect(listPosts.execute).toHaveBeenCalledWith(expect.objectContaining({ hasMedia: true }));
    });

    it("leaves hasMedia out of the use case input when the flag is absent", async () => {
      const res = await app.inject({ method: "GET", url: `/posts?projectId=${PROJECT_ID}` });

      expect(res.statusCode).toBe(200);
      expect(listPosts.execute.mock.calls[0]?.[0]).not.toHaveProperty("hasMedia");
    });

    it.each(["yes", "1", ""])(
      "answers 400 without running the use case when hasMedia is %j",
      async (value) => {
        const res = await app.inject({
          method: "GET",
          url: `/posts?projectId=${PROJECT_ID}&hasMedia=${value}`,
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toMatchObject({
          ok: false,
          error: "Invalid query parameters",
        });
        expect(listPosts.execute).not.toHaveBeenCalled();
      }
    );
  });

  describe("includeArchived", () => {
    it("leaves includeArchived out of the use case input when the flag is false", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/posts?projectId=${PROJECT_ID}&includeArchived=false`,
      });

      expect(res.statusCode).toBe(200);
      expect(listPosts.execute.mock.calls[0]?.[0]).not.toHaveProperty("includeArchived");
    });

    it("passes includeArchived true to the use case when the flag is true", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/posts?projectId=${PROJECT_ID}&includeArchived=true`,
      });

      expect(res.statusCode).toBe(200);
      expect(listPosts.execute).toHaveBeenCalledWith(
        expect.objectContaining({ includeArchived: true })
      );
    });

    it("leaves includeArchived out of the use case input when the flag is absent", async () => {
      const res = await app.inject({ method: "GET", url: `/posts?projectId=${PROJECT_ID}` });

      expect(res.statusCode).toBe(200);
      expect(listPosts.execute.mock.calls[0]?.[0]).not.toHaveProperty("includeArchived");
    });

    it.each(["yes", "1", ""])(
      "answers 400 without running the use case when includeArchived is %j",
      async (value) => {
        const res = await app.inject({
          method: "GET",
          url: `/posts?projectId=${PROJECT_ID}&includeArchived=${value}`,
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toMatchObject({
          ok: false,
          error: "Invalid query parameters",
        });
        expect(listPosts.execute).not.toHaveBeenCalled();
      }
    );
  });
});
