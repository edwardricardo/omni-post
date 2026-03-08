#!/usr/bin/env tsx
/**
 * Unit Tests for accountRoutes
 * Testing all account management HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { accountRoutes } from "../../src/accounts/accountRoutes.js";
import { prisma } from "@infra/prisma";

// Create test Fastify instance
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  await typedApp.register(accountRoutes);

  return typedApp;
}

const timestamp = Date.now();
const testEmail = `test-account-${timestamp}@example.com`;
const testName = "Test Account User";

let app: FastifyInstance;
let testAccountId: string;

describe("accountRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    try {
      // Cleanup test accounts
      const testAccounts = await prisma.account.findMany({
        where: { email: { contains: `test-account-${timestamp}` } },
      });

      for (const account of testAccounts) {
        await prisma.project.deleteMany({ where: { accountId: account.id } });
        await prisma.account.delete({ where: { id: account.id } });
      }
    } catch (err) {
      console.warn("Cleanup warning:", err);
    }

    await app.close();
  });

  describe("POST /accounts", () => {
    it("should create account successfully with defaults", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: testEmail,
          name: testName,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.id);
      assert.strictEqual(body.data?.email, testEmail);
      assert.strictEqual(body.data?.name, testName);
      assert.strictEqual(body.data?.subscription, "BASIC");
      assert.strictEqual(body.data?.maxProjects, 1); // BASIC tier default
      assert.strictEqual(body.data?.isOnTrial, true);

      testAccountId = body.data?.id || "";
    });

    it("should create PRO account with correct maxProjects", async () => {
      const proEmail = `pro-${testEmail}`;
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: proEmail,
          name: testName,
          subscription: "PRO",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.subscription, "PRO");
      assert.strictEqual(body.data?.maxProjects, 3); // PRO tier default
    });

    it("should create ENTERPRISE account with correct maxProjects", async () => {
      const enterpriseEmail = `enterprise-${testEmail}`;
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: enterpriseEmail,
          name: testName,
          subscription: "ENTERPRISE",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.subscription, "ENTERPRISE");
      assert.strictEqual(body.data?.maxProjects, 10); // ENTERPRISE tier default
    });

    it("should create account with custom maxProjects", async () => {
      const customEmail = `custom-${testEmail}`;
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: customEmail,
          name: testName,
          subscription: "PRO",
          maxProjects: 5,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.maxProjects, 5); // Custom value
    });

    it("should reject duplicate email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: testEmail,
          name: testName,
        },
      });

      assert.strictEqual(response.statusCode, 409);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.error, "EMAIL_TAKEN");
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: "invalid-email",
          name: testName,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject missing email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          name: testName,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject missing name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `missing-name-${testEmail}`,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject invalid subscription tier", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `invalid-sub-${testEmail}`,
          name: testName,
          subscription: "INVALID_TIER",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject negative maxProjects", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `negative-max-${testEmail}`,
          name: testName,
          maxProjects: -1,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject zero maxProjects", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `zero-max-${testEmail}`,
          name: testName,
          maxProjects: 0,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /accounts/:accountId", () => {
    it("should get account by ID successfully", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data?.id, testAccountId);
      assert.strictEqual(body.data?.email, testEmail);
      assert.strictEqual(body.data?.name, testName);
      assert.ok(Array.isArray(body.data?.projects));
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/a0000000-0000-4000-8000-000000000000",
      });

      assert.strictEqual(response.statusCode, 404);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should reject invalid account ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/not-a-uuid",
      });

      assert.strictEqual(response.statusCode, 400); // Invalid UUID format
    });
  });

  describe("GET /accounts", () => {
    it("should list all accounts successfully", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts",
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data));
      assert.ok(body.data.length > 0);

      const account = body.data.find((a: any) => a.id === testAccountId);
      assert.ok(account);
      assert.strictEqual(account.email, testEmail);
      assert.strictEqual(typeof account.projectCount, "number");
    });

    it("should return accounts ordered by createdAt desc", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts",
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(body.data.length >= 2);

      // Verify descending order
      for (let i = 0; i < body.data.length - 1; i++) {
        const current = new Date(body.data[i].createdAt);
        const next = new Date(body.data[i + 1].createdAt);
        assert.ok(current >= next, "Accounts should be ordered by createdAt desc");
      }
    });
  });

  describe("PUT /accounts/:accountId", () => {
    it("should update account name successfully", async () => {
      const newName = "Updated Account Name";
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          name: newName,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data?.name, newName);
      assert.strictEqual(body.data?.id, testAccountId);
    });

    it("should update account subscription tier", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          subscription: "PRO",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.subscription, "PRO");
      assert.strictEqual(body.data?.maxProjects, 3); // Auto-updated to PRO default
    });

    it("should update maxProjects explicitly", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          maxProjects: 7,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.maxProjects, 7);
    });

    it("should update subscription without overriding explicit maxProjects", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          subscription: "ENTERPRISE",
          maxProjects: 15,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.subscription, "ENTERPRISE");
      assert.strictEqual(body.data?.maxProjects, 15); // Explicit value preserved
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/accounts/a0000000-0000-4000-8000-000000000000",
        payload: {
          name: "New Name",
        },
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it("should reject invalid subscription tier", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          subscription: "INVALID_TIER",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject negative maxProjects", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          maxProjects: -1,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should handle empty update payload", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {},
      });

      // Should succeed with no changes
      assert.strictEqual(response.statusCode, 200);
    });
  });

  describe("DELETE /accounts/:accountId", () => {
    let deleteAccountId: string;

    before(async () => {
      // Create account to delete
      const createResponse = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `removal-${testEmail}`,
          name: "To Be Removed",
        },
      });

      const body = JSON.parse(createResponse.body);
      deleteAccountId = body.data?.id || "";
    });

    it("should delete account successfully", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${deleteAccountId}`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.message);
    });

    it("should verify account is deleted", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${deleteAccountId}`,
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it("should return 404 when deleting non-existent account", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/accounts/a0000000-0000-4000-8000-000000000000",
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it("should return 404 when deleting already deleted account", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${deleteAccountId}`,
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });
});
