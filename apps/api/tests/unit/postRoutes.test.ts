/**
 * @file postRoutes.test.ts
 * @description Gate tests for `DELETE /posts/batch`, the bulk hard-delete.
 *
 *              WHY THIS FILE EXISTS. Before the ON DELETE convention, `PostContent`
 *              and `PostMedia` referenced `Post` with ON DELETE RESTRICT, and
 *              `PrismaPostRepository.doCreate` writes exactly one `PostContent` row
 *              for every post it creates — so this route's `post.deleteMany` raised
 *              P2003 for every post the application can produce. The convention makes
 *              the same call succeed and cascade. That flips a customer-facing button
 *              from "always fails" to "irreversibly destroys", so the route moved
 *              behind `requireAdminAuth` + `account:manage`, the same gate its three
 *              siblings carry (`/accounts/:id/hard`, `/projects/:id/hard`,
 *              `/channels/:id/hard`).
 *
 *              `requireClientAuth` is mocked PERMISSIVE on purpose, and that mock is
 *              the load-bearing part of the gate test: it models the most favourable
 *              case for an attacker — a caller the customer middleware fully admits.
 *              Under the previous registration such a caller reached the handler and
 *              got a 200; under this one the real, unmocked `requireAdminAuth` refuses
 *              it. Revert the route's preHandler and these tests go red.
 *              `requirePermission` stays mocked: RBAC enforcement is its own concern
 *              with its own tests, and what these pin is WHICH caller class reaches
 *              the destruction.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";

// Permissive client auth = "any authenticated customer". See the file header: this
// is what makes the 401 below a statement about the GATE and not about the token.
vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async () => {},
}));

vi.mock("../../src/auth/rbacMiddleware.js", () => ({
  requirePermission: () => async () => {},
}));

import { createMockPrismaModule } from "./helpers/mockPrisma.js";

const { mockPrisma, stores } = createMockPrismaModule();

/** Post rows the doubles below serve. Kept out of `stores` because the shared mock
 *  module defines no `post` model; naming it here keeps the fixture readable. */
interface FakePost {
  id: string;
  projectId: string;
  deletedAt: Date | null;
}
const postRows: FakePost[] = [];

/** Every `post.deleteMany` the route reaches, in call order, as the id sets it asked
 *  the database to destroy. A gate that refuses a caller must leave this empty. */
const deleteManyCalls: string[][] = [];

const prismaAny = mockPrisma.prisma as Record<string, unknown>;

prismaAny.post = {
  /**
   * Stands in for `PrismaPostRepository.filterIdsByAccount`'s query: the ids in
   * `where.id.in` that are live AND whose project belongs to `where.project.accountId`.
   * The account join is honoured rather than ignored, because the whole point of the
   * assertions below is that the CWE-639 filter still runs under admin auth.
   */
  findMany: vi.fn(
    async (args: {
      where?: {
        id?: { in?: string[] };
        deletedAt?: Date | null;
        project?: { accountId?: string };
      };
    }) => {
      const ids = args.where?.id?.in ?? [];
      const accountId = args.where?.project?.accountId;
      return postRows
        .filter((p) => ids.includes(p.id))
        .filter((p) => p.deletedAt === null)
        .filter((p) => {
          if (accountId === undefined) return true;
          const project = stores.project.get(p.projectId);
          return project?.accountId === accountId;
        })
        .map((p) => ({ id: p.id }));
    }
  ),
  deleteMany: vi.fn(async (args: { where?: { id?: { in?: string[] } } }) => {
    const ids = args.where?.id?.in ?? [];
    deleteManyCalls.push([...ids]);
    let count = 0;
    for (const id of ids) {
      const index = postRows.findIndex((p) => p.id === id);
      if (index >= 0) {
        postRows.splice(index, 1);
        count += 1;
      }
    }
    return { count };
  }),
  findFirst: vi.fn(async () => null),
  count: vi.fn(async () => 0),
  updateMany: vi.fn(async () => ({ count: 0 })),
};

