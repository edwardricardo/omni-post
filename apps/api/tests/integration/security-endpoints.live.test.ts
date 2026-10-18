/**
 * Integration Tests for Security Endpoints
 * Testing REAL endpoints with REAL validation
 *
 * These tests validate the actual HTTP layer with live server.
 * Requires the API server to be running on localhost:3000.
 *
 * @file security-endpoints.live.test.ts
 * @description Tests for Security Endpoints Integration
 * @layer infrastructure
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { RateLimitConfigs } from "../../src/security/httpRateLimitPreHandler.js";
import {
  checkApiAvailable,
  getBaseUrl,
  liveRegistrationBody,
  registerLiveTenant,
  requireLiveTenant,
  type LiveTenant,
} from "../testUtils.js";

const API_URL = getBaseUrl();

/**
 * Sends a registration body exactly as given, so a case can send one that is not valid JSON.
 * @param body - The raw request body.
 * @returns The route's response.
 */
async function postRegistration(body: string): Promise<Response> {
  return fetch(`${API_URL}/auth/customer/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("Security Endpoints Integration", { concurrency: 1 }, () => {
  let apiAvailable = false;
  // The tenant whose own account name the validation cases try to write: the account name its
  // owner changes with `PUT /accounts/:accountId` runs through the security validator. Every case
  // that uses it is refused, so none changes what another reads. Unset when the API is absent.
  let tenant: LiveTenant | undefined;

  before(async () => {
    apiAvailable = await checkApiAvailable();
    if (!apiAvailable) {
      // stdout is the node:test runner's message channel; diagnostics go to stderr (DEF-83).
      console.error("API server not running - security endpoint tests will be skipped");
      return;
    }
    tenant = await registerLiveTenant({
      email: `security-endpoints-${Date.now()}@example.com`,
      accountName: `Security Endpoints ${Date.now()}`,
    });
  });

  /**
   * Sends a rename of the tenant's own account.
   * @param name - The name the rename asks for.
   * @returns The route's response.
   */
  async function renameOwnAccount(name: string): Promise<Response> {
    const owner = requireLiveTenant(tenant, "Security Endpoints Integration");
    return fetch(`${API_URL}/accounts/${owner.accountId}`, {
      method: "PUT",
      headers: { Authorization: owner.authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  // ==========================================================================
  // Test Group 1: Health Check
  // ==========================================================================

  describe("Health Check", () => {
    it("should return 200 OK from health endpoint", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/health`);
      const data = await response.json();

      assert.equal(response.status, 200, "Health endpoint returns 200 OK");
      assert.notEqual(data.status, undefined, "Health response includes status");
    });
  });

  // ==========================================================================
  // Test Group 2: Account Creation with Validation
  // ==========================================================================

  describe("Account Creation with Validation", () => {
    it("should create account with valid data", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await postRegistration(
        JSON.stringify(
          liveRegistrationBody({
            email: `test-security-${Date.now()}@example.com`,
            accountName: "Test User",
          })
        )
      );

      const data = await response.json();

      assert.equal(response.status, 201, "Valid registration returns 201");
      assert.equal(data.ok, true, "Response ok is true");
      assert.ok(data.data?.account?.id, "Registration returns the account ID in {ok, data} format");
    });

    it("should reject duplicate email with 409", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const duplicateEmail = `duplicate-sec-${Date.now()}@example.com`;

      // Create first account
      const first = await postRegistration(
        JSON.stringify(liveRegistrationBody({ email: duplicateEmail, accountName: "First" }))
      );
      await first.body?.cancel();
      assert.equal(first.status, 201, "The first registration of the address succeeds");

      // Try to create duplicate
      const response = await postRegistration(
        JSON.stringify(liveRegistrationBody({ email: duplicateEmail, accountName: "Second" }))
      );
      const data = await response.json();

      assert.equal(response.status, 409, "Duplicate email returns 409 Conflict");
      assert.equal(data.error, "Email already exists", "The refusal names the held address");
    });
  });

  // ==========================================================================
  // Test Group 3: Rate Limiting
  // ==========================================================================

  describe("Rate Limiting", () => {
    it("should allow 5 requests within rate limit", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const responses = [];

      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${API_URL}/health`);
        responses.push(response.status);
      }

      assert.ok(
        responses.every((status) => status === 200),
        "5 requests within limit all succeed"
      );
    });

    it("should include the rate limit headers on /health", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // The limiter charges `/health` to the HEALTH bucket and answers with what is left in it and
      // the epoch milliseconds at which it is full again; it sends no limit header.
      const { maxRequests, windowMs } = RateLimitConfigs.HEALTH;
      const response = await fetch(`${API_URL}/health`);
      await response.body?.cancel();
      const remaining = Number(response.headers.get("x-ratelimit-remaining"));
      const resetAtMs = Number(response.headers.get("x-ratelimit-reset"));
      const now = Date.now();

      assert.equal(response.status, 200, "/health answers inside its bucket");
      assert.ok(
        Number.isInteger(remaining) && remaining >= 0 && remaining < maxRequests,
        `X-RateLimit-Remaining is a count left in the ${maxRequests}-permit bucket, got ${remaining}`
      );
      assert.ok(
        Number.isInteger(resetAtMs) && resetAtMs >= now - 1_000 && resetAtMs <= now + windowMs,
        `X-RateLimit-Reset is an epoch-milliseconds instant within one window, got ${resetAtMs}`
      );
    });
  });

  // ==========================================================================
  // Test Group 4: Error Handling
  // ==========================================================================

  describe("Error Handling", () => {
    it("should return 404 for non-existent endpoint", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/nonexistent-endpoint-${Date.now()}`);
      assert.equal(response.status, 404, "Non-existent endpoint returns 404");
    });

    it("should handle malformed JSON", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await postRegistration("{ this is not valid json }");
      await response.body?.cancel();

      assert.equal(response.status, 400, "Malformed JSON is refused with 400");
    });
  });

  // ==========================================================================
  // Test Group 5: SQL Injection Prevention
  // ==========================================================================

  describe("SQL Injection Prevention", () => {
    it("should handle SQL injection attempt safely", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await postRegistration(
        JSON.stringify(
          liveRegistrationBody({
            email: `test@example.com'; DROP TABLE accounts; --`,
            accountName: "Malicious' OR '1'='1",
          })
        )
      );
      await response.body?.cancel();

      // The injected address is not an e-mail, so validation refuses it before any query runs.
      assert.equal(response.status, 400, "SQL injection in the e-mail is refused by validation");
    });
  });

  // ==========================================================================
  // Test Group 6: XSS Prevention
  // ==========================================================================

  describe("XSS Prevention", () => {
    it("should reject XSS in account name with 400", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await renameOwnAccount("<script>alert('XSS')</script>");

      const data = await response.json();

      assert.equal(response.status, 400, "XSS attempt REJECTED by server with 400 Bad Request");
      assert.equal(data.ok, false, "XSS attempt returns error response");
    });
  });

  // ==========================================================================
  // Test Group 7: Server Resilience
  // ==========================================================================

  describe("Server Resilience", () => {
    it("should handle large payload appropriately", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await renameOwnAccount("A".repeat(10000)); // 10KB name
      await response.body?.cancel();

      // The name limit is 256 characters, far below the body limit, so validation refuses it.
      assert.equal(response.status, 400, "An oversized account name is refused with 400");
    });

    it("should handle 10 concurrent requests successfully", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(fetch(`${API_URL}/health`).then((r) => r.status));
      }

      const statuses = await Promise.all(promises);

      assert.ok(
        statuses.every((s) => s === 200),
        "Server handles 10 concurrent requests successfully"
      );
    });
  });
});
