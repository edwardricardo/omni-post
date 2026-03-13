/**
 * @file approvalRoutes.test.ts
 * @description Unit tests for content approval workflow endpoints.
 *   Uses mocked Prisma stores and a real Fastify instance to test HTTP endpoint behavior.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "../helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// Approval request store with include resolver for reviews
const approvalRequestStore = createStore<Record<string, unknown>>();
const approvalReviewStore = createStore<Record<string, unknown>>();

const approvalRequestMock = buildModelMock(
  approvalRequestStore,
  { status: "PENDING", comment: null },
  "id",
  (record, include) => {
    const result = { ...record };
    if (include.reviews) {
      const requestId = record.id as string;
      result.reviews = approvalReviewStore.all().filter((r) => r.requestId === requestId);
    }
    return result;
  }
);

// Post defaults that satisfy the domain mapper (contents, media, contentVersions)
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

// Add extra models needed by approval routes and their repositories
const extraModels = {
  approvalRequest: approvalRequestMock,
  approvalReview: buildModelMock(approvalReviewStore),
  post: buildModelMock(createStore(), postDefaults),
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
const { approvalRoutes } = await import("../../../src/approvals/approvalRoutes.js");
const { authRoutes } = await import("../../../src/auth/authRoutes.js");
const { setupContainer } = await import("../../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");
const { AuthService, setRedisInstance } = await import("../../../src/auth/authService.js");
const { MfaService } = await import("../../../src/auth/mfaService.js");
const { PrismaAdminUserRepository } = await import(
  "../../../src/infrastructure/repositories/PrismaAdminUserRepository.js"
);

setRedisInstance(null as never);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `approval-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123";

let app: import("fastify").FastifyInstance;
let adminToken: string;
let testAccountId: string;
let testProjectId: string;
let testPostId: string;
let submitterMemberId: string;
let reviewerMemberId: string;

async function createTestApp() {
  const localApp = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });

  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const mfaSvc = new MfaService(adminUserRepo);
  const authSvc = new AuthService(adminUserRepo, mfaSvc);
  container.registerInstance(TOKENS.AuthService, authSvc);

  localApp.decorate("container", container);
  await localApp.register(fastifyCookie);
  await localApp.register(authRoutes);
  await localApp.register(approvalRoutes);
  await localApp.ready();
  return { app: localApp, authSvc };
}

describe("approvalRoutes Integration Tests", () => {
  let authSvc: InstanceType<typeof AuthService>;

  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;
    authSvc = result.authSvc;

    // Create account
    const account = await (mockPrisma.prisma.account as { create: Function }).create({
      data: {
        email: `approval-account-${timestamp}@example.com`,
        name: "Approval Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    // Create project
    const project = await (mockPrisma.prisma.project as { create: Function }).create({
      data: {
        accountId: testAccountId,
        name: "Approval Test Project",
      },
    });
    testProjectId = project.id;

    // Create post (with defaults that satisfy domain mapper)
    const post = await (mockPrisma.prisma as Record<string, { create: Function }>).post.create({
      data: {
        projectId: testProjectId,
        status: "DRAFT",
        contents: [],
        media: [],
        contentVersions: [],
      },
    });
    testPostId = post.id;

    // Create submitter team member
    const submitter = await (
      mockPrisma.prisma as Record<string, { create: Function }>
    ).teamMember.create({
      data: {
        accountId: testAccountId,
        email: `submitter-${timestamp}@example.com`,
        name: "Submitter Member",
        role: "MEMBER",
      },
    });
    submitterMemberId = submitter.id;

    // Create reviewer team member
    const reviewer = await (
      mockPrisma.prisma as Record<string, { create: Function }>
    ).teamMember.create({
      data: {
        accountId: testAccountId,
        email: `reviewer-${timestamp}@example.com`,
        name: "Reviewer Member",
        role: "OWNER",
      },
    });
    reviewerMemberId = reviewer.id;

    // Register admin user and get token
    await authSvc.registerAdmin(adminEmail, testPassword, "Approval Admin", "ADMIN");
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: adminEmail, password: testPassword },
    });
    const loginBody = JSON.parse(loginRes.body);
    adminToken = loginBody.data?.accessToken ?? "";
  });

  afterAll(async () => {
    await app.close();
  });

  // --- POST /posts/:postId/submit-for-review ---

  describe("POST /posts/:postId/submit-for-review", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/submit-for-review`,
        payload: {
          submitterId: submitterMemberId,
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("submits post for review successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/submit-for-review`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          submitterId: submitterMemberId,
          comment: "Ready for review",
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.data?.requestId).toBeTruthy();
    });

    it("rejects invalid postId format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/posts/not-a-uuid/submit-for-review",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          submitterId: submitterMemberId,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // --- POST /approvals/:id/approve ---

  describe("POST /approvals/:id/approve", () => {
    let approvalRequestId: string;

    beforeAll(async () => {
      // Create a second post and submit it for review so we can approve it
      const post = await (mockPrisma.prisma as Record<string, { create: Function }>).post.create({
        data: {
          projectId: testProjectId,
          status: "DRAFT",
          contents: [],
          media: [],
          contentVersions: [],
        },
      });

      const submitResponse = await app.inject({
        method: "POST",
        url: `/posts/${post.id}/submit-for-review`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          submitterId: submitterMemberId,
        },
      });

      const submitBody = JSON.parse(submitResponse.body);
      expect(submitBody.data?.requestId).toBeTruthy();
      approvalRequestId = submitBody.data.requestId;
    });

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${approvalRequestId}/approve`,
        payload: {
          reviewerId: reviewerMemberId,
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("approves post successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${approvalRequestId}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reviewerId: reviewerMemberId,
          comment: "Looks good",
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.approved).toBe(true);
    });

    it("returns 404 for non-existent approval", async () => {
      const fakeId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${fakeId}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reviewerId: reviewerMemberId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  // --- POST /approvals/:id/reject ---

  describe("POST /approvals/:id/reject", () => {
    let rejectableRequestId: string;

    beforeAll(async () => {
      // Create a third post and submit it for review so we can reject it
      const post = await (mockPrisma.prisma as Record<string, { create: Function }>).post.create({
        data: {
          projectId: testProjectId,
          status: "DRAFT",
          contents: [],
          media: [],
          contentVersions: [],
        },
      });

      const submitResponse = await app.inject({
        method: "POST",
        url: `/posts/${post.id}/submit-for-review`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          submitterId: submitterMemberId,
        },
      });

      const submitBody = JSON.parse(submitResponse.body);
      expect(submitBody.data?.requestId).toBeTruthy();
      rejectableRequestId = submitBody.data.requestId;
    });

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${rejectableRequestId}/reject`,
        payload: {
          reviewerId: reviewerMemberId,
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("rejects post successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${rejectableRequestId}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reviewerId: reviewerMemberId,
          comment: "Needs more work",
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.rejected).toBe(true);
    });

    it("returns 404 for non-existent approval", async () => {
      const fakeId = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
      const response = await app.inject({
        method: "POST",
        url: `/approvals/${fakeId}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reviewerId: reviewerMemberId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  // --- GET /posts/:postId/approvals ---

  describe("GET /posts/:postId/approvals", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/approvals`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns approval history for post", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/approvals`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.approvals)).toBeTruthy();

      // The first submit-for-review test created an approval for testPostId
      if (body.data.approvals.length > 0) {
        const first = body.data.approvals[0];
        expect(first.id).toBeTruthy();
        expect(first.postId).toBe(testPostId);
        expect(first.submitterId).toBeTruthy();
        expect(first.status).toBeTruthy();
        expect(first.createdAt).toBeTruthy();
        expect(Array.isArray(first.reviews)).toBeTruthy();
      }
    });
  });

  // --- GET /approvals/pending ---

  describe("GET /approvals/pending", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/approvals/pending?reviewerId=${reviewerMemberId}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns pending approvals for reviewer", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/approvals/pending?reviewerId=${reviewerMemberId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.approvals)).toBeTruthy();
    });
  });
});