// Models other repositories built by the composition root reach for. Named one by
// one rather than proxied: a model that is reached but this list forgets must
// surface as a failure instead of being papered over by a catch-all.
for (const model of [
  "postContent",
  "postMedia",
  "publishLog",
  "analytics",
  "contentVersion",
  "tweet",
  "thread",
  "channel",
  "deletionRecord",
]) {
  prismaAny[model] = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    findMany: vi.fn(async () => []),
    createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })),
  };
}

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

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

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const { postRoutes } = await import("../../src/posts/postRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { TokenService } = await import("../../src/admin/auth/TokenService.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// A genuine admin access token, signed with the same secret the real
// `requireAdminAuth` verifies against — not a hand-set `request.auth`, which would
// prove an authentication the running system never performs.
const adminAccessToken = new TokenService().generateAccessToken({
  id: "admin-user-batch-1",
  email: "admin-batch@omnipost.test",
  name: "Admin Batch",
  role: "SUPER_ADMIN",
} as never);
const adminAuthHeaders = { authorization: `Bearer ${adminAccessToken}` };

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);
  const container = setupContainer({ prisma: mockPrisma.prisma as never });
  typedApp.decorate("container", container);
  await typedApp.register(postRoutes);
  return typedApp;
}

// ---------------------------------------------------------------------------
// Fixture: two accounts, one project each, one post each
// ---------------------------------------------------------------------------

const OWNER_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const OWNED_POST_ID = "33333333-3333-4333-8333-333333333333";
const FOREIGN_POST_ID = "44444444-4444-4444-8444-444444444444";

let app: FastifyInstance;

function seed(): void {
  postRows.length = 0;
  deleteManyCalls.length = 0;
  stores.project.clear();
  stores.account.clear();
  stores.account.add({ id: OWNER_ACCOUNT_ID, email: "owner@t.test", name: "Owner" });
  stores.account.add({ id: OTHER_ACCOUNT_ID, email: "other@t.test", name: "Other" });
  const ownerProject = stores.project.add({ accountId: OWNER_ACCOUNT_ID, name: "owner-project" });
  const otherProject = stores.project.add({ accountId: OTHER_ACCOUNT_ID, name: "other-project" });
  postRows.push({ id: OWNED_POST_ID, projectId: ownerProject.id as string, deletedAt: null });
  postRows.push({ id: FOREIGN_POST_ID, projectId: otherProject.id as string, deletedAt: null });
}

describe("DELETE /posts/batch — bulk hard-delete gate", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("refuses a caller the customer middleware admits, and destroys nothing", async () => {
    // No admin bearer token. `requireClientAuth` is mocked permissive, so under the
    // previous `preHandler: [requireClientAuth]` registration this exact request
    // reached the handler and returned 200. It must now be refused.
    const response = await app.inject({
      method: "DELETE",
      url: "/posts/batch",
      payload: { postIds: [OWNED_POST_ID], accountId: OWNER_ACCOUNT_ID },
    });

    expect(response.statusCode).toBe(401);
    expect(deleteManyCalls).toEqual([]);
    expect(postRows.map((p) => p.id)).toContain(OWNED_POST_ID);
  });

  it("refuses a malformed bearer token, and destroys nothing", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/posts/batch",
      headers: { authorization: "Bearer not-a-real-admin-token" },
      payload: { postIds: [OWNED_POST_ID], accountId: OWNER_ACCOUNT_ID },
    });

    expect(response.statusCode).toBe(401);
    expect(deleteManyCalls).toEqual([]);
  });

  it("rejects an authorized admin who names no account, and destroys nothing", async () => {
    // The owner scope is mandatory: admin auth binds no `customerUser`, so without
    // `accountId` the use case would run with no CWE-639 filter at all.
    const response = await app.inject({
      method: "DELETE",
      url: "/posts/batch",
      headers: adminAuthHeaders,
      payload: { postIds: [OWNED_POST_ID] },
    });

    expect(response.statusCode).toBe(400);
    expect(deleteManyCalls).toEqual([]);
    expect(postRows.map((p) => p.id)).toContain(OWNED_POST_ID);
  });

  it("deletes the named account's posts for an authorized admin", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/posts/batch",
      headers: adminAuthHeaders,
      payload: { postIds: [OWNED_POST_ID], accountId: OWNER_ACCOUNT_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data?: { deleted: number } };
    expect(body.ok).toBe(true);
    expect(body.data?.deleted).toBe(1);
    expect(deleteManyCalls).toEqual([[OWNED_POST_ID]]);
  });

  it("drops ids outside the named account before the delete runs", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/posts/batch",
      headers: adminAuthHeaders,
      payload: {
        postIds: [OWNED_POST_ID, FOREIGN_POST_ID],
        accountId: OWNER_ACCOUNT_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    // The foreign id never reaches the database, so the cascade never touches it.
    expect(deleteManyCalls).toEqual([[OWNED_POST_ID]]);
    expect(postRows.map((p) => p.id)).toContain(FOREIGN_POST_ID);
  });
});
