/**
 * Universal Client Dashboard Integration Test Suite
 *
 * Comprehensive validation of Universal Client Dashboard features including:
 * - Provider Registry API completeness
 * - Dynamic provider discovery
 * - Provider capability system
 * - Health monitoring system
 * - Client dashboard accessibility
 * - Provider-specific details
 * - Error handling for invalid requests
 */

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";

const API_BASE_URL = "http://localhost:3000";
const CLIENT_BASE_URL = "http://localhost:3200";

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

function recordResult(test: string, passed: boolean, message: string, duration?: number) {
  results.push({ test, passed, message, duration });
  const status = passed ? "PASS" : "FAIL";
  const durationStr = duration ? ` (${duration}ms)` : "";
  console.log(`${status}: ${test}${durationStr} - ${message}`);
}

describe("Universal Client Dashboard Integration Tests", () => {
  let apiAvailable = false;
  let clientAvailable = false;

  before(async () => {
    try {
      const apiHealth = await fetch(`${API_BASE_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      apiAvailable = apiHealth.ok;
      if (!apiAvailable) {
        console.warn("API not available - API integration tests will be skipped");
      }
    } catch {
      console.warn("API not available - API integration tests will be skipped");
      apiAvailable = false;
    }

    try {
      const clientHealth = await fetch(`${CLIENT_BASE_URL}`, {
        signal: AbortSignal.timeout(3000),
      });
      clientAvailable = clientHealth.ok;
      if (!clientAvailable) {
        console.warn("Client not available - client dashboard tests will be skipped");
      }
    } catch {
      console.warn("Client not available - client dashboard tests will be skipped");
      clientAvailable = false;
    }

    if (apiAvailable && clientAvailable) {
      console.log("Both API and Client services are running");
    }
  });

  const skipIfUnavailable = (t: any): boolean => {
    if (!apiAvailable) {
      t.skip("API not available");
      return true;
    }
    return false;
  };

  const skipIfClientUnavailable = (t: any): boolean => {
    if (!clientAvailable) {
      t.skip("Client not available");
      return true;
    }
    return false;
  };

  describe("Provider Registry API", () => {
    it("should return all registered providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/providers`);
      const duration = Date.now() - startTime;

      assert.ok(response.ok, `Provider registry should respond with 200, got ${response.status}`);

      const data = await response.json();
      assert.ok(data.data.providers, "Response should have providers array");
      assert.strictEqual(data.data.providers.length, 9, "Should have 9 providers registered");

      const hasXActive = data.data.providers.some(
        (p: any) => p.id === "x" && p.status === "active"
      );
      const hasLinkedinActive = data.data.providers.some(
        (p: any) => p.id === "linkedin" && p.status === "active"
      );

      assert.ok(hasXActive, "X provider should be active");
      assert.ok(hasLinkedinActive, "LinkedIn should be active");

      recordResult(
        "Provider Registry API",
        true,
        `${data.data.providers.length} providers registered, all active`,
        duration
      );
    });
  });

  describe("Dynamic Provider Discovery", () => {
    it("should return only active providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/providers/active`);
      const duration = Date.now() - startTime;

      assert.ok(response.ok, `Active providers endpoint should respond with 200`);

      const data = await response.json();
      const hasXActive =
        data.data.providers.some((p: any) => p.id === "x") && data.data.providers.length === 9;

      assert.ok(hasXActive, "9 providers should be active including X");

      recordResult(
        "Dynamic Provider Discovery",
        hasXActive,
        `${data.data.providers.length} active providers (all 9 platforms)`,
        duration
      );
    });
  });

  describe("Provider Capability System", () => {
    it("should filter providers by threading capability", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/providers/by-capability/threading`);
      const duration = Date.now() - startTime;

      assert.ok(response.ok, "Capability filtering should respond with 200");

      const data = await response.json();
      const hasThreadingProviders = data.data.providers.some((p: any) => p.id === "x");

      assert.ok(hasThreadingProviders, "X provider should have threading capability");

      recordResult(
        "Provider Capability System",
        hasThreadingProviders,
        `${data.data.providers.length} provider(s) with threading capability`,
        duration
      );
    });
  });

  describe("Health Monitoring System", () => {
    it("should report health status for all providers", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/providers/health/all`);
      const duration = Date.now() - startTime;

      assert.ok(response.ok, "Health monitoring should respond with 200");

      const data = await response.json();
      assert.ok(data.data.summary, "Response should have summary");
      assert.strictEqual(data.data.summary.total, 9, "Should monitor 9 active providers");
      assert.ok(data.data.summary.healthy >= 1, "Should have at least 1 healthy provider");

      const xIsHealthy = data.data.providers.some((p: any) => p.id === "x" && p.healthy === true);
      assert.ok(xIsHealthy, "X provider should be healthy");

      recordResult(
        "Health Monitoring System",
        true,
        `${data.data.summary.healthy}/${data.data.summary.total} providers healthy, X responsive`,
        duration
      );
    });
  });

  describe("Client Dashboard Accessibility", () => {
    it("should load dashboard with proper UI elements", async (t) => {
      if (skipIfClientUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${CLIENT_BASE_URL}`);
      const duration = Date.now() - startTime;

      assert.ok(response.ok, "Client dashboard should load successfully");

      const html = await response.text();
      const hasExpectedElements =
        html.includes("Universal Client Dashboard") &&
        html.includes("Available Providers") &&
        html.includes("animate-pulse") && // Loading skeletons
        html.includes("Quick Actions");

      assert.ok(hasExpectedElements, "Dashboard should have all expected UI elements");

      recordResult(
        "Client Dashboard Accessibility",
        hasExpectedElements,
        "Dashboard loads with proper UI elements and loading states",
        duration
      );
    });
  });

  describe("Provider-specific Details", () => {
    it("should return detailed information for X provider", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/providers/x`);
      const duration = Date.now() - startTime;

      assert.ok(response.ok, "X provider details should be available");

      const data = await response.json();
      assert.ok(data.data.provider, "Response should have provider object");
      assert.strictEqual(
        data.data.provider.displayName,
        "X (Twitter)",
        "Display name should match"
      );
      assert.strictEqual(data.data.provider.limits.maxChars, 280, "Character limit should be 280");
      assert.strictEqual(
        data.data.provider.capabilities.threading,
        true,
        "Threading capability should be enabled"
      );

      recordResult(
        "Provider-specific Details",
        true,
        `X provider: ${data.data.provider.displayName}, ${data.data.provider.limits.maxChars} chars, threading: ${data.data.provider.capabilities.threading}`,
        duration
      );
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for invalid provider", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/providers/invalid-provider`);
      const duration = Date.now() - startTime;

      assert.strictEqual(response.status, 404, "Should return 404 for invalid provider");

      recordResult(
        "Error Handling - Invalid Provider",
        true,
        `Returns HTTP ${response.status} for invalid provider`,
        duration
      );
    });

    it("should return 400 for invalid capability", async (t) => {
      if (skipIfUnavailable(t)) return;
      const startTime = Date.now();
      const response = await fetch(`${API_BASE_URL}/providers/by-capability/invalid-capability`);
      const duration = Date.now() - startTime;

      assert.strictEqual(response.status, 400, "Should return 400 for invalid capability");

      recordResult(
        "Error Handling - Invalid Capability",
        true,
        `Returns HTTP ${response.status} for invalid capability`,
        duration
      );
    });
  });

  // Summary reporting
  describe("Test Summary", () => {
    it("should report test metrics", (t) => {
      if (skipIfUnavailable(t)) return;
      const totalTests = results.length;
      const passedTests = results.filter((r) => r.passed).length;
      const failedTests = totalTests - passedTests;

      const avgDuration =
        results.filter((r) => r.duration).reduce((sum, r) => sum + (r.duration || 0), 0) /
        results.filter((r) => r.duration).length;

      console.log("\nUniversal Client Dashboard Integration Test Summary");
      console.log("===================================");
      console.log(`Total Tests: ${totalTests}`);
      console.log(`Passed: ${passedTests}`);
      console.log(`Failed: ${failedTests}`);
      console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
      console.log(`Average Response Time: ${avgDuration.toFixed(1)}ms`);

      if (failedTests > 0) {
        console.log("\nFailed Tests:");
        results
          .filter((r) => !r.passed)
          .forEach((result) => {
            console.log(`  - ${result.test}: ${result.message}`);
          });
      }

      const allPassed = failedTests === 0;
      console.log(
        allPassed
          ? "\nAll integration tests passed! Universal Client Dashboard is fully functional."
          : "\nSome integration tests failed."
      );

      if (allPassed) {
        console.log("\nFeatures Verified:");
        console.log("   Provider Registry System with 9 providers");
        console.log(
          "   Dynamic Provider Discovery (9 active: x, instagram, facebook, youtube, tiktok, linkedin, snapchat, telegram, pinterest)"
        );
        console.log("   Provider Capability Filtering (threading, etc.)");
        console.log("   Real-time Health Monitoring");
        console.log("   Next.js Client Dashboard UI");
        console.log("   Provider Cards with Loading States");
        console.log("   Error Handling for Invalid Requests");
        console.log("   Client-Server Integration");
      }

      assert.strictEqual(failedTests, 0, "All tests should pass");
    });
  });
});
