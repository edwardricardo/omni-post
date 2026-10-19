/**
 * Multi-Project Flow Tests
 *
 * Tests multi-project account management including:
 * - Accounts created through customer registration
 * - Project quota enforcement, with limits written straight to the database
 * - Project name uniqueness per account
 * - Creating projects after a higher limit is written to the database
 * - Account deletion cascade
 * - Backward compatibility
 *
 * @file multiproject.flow.live.test.ts
 * @description Tests for Multi-Project Flow Tests
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { createSeedPrismaClient } from "./integration/helpers/seedPrismaClient.js";
import {
  checkApiAvailable,
  getBaseUrl,
  liveRegistrationBody,
  registerLiveTenant,
} from "./testUtils.js";

const API_BASE = getBaseUrl();

// Helper function to make API calls
async function apiCall(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = token;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

describe("Multi-Project Flow Tests", () => {
  let timestamp: number;
  let basicAccountId: string;
  let proAccountId: string;
  let enterpriseAccountId: string;
  let project3Id: string; // Store for deletion test
  // Each account is operated with the access token its own registration issued, so every
  // account-scoped call carries a token whose account is the one in the path.
  let basicToken: string;
  let proToken: string;
  let enterpriseToken: string;
  // The owner channel the harness writes fixtures through; see `setProjectLimit`.
  let seedPrisma: PrismaClient;
  let apiAvailable = false;

  before(async () => {
    apiAvailable = await checkApiAvailable();
    if (!apiAvailable) {
      console.warn("API not available - multi-project flow tests will be skipped");
    }

    timestamp = Date.now();
    seedPrisma = createSeedPrismaClient();
  });

  after(async () => {
    await seedPrisma?.$disconnect();
  });

  const skipIfUnavailable = (t: any): boolean => {
    if (!apiAvailable) {
      t.skip("API not available");
      return true;
    }
    return false;
  };

  /**
   * Writes an account's project limit straight to the database through the seed client, then
   * returns the limit the API reports to the account's owner. This is a fixture write: it
   * exercises no API route. The route that sets the limit, `PUT /admin/accounts/:id/settings`,
   * requires an admin session whose CSRF token the API checks against that admin's session row,
   * and the live tier has no admin session to log in with, so the harness writes the column that
   * route writes. A customer cannot write it at all.
   */
  async function setProjectLimit(
    accountId: string,
    ownerToken: string,
    maxProjects: number
  ): Promise<unknown> {
    await seedPrisma.account.update({ where: { id: accountId }, data: { maxProjects } });
    const result = await apiCall("GET", `/accounts/${accountId}`, undefined, ownerToken);
    assert.strictEqual(result.status, 200, `reading the account answered ${result.status}`);
    return result.data.data.maxProjects;
  }

  describe("Account Creation and Project Limits", () => {
    it("registers an account with the BASIC tier's one-project limit", async (t) => {
      if (skipIfUnavailable(t)) return;
      const tenant = await registerLiveTenant({
        email: `basic-${timestamp}@test.com`,
        accountName: "Basic Account",
      });
      basicAccountId = tenant.accountId;
      basicToken = tenant.authorization;

      assert.strictEqual(tenant.account.maxProjects, 1);
    });

    it("registers an account and writes a project limit of 3 to the database", async (t) => {
      if (skipIfUnavailable(t)) return;
      const tenant = await registerLiveTenant({
        email: `pro-${timestamp}@test.com`,
        accountName: "Pro Account",
      });
      proAccountId = tenant.accountId;
      proToken = tenant.authorization;

      assert.strictEqual(await setProjectLimit(proAccountId, proToken, 3), 3);
    });

    it("registers an account and writes a project limit of 10 to the database", async (t) => {
      if (skipIfUnavailable(t)) return;
      const tenant = await registerLiveTenant({
        email: `enterprise-${timestamp}@test.com`,
        accountName: "Enterprise Account",
      });
      enterpriseAccountId = tenant.accountId;
      enterpriseToken = tenant.authorization;

      assert.strictEqual(await setProjectLimit(enterpriseAccountId, enterpriseToken, 10), 10);
    });
  });

  describe("Project Quota Enforcement", () => {
    it("should allow BASIC account to create 1 project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        `/accounts/${basicAccountId}/projects`,
        {
          name: "Basic Project 1",
        },
        basicToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
    });

    it("should reject 2nd project for BASIC account (quota exceeded)", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        `/accounts/${basicAccountId}/projects`,
        {
          name: "Basic Project 2",
        },
        basicToken
      );

      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.data.error, "QUOTA_EXCEEDED");
    });

    it("should allow PRO account to create 3 projects", async (t) => {
      if (skipIfUnavailable(t)) return;
      const project1 = await apiCall(
        "POST",
        `/accounts/${proAccountId}/projects`,
        {
          name: "Pro Project 1",
        },
        proToken
      );
      const project2 = await apiCall(
        "POST",
        `/accounts/${proAccountId}/projects`,
        {
          name: "Pro Project 2",
        },
        proToken
      );
      const project3 = await apiCall(
        "POST",
        `/accounts/${proAccountId}/projects`,
        {
          name: "Pro Project 3",
        },
        proToken
      );

      assert.strictEqual(project1.status, 200);
      assert.strictEqual(project2.status, 200);
      assert.strictEqual(project3.status, 200);

      // Store project3 ID for later deletion
      project3Id = project3.data.data.id;
    });

    it("should reject 4th project for PRO account (quota exceeded)", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        `/accounts/${proAccountId}/projects`,
        {
          name: "Pro Project 4",
        },
        proToken
      );

      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.data.error, "QUOTA_EXCEEDED");
    });
  });

  describe("Project Name Uniqueness", () => {
    it("should enforce unique project names within an account", async (t) => {
      if (skipIfUnavailable(t)) return;
      // A soft delete does NOT free the slot: a deleted project still holds its
      // quota claim, or deletion becomes a quota-farming move (delete, create,
      // restore — a 1-slot plan ends up holding two). Project3 belongs to the
      // PRO account, so its owning token authorizes the tenant-scoped delete.
      const deleteResult = await apiCall("DELETE", `/projects/${project3Id}`, {}, proToken);
      assert.strictEqual(deleteResult.status, 200);

      // Still at quota: the deleted project holds its slot, and the 403 must
      // SAY so — the list shows 2 live projects, the limit says 3 of 3, and
      // without the explanatory fields the tenant cannot reconcile the two.
      const stillBlocked = await apiCall(
        "POST",
        `/accounts/${proAccountId}/projects`,
        { name: "Pro Project 1" },
        proToken
      );
      assert.strictEqual(stillBlocked.status, 403);
      assert.strictEqual(stillBlocked.data.details.error, "QUOTA_EXCEEDED");
      assert.strictEqual(stillBlocked.data.details.used, 3);
      assert.strictEqual(stillBlocked.data.details.limit, 3);
      assert.strictEqual(stillBlocked.data.details.deletedHeld, 1);

      // The slot is released by the second deliberate act: the owner purges the
      // project it already soft-deleted (interlock satisfied), confirming by
      // typing the project's name back.
      const purgeResult = await apiCall(
        "DELETE",
        `/projects/${project3Id}/hard`,
        { reason: "free the quota slot for the uniqueness check", confirmName: "Pro Project 3" },
        proToken
      );
      assert.strictEqual(purgeResult.status, 200);

      // With real headroom the create finally reaches the name check.
      const result = await apiCall(
        "POST",
        `/accounts/${proAccountId}/projects`,
        {
          name: "Pro Project 1", // Duplicate name
        },
        proToken
      );

      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.data.error, "NAME_TAKEN");
    });

    it("should allow same project name in different accounts", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        `/accounts/${enterpriseAccountId}/projects`,
        {
          name: "Pro Project 1", // Same name, different account
        },
        enterpriseToken
      );

      assert.strictEqual(result.status, 200);
    });
  });

  describe("Projects After a Higher Limit Is Written to the Database", () => {
    it("writes a project limit of 3 for the BASIC account to the database", async (t) => {
      if (skipIfUnavailable(t)) return;
      // A fixture write, not an upgrade through the API: see `setProjectLimit`.
      assert.strictEqual(await setProjectLimit(basicAccountId, basicToken, 3), 3);
    });

    it("lets the BASIC account create another project under the higher limit", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        `/accounts/${basicAccountId}/projects`,
        {
          name: "After Upgrade Project",
        },
        basicToken
      );

      assert.strictEqual(result.status, 200);
    });
  });

  describe("Project Listing", () => {
    it("should list all projects for BASIC account", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "GET",
        `/accounts/${basicAccountId}/projects`,
        undefined,
        basicToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.data.length, 2); // 1 original + 1 under the higher limit
    });

    it("should list all projects for PRO account", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "GET",
        `/accounts/${proAccountId}/projects`,
        undefined,
        proToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.data.length, 2); // 2 after deleting one
    });
  });

  describe("Account Deletion Cascade", () => {
    let deleteAccountId: string;
    let deleteToken: string;

    it("should create test account with project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const tenant = await registerLiveTenant({
        email: `testuser${timestamp}@example.com`,
        accountName: "Test User",
      });
      deleteAccountId = tenant.accountId;
      deleteToken = tenant.authorization;

      const projectResult = await apiCall(
        "POST",
        `/accounts/${deleteAccountId}/projects`,
        {
          name: "Will be deleted",
        },
        deleteToken
      );
      assert.strictEqual(projectResult.status, 200);
    });

    it("should delete account successfully", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "DELETE",
        `/accounts/${deleteAccountId}`,
        undefined,
        deleteToken
      );
      assert.strictEqual(result.status, 200);
    });

    it("should not find account after deletion", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("GET", `/accounts/${deleteAccountId}`, undefined, deleteToken);
      assert.strictEqual(result.status, 404);
    });
  });

  describe("Email Uniqueness", () => {
    it("should reject duplicate email addresses", async (t) => {
      if (skipIfUnavailable(t)) return;
      // The case registers its own holder, so it holds whatever ran before it.
      const email = `duplicate-${timestamp}@test.com`;
      await registerLiveTenant({ email, accountName: "Address Holder" });

      const result = await apiCall(
        "POST",
        "/auth/customer/register",
        liveRegistrationBody({ email, accountName: "Duplicate Email Account" })
      );

      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.data.error, "Email already exists");
    });
  });

  describe("Backward Compatibility", () => {
    let demoAccountId: string;
    let demoToken: string;

    it("should create demo account for compatibility testing", async (t) => {
      if (skipIfUnavailable(t)) return;
      const tenant = await registerLiveTenant({
        email: `demo-${timestamp}@example.com`,
        accountName: "Demo Account",
      });

      demoAccountId = tenant.accountId;
      demoToken = tenant.authorization;
    });

    it("should create demo project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        `/accounts/${demoAccountId}/projects`,
        {
          name: "Demo Project",
        },
        demoToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
    });

    it("should verify health endpoint responds correctly", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("GET", "/health");

      assert.strictEqual(result.status, 200);
      assert.strictEqual(typeof result.data.status, "string");
    });
  });
});
