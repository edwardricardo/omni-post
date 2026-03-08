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
 */

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";

const API_BASE = "http://localhost:3000";

// Helper function to make API calls
async function apiCall(method: string, path: string, body?: any) {
  const headers: Record<string, string> = {};
  if (body) {
    headers["Content-Type"] = "application/json";
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
  let apiAvailable = false;

  before(async () => {
    try {
      const response = await fetch("http://localhost:3000/health", {
        signal: AbortSignal.timeout(3000),
      });
      apiAvailable = response.ok;
      if (!apiAvailable) {
        console.warn("API not available - multi-project flow tests will be skipped");
      }
    } catch {
      console.warn("API not available - multi-project flow tests will be skipped");
      apiAvailable = false;
    }

    timestamp = Date.now();
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
      const result = await apiCall("POST", "/accounts", {
        email: `basic-${timestamp}@test.com`,
        name: "Basic Account",
        subscription: "BASIC",
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      assert.strictEqual(result.data.data.maxProjects, 1);

      basicAccountId = result.data.data.id;
    });

    it("should create PRO account with max 3 projects", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", "/accounts", {
        email: `pro-${timestamp}@test.com`,
        name: "Pro Account",
        subscription: "PRO",
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      assert.strictEqual(result.data.data.maxProjects, 3);

      proAccountId = result.data.data.id;
    });

    it("should create ENTERPRISE account with custom project limit", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", "/accounts", {
        email: `enterprise-${timestamp}@test.com`,
        name: "Enterprise Account",
        subscription: "ENTERPRISE",
        maxProjects: 10,
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      assert.strictEqual(result.data.data.maxProjects, 10);

      enterpriseAccountId = result.data.data.id;
    });
  });

  describe("Project Quota Enforcement", () => {
    it("should allow BASIC account to create 1 project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", `/accounts/${basicAccountId}/projects`, {
        name: "Basic Project 1",
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
    });

    it("should reject 2nd project for BASIC account (quota exceeded)", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", `/accounts/${basicAccountId}/projects`, {
        name: "Basic Project 2",
      });

      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.data.error, "QUOTA_EXCEEDED");
    });

    it("should allow PRO account to create 3 projects", async (t) => {
      if (skipIfUnavailable(t)) return;
      const project1 = await apiCall("POST", `/accounts/${proAccountId}/projects`, {
        name: "Pro Project 1",
      });
      const project2 = await apiCall("POST", `/accounts/${proAccountId}/projects`, {
        name: "Pro Project 2",
      });
      const project3 = await apiCall("POST", `/accounts/${proAccountId}/projects`, {
        name: "Pro Project 3",
      });

      assert.strictEqual(project1.status, 200);
      assert.strictEqual(project2.status, 200);
      assert.strictEqual(project3.status, 200);

      // Store project3 ID for later deletion
      project3Id = project3.data.data.id;
    });

    it("should reject 4th project for PRO account (quota exceeded)", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", `/accounts/${proAccountId}/projects`, {
        name: "Pro Project 4",
      });

      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.data.error, "QUOTA_EXCEEDED");
    });
  });

  describe("Project Name Uniqueness", () => {
    it("should enforce unique project names within an account", async (t) => {
      if (skipIfUnavailable(t)) return;
      // First delete one project so we're within quota
      const deleteResult = await apiCall("DELETE", `/projects/${project3Id}`, {});
      assert.strictEqual(deleteResult.status, 200);

      // Try to create duplicate name
      const result = await apiCall("POST", `/accounts/${proAccountId}/projects`, {
        name: "Pro Project 1", // Duplicate name
      });

      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.data.error, "NAME_TAKEN");
    });

    it("should allow same project name in different accounts", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", `/accounts/${enterpriseAccountId}/projects`, {
        name: "Pro Project 1", // Same name, different account
      });

      assert.strictEqual(result.status, 200);
    });
  });

  describe("Account Upgrade Scenarios", () => {
    it("should upgrade BASIC account to PRO", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("PUT", `/accounts/${basicAccountId}`, {
        subscription: "PRO",
        maxProjects: 3,
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.data.subscription, "PRO");
      assert.strictEqual(result.data.data.maxProjects, 3);
    });

    it("should allow creating more projects after upgrade", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", `/accounts/${basicAccountId}/projects`, {
        name: "After Upgrade Project",
      });

      assert.strictEqual(result.status, 200);
    });
  });

  describe("Project Listing", () => {
    it("should list all projects for BASIC account", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("GET", `/accounts/${basicAccountId}/projects`);

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.data.length, 2); // 1 original + 1 after upgrade
    });

    it("should list all projects for PRO account", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("GET", `/accounts/${proAccountId}/projects`);

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.data.length, 2); // 2 after deleting one
    });
  });

  describe("Account Deletion Cascade", () => {
    let deleteAccountId: string;

    it("should create test account with project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const accountResult = await apiCall("POST", "/accounts", {
        email: `testuser${timestamp}@example.com`,
        name: "Test User",
        subscription: "BASIC",
      });

      assert.strictEqual(accountResult.status, 200);
      assert.strictEqual(accountResult.data.ok, true);
      deleteAccountId = accountResult.data.data.id;

      // Create a project
      const _projectResult = await apiCall("POST", `/accounts/${deleteAccountId}/projects`, {
        name: "Will be deleted",
      });
    });

    it("should delete account successfully", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("DELETE", `/accounts/${deleteAccountId}`);
      assert.strictEqual(result.status, 200);
    });

    it("should not find account after deletion", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("GET", `/accounts/${deleteAccountId}`);
      assert.strictEqual(result.status, 404);
    });
  });

  describe("Email Uniqueness", () => {
    it("should reject duplicate email addresses", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", "/accounts", {
        email: `basic-${timestamp}@test.com`, // Same as first account
        name: "Duplicate Email Account",
      });

      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.data.error, "EMAIL_TAKEN");
    });
  });

  describe("Backward Compatibility", () => {
    let demoAccountId: string;

    it("should create demo account for compatibility testing", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", "/accounts", {
        email: `demo-${timestamp}@example.com`,
        name: "Demo Account",
        subscription: "PRO",
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.ok, true);
      demoAccountId = result.data.data.id;
    });

    it("should create demo project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const result = await apiCall("POST", `/accounts/${demoAccountId}/projects`, {
        name: "Demo Project",
      });

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
