#!/usr/bin/env tsx
/**
 * @file commentRoutes.test.ts
 * @description Integration-style route tests for the in-context comments system.
 *   Uses real DI container with Prisma for integration-style route testing.
 *   Covers create, list, edit, and soft-delete comment endpoints.
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
import { commentRoutes } from "../../../src/comments/commentRoutes.js";
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

  await typedApp.register(commentRoutes);
  return typedApp;
}

const timestamp = Date.now();
const adminEmail = `comment-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let adminToken: string;
let testAccountId: string;
let testProjectId: string;
let testPostId: string;
let testMemberId: string;

describe("commentRoutes Integration Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create account
    const account = await prisma.account.create({
      data: {
        email: `comment-account-${timestamp}@example.com`,
        name: "Comment Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    // Create project
    const project = await prisma.project.create({
      data: {
        accountId: testAccountId,
        name: "Comment Test Project",
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

    // Create team member (comment author)
    const member = await prisma.teamMember.create({
      data: {
        accountId: testAccountId,
        email: `commenter-${timestamp}@example.com`,
        name: "Comment Author",
        role: "MEMBER",
      },
    });
    testMemberId = member.id;

    // Create admin user for authentication
    const adminResult = await containerAuthService.registerAdmin(
      adminEmail,
      testPassword,
      "Comment Admin",
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
      await prisma.postComment.deleteMany({
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
        await prisma.loginAttempt.deleteMany({
          where: { userId: adminUser.id },
        });
        await prisma.adminRoleHistory.deleteMany({
          where: { userId: adminUser.id },
        });
        await prisma.adminUser.delete({ where: { id: adminUser.id } });
      }
    } catch (_err: unknown) {
      // Cleanup is best-effort
    }

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
      assert.equal(response.statusCode, 401);
    });

    it("creates comment successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          authorId: testMemberId,
          body: "This is a test comment",
        },
      });

      const parsed = JSON.parse(response.body);
      assert.equal(response.statusCode, 201);
      assert.equal(parsed.ok, true);
      assert.ok(parsed.data?.id, "Should return comment ID");
    });

    it("creates reply to existing comment", async () => {
      // First create a parent comment
      const parentResponse = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          authorId: testMemberId,
          body: "Parent comment for reply test",
        },
      });

      const parentBody = JSON.parse(parentResponse.body);
      assert.equal(parentResponse.statusCode, 201);
      const parentId = parentBody.data?.id;
      assert.ok(parentId, "Parent comment should have an ID");

      // Create a reply
      const replyResponse = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          authorId: testMemberId,
          body: "This is a reply",
          parentId,
        },
      });

      const replyBody = JSON.parse(replyResponse.body);
      assert.equal(replyResponse.statusCode, 201);
      assert.equal(replyBody.ok, true);
      assert.ok(replyBody.data?.id, "Reply should have an ID");
    });

    it("rejects empty body", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          authorId: testMemberId,
          body: "",
        },
      });

      assert.equal(response.statusCode, 400);
    });
  });

  // --- GET /posts/:postId/comments ---

  describe("GET /posts/:postId/comments", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/comments`,
      });
      assert.equal(response.statusCode, 401);
    });

    it("lists comments for post", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const parsed = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(parsed.ok, true);
      assert.ok(Array.isArray(parsed.data?.items), "Should return comments array");
    });

    it("supports parentOnly filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/${testPostId}/comments?parentOnly=true`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const parsed = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(parsed.ok, true);
    });
  });

  // --- PATCH /comments/:id ---

  describe("PATCH /comments/:id", () => {
    let editableCommentId: string;

    before(async () => {
      // Create a comment to edit
      const createResponse = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          authorId: testMemberId,
          body: "Comment to be edited",
        },
      });

      const createBody = JSON.parse(createResponse.body);
      assert.ok(createBody.data?.id, "Setup: comment creation should succeed");
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
      assert.equal(response.statusCode, 401);
    });

    it("edits comment successfully", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/comments/${editableCommentId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          editorId: testMemberId,
          body: "Updated comment body",
        },
      });

      const parsed = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.data?.updated, true);
    });

    it("rejects edit with empty body", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/comments/${editableCommentId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          editorId: testMemberId,
          body: "",
        },
      });

      assert.equal(response.statusCode, 400);
    });
  });

  // --- DELETE /comments/:id ---

  describe("DELETE /comments/:id", () => {
    let deletableCommentId: string;

    before(async () => {
      // Create a comment to delete
      const createResponse = await app.inject({
        method: "POST",
        url: `/posts/${testPostId}/comments`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          authorId: testMemberId,
          body: "Comment to be deleted",
        },
      });

      const createBody = JSON.parse(createResponse.body);
      assert.ok(createBody.data?.id, "Setup: comment creation should succeed");
      deletableCommentId = createBody.data.id;
    });

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/comments/${deletableCommentId}`,
      });
      assert.equal(response.statusCode, 401);
    });

    it("soft deletes comment successfully", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/comments/${deletableCommentId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const parsed = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.data?.deleted, true);
    });
  });
});
