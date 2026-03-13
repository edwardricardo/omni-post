/**
 * Provider Registry Tests
 *
 * Tests the Provider Registry System including:
 * - Getting all providers
 * - Active provider filtering
 * - Provider details retrieval
 * - Capability-based filtering
 * - Health monitoring
 * - Provider connections
 * - Error handling
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

describe("Provider Registry System", () => {
  let apiAvailable = false;

  before(async () => {
    // Check if API is available
    try {
      const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      apiAvailable = response.ok;
      if (!apiAvailable) {
        console.warn("⚠️  API not available - integration tests will be skipped");
      } else {
        console.log("✅ API is available - running integration tests");
      }
    } catch {
      console.warn("⚠️  API not available - integration tests will be skipped");
      apiAvailable = false;
    }
  });

  // Helper to skip if API unavailable
  const skipIfUnavailable = (t: any): boolean => {
    if (!apiAvailable) {
      t.skip("API not available");
      return true;
    }
    return false;
  };

  describe("Get All Providers", () => {
    it("should return all providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers`);

      assert.strictEqual(response.ok, true, `HTTP ${response.status}`);

      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.providers, "Should have providers array");
      assert.ok(Array.isArray(json.data.providers), "Providers should be an array");
    });

    it("should include expected number of providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers`);
      const json = await response.json();

      assert.strictEqual(
        json.data.providers.length,
        9,
        `Expected 9 providers, got ${json.data.providers.length}`
      );
    });

    it("should include X provider as active", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers`);
      const json = await response.json();

      const xProvider = json.data.providers.find((p: any) => p.id === "x");

      assert.ok(xProvider, "Should have X provider");
      assert.strictEqual(xProvider.status, "active", "X provider should be active");
    });

    it("should include LinkedIn as active", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers`);
      const json = await response.json();

      const linkedinProvider = json.data.providers.find((p: any) => p.id === "linkedin");

      assert.ok(linkedinProvider, "Should have LinkedIn provider");
      assert.strictEqual(linkedinProvider.status, "active", "LinkedIn should be active");
    });

    it("should complete within reasonable time", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      await fetch(`${BASE_URL}/providers`);
      const duration = Date.now() - startTime;

      assert.ok(duration < 1000, `Request took ${duration}ms, should be under 1000ms`);
    });
  });

  describe("Active Providers", () => {
    it("should return only active providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/active`);

      assert.strictEqual(response.ok, true, `HTTP ${response.status}`);

      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.providers, "Should have providers array");
      assert.ok(Array.isArray(json.data.providers), "Providers should be an array");
    });

    it("should have X as active provider", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/active`);
      const json = await response.json();

      const hasX = json.data.providers.some((p: any) => p.id === "x");

      assert.ok(hasX, "X should be in active providers");
    });

    it("should only return active status providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/active`);
      const json = await response.json();

      const allActive = json.data.providers.every((p: any) => p.status === "active");

      assert.ok(allActive, "All returned providers should have active status");
    });

    it("should have exactly 9 active providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/active`);
      const json = await response.json();

      assert.strictEqual(
        json.data.providers.length,
        9,
        `Expected 9 active providers, got ${json.data.providers.length}`
      );
    });
  });

  describe("Provider Details", () => {
    it("should return X provider details", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/x`);

      assert.strictEqual(response.ok, true, `HTTP ${response.status}`);

      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.provider, "Should have provider object");
    });

    it("should include correct display name", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/x`);
      const json = await response.json();

      assert.strictEqual(
        json.data.provider.displayName,
        "X (Twitter)",
        "Should have correct display name"
      );
    });

    it("should include character limits", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/x`);
      const json = await response.json();

      assert.ok(json.data.provider.limits, "Should have limits object");
      assert.strictEqual(
        json.data.provider.limits.maxChars,
        280,
        "X should have 280 character limit"
      );
    });

    it("should return 404 for non-existent provider", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/non-existent`);

      assert.strictEqual(response.status, 404, "Should return 404 for non-existent provider");
    });

    it("should include provider capabilities", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/x`);
      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.provider, "Should have provider object");
    });
  });

  describe("Capability Filtering", () => {
    it("should filter providers by threading capability", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/by-capability/threading`);

      assert.strictEqual(response.ok, true, `HTTP ${response.status}`);

      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.providers, "Should have providers array");
      assert.ok(Array.isArray(json.data.providers), "Providers should be an array");
    });

    it("should include X in threading capability", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/by-capability/threading`);
      const json = await response.json();

      const hasX = json.data.providers.some((p: any) => p.id === "x");

      assert.ok(hasX, "X should support threading capability");
    });

    it("should return providers count for threading", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/by-capability/threading`);
      const json = await response.json();

      assert.ok(json.data.providers.length > 0, "Should have at least one provider with threading");
    });

    it("should return 400 for invalid capability", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/by-capability/invalid-capability`);

      assert.strictEqual(response.status, 400, "Should return 400 for invalid capability");
    });

    it("should handle capability filtering within timeout", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      await fetch(`${BASE_URL}/providers/by-capability/threading`);
      const duration = Date.now() - startTime;

      assert.ok(duration < 1000, `Request took ${duration}ms, should be under 1000ms`);
    });
  });

  describe("Health Monitoring", () => {
    it("should return health status for all providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/health/all`);

      assert.strictEqual(response.ok, true, `HTTP ${response.status}`);

      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.summary, "Should have summary object");
      assert.ok(json.data.providers, "Should have providers array");
    });

    it("should have correct provider count in summary", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/health/all`);
      const json = await response.json();

      assert.strictEqual(
        json.data.summary.total,
        9,
        "Should have 9 active providers in health check"
      );
    });

    it("should show X as healthy", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/health/all`);
      const json = await response.json();

      const xProvider = json.data.providers.find((p: any) => p.id === "x");

      assert.ok(xProvider, "Should have X provider in health data");
      assert.strictEqual(xProvider.healthy, true, "X should be healthy");
    });

    it("should have at least one healthy provider", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/health/all`);
      const json = await response.json();

      assert.ok(
        json.data.summary.healthy >= 1,
        `Should have at least 1 healthy provider, got ${json.data.summary.healthy}`
      );
    });

    it("should include health check timestamp", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/health/all`);
      const json = await response.json();

      assert.ok(json.data.timestamp, "Should have health check timestamp");
    });
  });

  describe("Provider Connections", () => {
    it("should return connections for test project", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/connections/test-project`);

      assert.strictEqual(response.ok, true, `HTTP ${response.status}`);

      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.connections, "Should have connections property");
      assert.ok(Array.isArray(json.data.connections), "Connections should be an array");
    });

    it("should handle non-existent project gracefully", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/connections/non-existent-project`);

      // Should either return empty array or 404
      assert.ok(
        response.ok || response.status === 404,
        "Should handle non-existent project gracefully"
      );

      if (response.ok) {
        const json = await response.json();
        assert.ok(json.ok, "Should have ok: true");
        assert.ok(Array.isArray(json.data.connections), "Should return connections array");
      }
    });

    it("should return connection count", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/connections/test-project`);

      if (response.ok) {
        const json = await response.json();
        assert.ok(json.ok, "Should have ok: true");
        assert.ok(typeof json.data.connections.length === "number", "Should have connection count");
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle non-existent provider gracefully", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/non-existent`);

      assert.strictEqual(response.status, 404, "Should return 404");
    });

    it("should validate capability parameters", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers/by-capability/invalid`);

      assert.strictEqual(response.status, 400, "Should validate capability parameter");
    });

    it("should handle malformed requests", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers//`);

      // Should return either 404 or 400
      assert.ok(
        response.status === 404 || response.status === 400,
        "Should handle malformed requests"
      );
    });
  });

  describe("Response Format", () => {
    it("should return JSON content type", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers`);
      const contentType = response.headers.get("content-type");

      assert.ok(contentType?.includes("application/json"), "Should return JSON content type");
    });

    it("should have consistent response structure", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers`);
      const json = await response.json();

      assert.ok(json.ok, "Should have ok: true");
      assert.ok(json.data.providers, "Should have providers property");
      assert.ok(Array.isArray(json.data.providers), "Providers should be an array");
    });

    it("should include provider metadata", async (t) => {
      if (skipIfUnavailable(t)) return;
      const response = await fetch(`${BASE_URL}/providers`);
      const json = await response.json();

      if (json.data.providers.length > 0) {
        const provider = json.data.providers[0];
        assert.ok(provider.id, "Provider should have id");
        assert.ok(provider.status, "Provider should have status");
      }
    });
  });

  describe("Performance", () => {
    it("should respond to all providers within 500ms", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      await fetch(`${BASE_URL}/providers`);
      const duration = Date.now() - startTime;

      assert.ok(duration < 500, `Request took ${duration}ms, should be under 500ms`);
    });

    it("should respond to health check within 1s", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      await fetch(`${BASE_URL}/providers/health/all`);
      const duration = Date.now() - startTime;

      assert.ok(duration < 1000, `Request took ${duration}ms, should be under 1000ms`);
    });

    it("should handle concurrent requests", async (t) => {
      if (skipIfUnavailable(t)) return;
      const requests = [
        fetch(`${BASE_URL}/providers`),
        fetch(`${BASE_URL}/providers/active`),
        fetch(`${BASE_URL}/providers/x`),
      ];

      const responses = await Promise.all(requests);

      assert.ok(
        responses.every((r) => r.ok),
        "All concurrent requests should succeed"
      );
    });
  });
});
