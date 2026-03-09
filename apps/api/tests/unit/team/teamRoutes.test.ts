#!/usr/bin/env tsx
/**
 * @file teamRoutes.test.ts
 * @description Unit tests for team management HTTP endpoints.
 *   Uses real DI container with Prisma for integration-style route testing.
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { teamRoutes } from "../../../src/team/teamRoutes.js";
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

  await typedApp.register(teamRoutes);
  return typedApp;
}

const timestamp = Date.now();
const adminEmail = `team-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let adminToken: string;
let testAccountId: string;
let testMemberId: string;

describe("teamRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create an account for team management
    const account = await prisma.account.create({
      data: {
        email: `team-account-${timestamp}@example.com`,
        name: "Team Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    // Create admin user for authentication
    const adminResult = await containerAuthService.registerAdmin(
      adminEmail,
      testPassword,
      "Team Admin",
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
      // Clean up team members and account
      await prisma.projectMember.deleteMany({
        where: {
          member: { accountId: testAccountId },
        },
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

  describe("POST /team/invite", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        payload: {
          accountId: testAccountId,
          email: "member@example.com",
          name: "New Member",
        },
      });
      assert.equal(response.statusCode, 401);
    });

    it("invites a new team member successfully", async () => {
      const memberEmail = `member-${timestamp}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: memberEmail,
          name: "New Member",
          role: "MEMBER",
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 201);
      assert.equal(body.ok, true);
      assert.ok(body.data?.id, "Should return member ID");
      testMemberId = body.data.id;
    });

    it("rejects duplicate email in same account", async () => {
      const memberEmail = `member-${timestamp}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: memberEmail,
          name: "Duplicate Member",
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 409);
      assert.equal(body.ok, false);
    });

    it("rejects invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: "not-an-email",
          name: "Bad Email Member",
        },
      });

      assert.equal(response.statusCode, 400);
    });

    it("rejects missing name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: "valid@example.com",
          name: "",
        },
      });

      assert.equal(response.statusCode, 400);
    });

    it("invites member with VIEWER role", async () => {
      const viewerEmail = `viewer-${timestamp}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: viewerEmail,
          name: "Viewer Member",
          role: "VIEWER",
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 201);
      assert.equal(body.ok, true);
    });
  });

  describe("GET /team", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/team?accountId=${testAccountId}`,
      });
      assert.equal(response.statusCode, 401);
    });

    it("lists team members for account", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/team?accountId=${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data), "Data should be an array");
      assert.ok(body.data.length >= 2, "Should have at least 2 members");

      // Verify DTO shape
      const first = body.data[0];
      assert.ok(first.id, "DTO should have id");
      assert.ok(first.email, "DTO should have email");
      assert.ok(first.name, "DTO should have name");
      assert.ok(first.role, "DTO should have role");
      assert.ok(typeof first.isActive === "boolean", "DTO should have isActive boolean");
      assert.ok(first.joinedAt, "DTO should have joinedAt");
    });

    it("rejects invalid accountId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/team?accountId=not-a-uuid",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.equal(response.statusCode, 400);
    });
  });

  describe("PATCH /team/:id/role", () => {
    let ownerMemberId: string;
    let targetMemberId: string;

    before(async () => {
      // Create an OWNER member for role change tests
      const ownerEmail = `owner-${timestamp}@example.com`;
      const ownerResponse = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: ownerEmail,
          name: "Owner Member",
          role: "OWNER",
        },
      });
      const ownerBody = JSON.parse(ownerResponse.body);
      ownerMemberId = ownerBody.data?.id;

      // Create a target member
      const targetEmail = `target-${timestamp}@example.com`;
      const targetResponse = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: targetEmail,
          name: "Target Member",
          role: "MEMBER",
        },
      });
      const targetBody = JSON.parse(targetResponse.body);
      targetMemberId = targetBody.data?.id;
    });

    it("updates role successfully when changer outranks target", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${targetMemberId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "VIEWER",
          changerMemberId: ownerMemberId,
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data?.updated, true);
    });

    it("rejects role update with insufficient hierarchy", async () => {
      // targetMemberId is now VIEWER, try to use them as changer
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${ownerMemberId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "MEMBER",
          changerMemberId: targetMemberId,
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 403);
      assert.equal(body.ok, false);
    });

    it("returns 404 for non-existent member", async () => {
      const fakeId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${fakeId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "MEMBER",
          changerMemberId: ownerMemberId,
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 404);
      assert.equal(body.ok, false);
    });

    it("rejects invalid role value", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${targetMemberId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "SUPERADMIN",
          changerMemberId: ownerMemberId,
        },
      });

      assert.equal(response.statusCode, 400);
    });
  });

  describe("DELETE /team/:id", () => {
    let removableMemberId: string;
    let ownerForRemovalId: string;

    before(async () => {
      // Create an owner for removal operations
      const ownerEmail = `removal-owner-${timestamp}@example.com`;
      const ownerRes = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: ownerEmail,
          name: "Removal Owner",
          role: "OWNER",
        },
      });
      ownerForRemovalId = JSON.parse(ownerRes.body).data?.id;

      // Create a member to remove
      const removableEmail = `removable-${timestamp}@example.com`;
      const removableRes = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: removableEmail,
          name: "Removable Member",
          role: "MEMBER",
        },
      });
      removableMemberId = JSON.parse(removableRes.body).data?.id;
    });

    it("deactivates a member successfully", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/team/${removableMemberId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          changerMemberId: ownerForRemovalId,
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data?.removed, true);

      // Verify deactivation by listing
      const listResponse = await app.inject({
        method: "GET",
        url: `/team?accountId=${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const listBody = JSON.parse(listResponse.body);
      const removed = listBody.data.find((m: { id: string }) => m.id === removableMemberId);
      assert.ok(removed, "Member should still exist");
      assert.equal(removed.isActive, false, "Member should be inactive");
    });

    it("rejects deactivation of owner", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/team/${ownerForRemovalId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          changerMemberId: ownerForRemovalId,
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 403);
      assert.equal(body.ok, false);
    });

    it("returns 404 for non-existent member", async () => {
      const fakeId = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
      const response = await app.inject({
        method: "DELETE",
        url: `/team/${fakeId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          changerMemberId: ownerForRemovalId,
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 404);
      assert.equal(body.ok, false);
    });
  });
});
