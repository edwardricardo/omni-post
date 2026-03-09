#!/usr/bin/env tsx
/**
 * @file approvalRoutes.test.ts
 * @description Integration-style route tests for the content approval workflow endpoints.
 *   Uses real DI container with Prisma for integration-style route testing.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { approvalRoutes } from "../../../src/approvals/approvalRoutes.js";
import type { AuthService } from "../../../src/auth/authService.js";
import { prisma } from "@infra/prisma";
import { setupContainer } from "../../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";

// --- Test helpers ---

let containerAuthService: AuthService;

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma });
  containerAuthService = container.resolve<AuthService>(TOKENS.AuthService);
  typedApp.decorate("container", container);

  await typedApp.register(approvalRoutes);
  return typedApp;
}

const timestamp = Date.now();
const adminEmail = `approval-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let adminToken: string;
let testAccountId: string;
let testProjectId: string;
let testPostId: string;
let submitterMemberId: string;
let reviewerMemberId: string;

describe("approvalRoutes Integration Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create account
    const account = await prisma.account.create({
      data: {
        email: `approval-account-${timestamp}@example.com`,
        name: "Approval Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    // Create project
    const project = await prisma.project.create({
      data: {
        accountId: testAccountId,
        name: "Approval Test Project",
      },
    });
    testProjectId = project.id;

    // Create post
    const post = await prisma.post.create({
      data: {
        projectId: testProjectId,
        status: "DRAFT",
      },
    });
    testPostId = post.id;

    // Create submitter team member
    const submitter = await prisma.teamMember.create({
      data: {
        accountId: testAccountId,
        email: `submitter-${timestamp}@example.com`,
        name: "Submitter Member",
        role: "MEMBER",
      },
    });
    submitterMemberId = submitter.id;

    // Create reviewer team member
    const reviewer = await prisma.teamMember.create({
      data: {
        accountId: testAccountId,
        email: `reviewer-${timestamp}@example.com`,
        name: "Reviewer Member",
        role: "OWNER",
      },
    });
    reviewerMemberId = reviewer.id;

    // Create admin user for authentication
    const adminResult = await containerAuthService.registerAdmin(
      adminEmail,
      testPassword,
      "Approval Admin",
      "ADMIN"
    );
    assert.ok(adminResult.ok, "Admin registration should succeed");

    // Get auth token
    const loginResult = await containerAuthService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    assert.ok(loginResult.ok, "Login should succeed");
    if (loginResult.ok && "tokens" in loginResult.value) {
      adminToken = loginResult.value.tokens.accessToken;
    }
  });

  after(async () => {
    try {
      // Clean up in reverse dependency order
      await prisma.approvalReview.deleteMany({
        where: { request: { postId: testPostId } },
      });
      await prisma.approvalRequest.deleteMany({
        where: { postId: testPostId },
      });
      await prisma.post.deleteMany({
        where: { projectId: testProjectId },
      });
      await prisma.projectMember.deleteMany({
        where: { member: { accountId: testAccountId } },
      });
      await prisma.teamMember.deleteMany({
        where: { accountId: testAccountId },
      });
      await prisma.project.deleteMany({
        where: { accountId: testAccountId },
      });
      await prisma.account.deleteMany({
        where: { id: testAccountId },
      });

      // Clean up admin user
      const adminUser = await prisma.adminUser.findUnique({
        where: { email: adminEmail },
      });
      if (adminUser) {
        await prisma.session.deleteMany({ where: { userId: adminUser.id } });
        await prisma.loginAttempt.deleteMany({ where: { userId: adminUser.id } });
        await prisma.adminRoleHistory.deleteMany({ where: { userId: adminUser.id } });
        await prisma.adminUser.delete({ where: { id: adminUser.id } });
      }
    } catch (_err: unknown) {
      // Cleanup is best-effort
    }

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
      assert.equal(response.statusCode, 401);
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
      assert.equal(response.statusCode, 201);
      assert.equal(body.ok, true);
      assert.ok(body.data?.requestId, "Should return requestId");
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

      assert.equal(response.statusCode, 400);
    });
  });

  // --- POST /approvals/:id/approve ---

  describe("POST /approvals/:id/approve", () => {
    let approvalRequestId: string;

    before(async () => {
      // Create a second post and submit it for review so we can approve it
      const post = await prisma.post.create({
        data: {
          projectId: testProjectId,
          status: "DRAFT",
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
      assert.ok(submitBody.data?.requestId, "Submit should succeed for approve tests");
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
      assert.equal(response.statusCode, 401);
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
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data?.approved, true);
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
      assert.equal(response.statusCode, 404);
      assert.equal(body.ok, false);
    });
  });

  // --- POST /approvals/:id/reject ---

  describe("POST /approvals/:id/reject", () => {
    let rejectableRequestId: string;

    before(async () => {
      // Create a third post and submit it for review so we can reject it
      const post = await prisma.post.create({
        data: {
          projectId: testProjectId,
          status: "DRAFT",
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
      assert.ok(submitBody.data?.requestId, "Submit should succeed for reject tests");
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
      assert.equal(response.statusCode, 401);
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
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data?.rejected, true);
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
      assert.equal(response.statusCode, 404);
      assert.equal(body.ok, false);
    });
  });

  // --- GET /posts/:postId/approvals ---

  describe("GET /posts/:postId/approvals", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/approvals`,
      });
      assert.equal(response.statusCode, 401);
    });

    it("returns approval history for post", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/approvals`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data?.approvals), "Should return approvals array");

      // The first submit-for-review test created an approval for testPostId
      if (body.data.approvals.length > 0) {
        const first = body.data.approvals[0];
        assert.ok(first.id, "DTO should have id");
        assert.equal(first.postId, testPostId, "Should match the queried post");
        assert.ok(first.submitterId, "DTO should have submitterId");
        assert.ok(first.status, "DTO should have status");
        assert.ok(first.createdAt, "DTO should have createdAt");
        assert.ok(Array.isArray(first.reviews), "DTO should have reviews array");
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
      assert.equal(response.statusCode, 401);
    });

    it("returns pending approvals for reviewer", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/approvals/pending?reviewerId=${reviewerMemberId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data?.approvals), "Should return approvals array");
    });
  });
});
