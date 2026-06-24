/**
 * @file commentRoutesIdentityIsolation.test.ts
 * @description Identity-spoof (CWE-639 / IDOR-COMMENTS) regression tests for the
 *              in-context comment routes. The comment author and editor identity
 *              MUST be derived from the authenticated token (`customerUser.id`),
 *              never from an attacker-controlled `authorId` / `editorId` request
 *              body field. Asserts:
 *                - createComment stamps the token user as author even when the
 *                  body claims a different author (no author forgery);
 *                - editComment rejects an attacker who is not the original
 *                  author, even when the body claims to be the author (the
 *                  editor is the token user, so the domain author-only check
 *                  fires).
 *              Uses a real Fastify instance with mocked Prisma + auth, mirroring
 *              commentRoutes.test.ts.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "../helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup (mirrors commentRoutes.test.ts)
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

const postDefaults = {
  status: "DRAFT",
  deletedAt: null,
  publishedAt: null,
  scheduledAt: null,
  title: null,
  excerpt: null,
  language: "EN",
  tags: [],
  platformOverrides: {},
  contents: [],
  media: [],
  contentVersions: [],
};

const commentDefaults = {
  deletedAt: null,
  editedAt: null,
  parentId: null,
};

// Cross-tenant ownership gate (CWE-639) resolves a post's owner via
// `post.findFirst({ select: { project: { select: { accountId } } } })`. The mock
// post store denormalizes the owning accountId onto each post row and this
// resolver surfaces it as the nested `project` relation the adapter selects.
const resolvePostProject = (
  record: Record<string, unknown>,
  include: Record<string, boolean | Record<string, unknown>>
): Record<string, unknown> => {
  if (include.project) {
    return { ...record, project: { accountId: record.accountId } };
  }
  return { ...record };
};

const extraModels = {
  postComment: buildModelMock(createStore(), commentDefaults),
  post: buildModelMock(createStore(), postDefaults, "id", resolvePostProject),
  teamMember: buildModelMock(createStore(), {
    isActive: true,
    role: "MEMBER",
    avatarUrl: null,
    invitedBy: null,
  }),
  projectMember: buildModelMock(createStore()),
  channel: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
};
Object.assign(mockPrisma.prisma, extraModels);

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../../src/auth/customerAuthMiddleware.js", async () => {
  const { createCustomerAuthMock } = await import("../helpers/mockAuthMiddleware.js");
  return createCustomerAuthMock();
});

vi.mock("../../../src/lib/logger.js", () => {
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
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const fastifyCookie = (await import("@fastify/cookie")).default;
const { commentRoutes } = await import("../../../src/comments/commentRoutes.js");
const { setupContainer } = await import("../../../src/infrastructure/container/setup.js");
const { signCustomerAccessToken } = await import("../../../src/auth/customerJwt.js");

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const ACCOUNT_ID = `acct-${timestamp}`;
const AUTHOR_USER_ID = `author-user-${timestamp}`;
const ATTACKER_USER_ID = `attacker-user-${timestamp}`;

let app: import("fastify").FastifyInstance;
let testPostId: string;
let authorToken: string;
let attackerToken: string;

async function createTestApp() {
  const localApp = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });
  localApp.decorate("container", container);
  await localApp.register(fastifyCookie);
  await localApp.register(commentRoutes);
  await localApp.ready();
  return localApp;
}

describe("commentRoutes — identity isolation (IDOR-COMMENTS, CWE-639)", () => {
  beforeAll(async () => {
    app = await createTestApp();

    const account = await (mockPrisma.prisma.account as { create: Function }).create({
      data: { id: ACCOUNT_ID, email: `c-${timestamp}@example.com`, name: "Acct", maxProjects: 5 },
    });
    const project = await (mockPrisma.prisma.project as { create: Function }).create({
      data: { accountId: account.id, name: "Proj" },
    });
    // `accountId` denormalized onto the post row so the ownership resolver
    // (post -> project -> accountId) can admit the owning tenant's tokens.
    const post = await (mockPrisma.prisma as Record<string, { create: Function }>).post.create({
      data: {
        projectId: project.id,
        accountId: account.id,
        status: "DRAFT",
        contents: [],
        media: [],
        contentVersions: [],
      },
    });
    testPostId = post.id;

    authorToken = signCustomerAccessToken({
      sub: AUTHOR_USER_ID,
      accountId: ACCOUNT_ID,
      roleId: "role-member",
      roleName: "MEMBER",
      permissions: [],
    });
    attackerToken = signCustomerAccessToken({
      sub: ATTACKER_USER_ID,
      accountId: ACCOUNT_ID,
      roleId: "role-member",
      roleName: "MEMBER",
      permissions: [],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /posts/:postId/comments — author identity", () => {
    it("stamps the authenticated token user as author, ignoring a spoofed body authorId", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${attackerToken}` },
        payload: { authorId: AUTHOR_USER_ID, body: "Forged author attempt" },
      });

      expect(response.statusCode).toBe(201);
      const created = JSON.parse(response.body);
      const commentId = created.data?.id;
      expect(commentId).toBeTruthy();

      // The persisted author must be the TOKEN user (attacker), never the
      // spoofed body value — i.e. a user cannot forge authorship of another.
      const stored = await (
        mockPrisma.prisma as Record<string, { findUnique: Function }>
      ).postComment.findUnique({ where: { id: commentId } });
      expect(stored?.authorId).toBe(ATTACKER_USER_ID);
      expect(stored?.authorId).not.toBe(AUTHOR_USER_ID);
    });
  });

  describe("PATCH /comments/:id — editor identity", () => {
    let commentId: string;

    beforeAll(async () => {
      const created = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${authorToken}` },
        payload: { body: "Original by author" },
      });
      commentId = JSON.parse(created.body).data.id;
    });

    it("rejects an edit by a non-author even when the body spoofs editorId as the author", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/comments/${commentId}`,
        headers: { authorization: `Bearer ${attackerToken}` },
        // Attacker claims to be the original author via the body — must be ignored.
        payload: { editorId: AUTHOR_USER_ID, body: "Hijacked edit" },
      });

      // Editor is derived from the token (attacker), so the domain author-only
      // invariant fires: not the author -> rejected.
      expect(response.statusCode).not.toBe(200);
      const parsed = JSON.parse(response.body);
      expect(parsed.ok).toBe(false);
    });

    it("allows the original author to edit their own comment", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/comments/${commentId}`,
        headers: { authorization: `Bearer ${authorToken}` },
        payload: { body: "Legit edit by author" },
      });

      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body);
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.updated).toBe(true);
    });
  });
});
