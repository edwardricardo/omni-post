/**
 * @file commentRoutes.test.ts
 * @description Unit tests for in-context comments system endpoints.
 *   Uses mocked Prisma stores and a real Fastify instance to test HTTP endpoint behavior.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "../helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "../helpers/InMemoryAuditLogRepository.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// Post defaults that satisfy the domain mapper
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

// PostComment defaults
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

// Add extra models needed by comment routes and their repositories
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
const { authRoutes } = await import("../../../src/auth/authRoutes.js");
const { setupContainer } = await import("../../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");
const { AuthService, setRedisInstance } = await import("../../../src/auth/authService.js");
const { MfaService } = await import("../../../src/admin/auth/MfaService.js");
const { PrismaAdminMfaUserRepository } =
  await import("../../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js");
const { PrismaCustomerMfaUserRepository } =
  await import("../../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js");
const { PrismaAdminUserRepository } =
  await import("../../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaRoleRepository } =
  await import("../../../src/infrastructure/repositories/PrismaRoleRepository.js");
const { PrismaAdminSessionRepository } =
  await import("../../../src/infrastructure/repositories/PrismaAdminSessionRepository.js");
const { signCustomerAccessToken } = await import("../../../src/auth/customerJwt.js");

setRedisInstance(null as never);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
// Stable account id shared by the test account, the test post (denormalized for
// the ownership resolver), and every customer token — so the cross-tenant
// create/read gate (CWE-639) sees the caller as the post's owner.
const testAccountId = `acct-${timestamp}`;

let app: import("fastify").FastifyInstance;
let customerToken: string;
let testPostId: string;
let testMemberId: string;

async function createTestApp() {
  const localApp = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });

  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
  const sessionRepo = new PrismaAdminSessionRepository(mockPrisma.prisma as never);
  const mfaSvc = new MfaService(
    new PrismaAdminMfaUserRepository(mockPrisma.prisma as never),
    new PrismaCustomerMfaUserRepository(mockPrisma.prisma as never),
    new InMemoryAuditLogRepository()
  );
  const authSvc = new AuthService(
    mockPrisma.prisma,
    adminUserRepo,
    mfaSvc,
    roleRepo,
    sessionRepo,
    new InMemoryAuditLogRepository()
  );
  container.registerInstance(TOKENS.AuthService, authSvc);

  localApp.decorate("container", container);
  await localApp.register(fastifyCookie);
  await localApp.register(authRoutes);
  await localApp.register(commentRoutes);
  await localApp.ready();
  return { app: localApp, authSvc };
}

describe("commentRoutes Integration Tests", () => {
  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;

    // Create account with the stable id so customer tokens (accountId) match.
    await (mockPrisma.prisma.account as { create: Function }).create({
      data: {
        id: testAccountId,
        email: `comment-account-${timestamp}@example.com`,
        name: "Comment Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });

    // Create project
    const project = await (mockPrisma.prisma.project as { create: Function }).create({
      data: {
        accountId: testAccountId,
        name: "Comment Test Project",
      },
    });

    // Create post. `accountId` is denormalized onto the mock row so the
    // post-ownership resolver (project -> accountId) can resolve the owner via
    // the resolvePostProject include resolver.
    const post = await (mockPrisma.prisma as Record<string, { create: Function }>).post.create({
      data: {
        projectId: project.id,
        accountId: testAccountId,
        status: "DRAFT",
        contents: [],
        media: [],
        contentVersions: [],
      },
    });
    testPostId = post.id;

    // Create team member (comment author)
    const member = await (
      mockPrisma.prisma as Record<string, { create: Function }>
    ).teamMember.create({
      data: {
        accountId: testAccountId,
        email: `commenter-${timestamp}@example.com`,
        name: "Comment Author",
        role: "MEMBER",
      },
    });
    testMemberId = member.id;

    // Customer token whose accountId owns the test post — used for the
    // customer-facing comment create/list/edit endpoints so the cross-tenant
    // gate (CWE-639) admits the caller as the owner. The comment routes use
    // customer auth (requireClientAuth), not admin auth.
    customerToken = signCustomerAccessToken({
      sub: testMemberId,
      accountId: testAccountId,
      roleId: "role-member",
      roleName: "MEMBER",
      permissions: [],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- POST /posts/:postId/comments ---

  describe("POST /posts/:postId/comments", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        payload: {
          authorId: testMemberId,
          body: "Unauthenticated comment",
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("creates comment successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          authorId: testMemberId,
          body: "This is a test comment",
        },
      });

      const parsed = JSON.parse(response.body);
      expect(response.statusCode).toBe(201);
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.id).toBeTruthy();
    });

    it("creates reply to existing comment", async () => {
      // First create a parent comment
      const parentResponse = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          authorId: testMemberId,
          body: "Parent comment for reply test",
        },
      });

      const parentBody = JSON.parse(parentResponse.body);
      expect(parentResponse.statusCode).toBe(201);
      const parentId = parentBody.data?.id;
      expect(parentId).toBeTruthy();

      // Create a reply
      const replyResponse = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          authorId: testMemberId,
          body: "This is a reply",
          parentId,
        },
      });

      const replyBody = JSON.parse(replyResponse.body);
      expect(replyResponse.statusCode).toBe(201);
      expect(replyBody.ok).toBe(true);
      expect(replyBody.data?.id).toBeTruthy();
    });

    it("rejects empty body", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          authorId: testMemberId,
          body: "",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // --- GET /posts/:postId/comments ---

  describe("GET /posts/:postId/comments", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/comments`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("lists comments for post", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${customerToken}` },
      });

      const parsed = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(parsed.ok).toBe(true);
      expect(Array.isArray(parsed.data?.items)).toBeTruthy();
    });

    it("supports parentOnly filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/comments?parentOnly=true`,
        headers: { authorization: `Bearer ${customerToken}` },
      });

      const parsed = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(parsed.ok).toBe(true);
    });
  });

  // --- PATCH /comments/:id ---

  describe("PATCH /comments/:id", () => {
    let editableCommentId: string;

    beforeAll(async () => {
      // Create a comment to edit
      const createResponse = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          authorId: testMemberId,
          body: "Comment to be edited",
        },
      });

      const createBody = JSON.parse(createResponse.body);
      expect(createBody.data?.id).toBeTruthy();
      editableCommentId = createBody.data.id;
    });

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/comments/${editableCommentId}`,
        payload: {
          editorId: testMemberId,
          body: "Updated without auth",
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("edits comment successfully", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/comments/${editableCommentId}`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          editorId: testMemberId,
          body: "Updated comment body",
        },
      });

      const parsed = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.updated).toBe(true);
    });

    it("rejects edit with empty body", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/comments/${editableCommentId}`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          editorId: testMemberId,
          body: "",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // --- DELETE /comments/:id ---

  describe("DELETE /comments/:id", () => {
    let deletableCommentId: string;
    let foreignCommentId: string;
    let authorToken: string;
    let strangerToken: string;

    beforeAll(async () => {
      // Mint customer tokens for the author and for an unrelated user.
      // Moderation does not exist yet: only the comment author can delete.
      authorToken = signCustomerAccessToken({
        sub: testMemberId,
        accountId: testAccountId,
        roleId: "role-member",
        roleName: "MEMBER",
        permissions: [],
      });
      strangerToken = signCustomerAccessToken({
        sub: "stranger-user-id",
        accountId: testAccountId,
        roleId: "role-owner",
        roleName: "OWNER",
        permissions: [],
      });

      // Create two comments authored by testMemberId. The author is derived
      // from the authenticated token (identity gate, CWE-639), so we mint the
      // comments with `authorToken` (sub === testMemberId), not the admin token.
      const createDeletable = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${authorToken}` },
        payload: { body: "Comment to be deleted by author" },
      });
      deletableCommentId = JSON.parse(createDeletable.body).data.id;

      const createForeign = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${authorToken}` },
        payload: { body: "Comment a stranger cannot delete" },
      });
      foreignCommentId = JSON.parse(createForeign.body).data.id;
    });

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/comments/${deletableCommentId}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("soft deletes own comment when caller is the author", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/comments/${deletableCommentId}`,
        headers: { authorization: `Bearer ${authorToken}` },
      });

      const parsed = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.deleted).toBe(true);
    });

    it("rejects delete when caller is not the comment author", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/comments/${foreignCommentId}`,
        headers: { authorization: `Bearer ${strangerToken}` },
      });

      expect(response.statusCode).toBe(403);
      const parsed = JSON.parse(response.body);
      expect(parsed.ok).toBe(false);
    });
  });
});
