/**
 * Multi-Project Flow Tests
 *
 * Tests multi-project account management including:
 * - Account creation with different subscription tiers
 * - Project quota enforcement
 * - Project name uniqueness per account
 * - Account upgrade scenarios
 * - Account deletion cascade
 * - Backward compatibility
 *
 * @file multiproject.flow.test.ts
 * @description Tests for Multi-Project Flow Tests
 * @layer infrastructure
 */

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import { signCustomerAccessToken } from "../src/auth/customerJwt.js";
import { checkApiAvailable, getBaseUrl } from "./testUtils.js";

const API_BASE = getBaseUrl();

/**
 * Mints a customer Bearer token bound to `accountId`. Account-scoped routes
 * (`/accounts/:id/projects`, `/projects/:id`, ...) sit behind `requireClientAuth`
 * and the tenant guard rejects a write whose path accountId mismatches the
 * token's accountId, so each account must be operated with a token bound to it.
 */
const bearer = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `prod-test-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

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
  // Per-account tokens — minted after each account is created so tenant-scoped
  // operations carry a token whose accountId matches the resource's accountId.
  let basicToken: string;
  let proToken: string;
  let enterpriseToken: string;
  // Token for un-scoped account creation (POST /accounts is not tenant-scoped).
  let bootstrapToken: string;
  let apiAvailable = false;

  before(async () => {
    apiAvailable = await checkApiAvailable();
    if (!apiAvailable) {
      console.warn("API not available - multi-project flow tests will be skipped");
    }

    timestamp = Date.now();
    bootstrapToken = bearer("prod-multiproject-bootstrap");
  });

  const skipIfUnavailable = (t: any): boolean => {
    if (!apiAvailable) {
      t.skip("API not available");
      return true;
    }
    return false;
  };

  describe("Account Creation with Different Tiers", () => {
    it("should create BASIC account with max 1 project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        "/accounts",
        {
          email: `basic-${timestamp}@test.com`,
          name: "Basic Account",
          subscription: "BASIC",
        },
        bootstrapToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      assert.strictEqual(result.data.data.maxProjects, 1);

      basicAccountId = result.data.data.id;
      basicToken = bearer(basicAccountId);
    });

    it("should create PRO account with max 3 projects", async (t) => {
      if (skipIfUnavailable(t)) return;
      // Project quota is governed solely by the account's `maxProjects` field;
      // there is no subscription-tier → quota mapping on the account route, so
      // a PRO-tier limit of 3 is expressed by passing maxProjects explicitly.
      const result = await apiCall(
        "POST",
        "/accounts",
        {
          email: `pro-${timestamp}@test.com`,
          name: "Pro Account",
          maxProjects: 3,
        },
        bootstrapToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      assert.strictEqual(result.data.data.maxProjects, 3);

      proAccountId = result.data.data.id;
      proToken = bearer(proAccountId);
    });

    it("should create ENTERPRISE account with custom project limit", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        "/accounts",
        {
          email: `enterprise-${timestamp}@test.com`,
          name: "Enterprise Account",
          maxProjects: 10,
        },
        bootstrapToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      assert.strictEqual(result.data.data.maxProjects, 10);

      enterpriseAccountId = result.data.data.id;
      enterpriseToken = bearer(enterpriseAccountId);
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
      // First delete one project so we're within quota. Project3 belongs to the
      // PRO account, so its owning token authorizes the tenant-scoped delete.
      const deleteResult = await apiCall("DELETE", `/projects/${project3Id}`, {}, proToken);
      assert.strictEqual(deleteResult.status, 200);

      // Try to create duplicate name
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

  describe("Account Upgrade Scenarios", () => {
    it("should upgrade BASIC account to PRO", async (t) => {
      if (skipIfUnavailable(t)) return;
      // "Upgrading to PRO" is modelled by raising the account's project quota;
      // the account has no `subscription` field, so the upgrade asserts the new
      // maxProjects rather than a tier label.
      const result = await apiCall(
        "PUT",
        `/accounts/${basicAccountId}`,
        {
          maxProjects: 3,
        },
        basicToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.data.maxProjects, 3);
    });

    it("should allow creating more projects after upgrade", async (t) => {
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
      assert.strictEqual(result.data.data.length, 2); // 1 original + 1 after upgrade
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
      const accountResult = await apiCall(
        "POST",
        "/accounts",
        {
          email: `testuser${timestamp}@example.com`,
          name: "Test User",
          subscription: "BASIC",
        },
        bootstrapToken
      );

      assert.strictEqual(accountResult.status, 200);
      assert.strictEqual(accountResult.data.ok, true);
      deleteAccountId = accountResult.data.data.id;
      deleteToken = bearer(deleteAccountId);

      // Create a project
      const _projectResult = await apiCall(
        "POST",
        `/accounts/${deleteAccountId}/projects`,
        {
          name: "Will be deleted",
        },
        deleteToken
      );
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
      const result = await apiCall(
        "POST",
        "/accounts",
        {
          email: `basic-${timestamp}@test.com`, // Same as first account
          name: "Duplicate Email Account",
        },
        bootstrapToken
      );

      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.data.error, "EMAIL_TAKEN");
    });
  });

  describe("Backward Compatibility", () => {
    let demoAccountId: string;
    let demoToken: string;

    it("should create demo account for compatibility testing", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall(
        "POST",
        "/accounts",
        {
          email: `demo-${timestamp}@example.com`,
          name: "Demo Account",
          subscription: "PRO",
        },
        bootstrapToken
      );

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      demoAccountId = result.data.data.id;
      demoToken = bearer(demoAccountId);
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
