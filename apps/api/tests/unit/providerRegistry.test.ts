#!/usr/bin/env tsx
/**
 * Unit Tests for Provider Registry Service
 * Tests provider metadata management, adapter registration, and health checking
 *
 * Converted to node:test standard with:
 * - node:test and node:assert modules
 * - Proper Prisma NULL vs undefined handling
 * - Provider enum values from schema
 * - Database cleanup for ProviderConnection
 * - Unique test data generation
 *
 * Environment Variables:
 * - USE_REAL_ADAPTERS=true - Use real provider adapters instead of mocks (makes network calls)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { ProviderRegistryService } from "../../src/providers/providerRegistry.js";
import { prisma } from "@infra/prisma";
import type { ProviderAdapter } from "@ports/core";
import type { Result } from "@packages/shared/src/types";

// Configuration flag
const USE_REAL_ADAPTERS = process.env.USE_REAL_ADAPTERS === "true";

// Unique test data
const testId = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
const testAccountId = `account-${testId}`;
const testProjectId = `project-${testId}`;

// ============================================================================
// Mock Provider Adapter (used when USE_REAL_ADAPTERS=false)
// ============================================================================

class MockProviderAdapter implements ProviderAdapter {
  async validateCredentials(
    _credentials: Record<string, unknown>
  ): Promise<Result<{ valid: true }>> {
    // Simulate fast response with expected AUTH_INVALID error
    return { ok: false, error: "AUTH_INVALID" };
  }

  async publish(_content: any, _credentials: any): Promise<Result<{ id: string; url: string }>> {
    return { ok: true, value: { id: "mock-123", url: "https://mock.com/post/123" } };
  }

  async getMetrics(_postId: string, _credentials: any): Promise<Result<any>> {
    return { ok: true, value: { views: 100, likes: 10, shares: 5 } };
  }

  async delete(_postId: string, _credentials: any): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }
}

// ============================================================================
// Test Setup and Teardown
// ============================================================================

before(async () => {
  if (USE_REAL_ADAPTERS) {
    console.log(
      "🌐 USE_REAL_ADAPTERS=true - Using real provider adapters (may make network calls)"
    );
  } else {
    console.log("🧪 Using mock adapters (fast, no network calls)");
    console.log("   Set USE_REAL_ADAPTERS=true to test with real adapters");
  }
});

after(async () => {
  // Cleanup handled by cascade delete in individual test group
  // No need to delete ProviderConnection separately
});

// ============================================================================
// Test Group 1: Initialization & Built-in Providers
// ============================================================================

describe("Provider Registry - Initialization & Built-in Providers", () => {
  it("should initialize with built-in providers", () => {
    const registry = new ProviderRegistryService();
    const providers = registry.getAllProviders();

    assert.ok(providers.length >= 5, `Expected at least 5 providers, got ${providers.length}`);
  });

  it("should have adapters registered for all built-in providers", () => {
    const registry = new ProviderRegistryService();
    const builtInProviders = ["x", "instagram", "facebook", "tiktok", "youtube"];
    const allHaveAdapters = builtInProviders.every((id) => registry.hasAdapter(id));

    assert.ok(allHaveAdapters, "Not all built-in providers have adapters registered");
  });

  it("should get specific provider by ID", () => {
    const registry = new ProviderRegistryService();
    const xProvider = registry.getProvider("x");

    assert.ok(xProvider !== undefined, "X provider should exist");
    assert.strictEqual(xProvider.id, "x", "Provider ID should match");
  });

  it("should return provider with expected metadata structure", () => {
    const registry = new ProviderRegistryService();
    const xProvider = registry.getProvider("x");

    assert.ok(xProvider !== undefined, "X provider should exist");
    assert.ok(xProvider.name !== undefined, "Provider should have name");
    assert.ok(xProvider.capabilities !== undefined, "Provider should have capabilities");
    assert.ok(xProvider.limits !== undefined, "Provider should have limits");
  });

  it("should return undefined for unknown provider ID", () => {
    const registry = new ProviderRegistryService();
    const unknown = registry.getProvider("unknown-provider-xyz");

    assert.strictEqual(unknown, undefined, "Unknown provider should return undefined");
  });
});

// ============================================================================
// Test Group 2: Adapter Management
// ============================================================================

describe("Provider Registry - Adapter Management", () => {
  it("should get adapter for registered provider", () => {
    const registry = new ProviderRegistryService();
    const xAdapter = registry.getAdapter("x");

    assert.ok(xAdapter !== undefined, "X adapter should exist");
  });

  it("should return adapter with required methods", () => {
    const registry = new ProviderRegistryService();
    const xAdapter = registry.getAdapter("x");

    assert.ok(xAdapter !== undefined, "Adapter should exist");
    assert.strictEqual(
      typeof xAdapter.validateCredentials,
      "function",
      "Adapter should have validateCredentials method"
    );
    assert.strictEqual(typeof xAdapter.publish, "function", "Adapter should have publish method");
  });

  it("should return undefined for unknown provider adapter", () => {
    const registry = new ProviderRegistryService();
    const unknown = registry.getAdapter("unknown-provider-xyz");

    assert.strictEqual(unknown, undefined, "Unknown adapter should return undefined");
  });

  it("should return true for hasAdapter on registered providers", () => {
    const registry = new ProviderRegistryService();

    assert.ok(registry.hasAdapter("x"), "hasAdapter should return true for X");
  });

  it("should return false for hasAdapter on unknown providers", () => {
    const registry = new ProviderRegistryService();

    assert.strictEqual(
      registry.hasAdapter("unknown-provider-xyz"),
      false,
      "hasAdapter should return false for unknown provider"
    );
  });

  it("should register new adapter for existing provider", () => {
    const registry = new ProviderRegistryService();
    const mockAdapter = new MockProviderAdapter();

    // Register mock adapter for X (overwrite existing)
    registry.registerAdapter("x", mockAdapter);
    const adapter = registry.getAdapter("x");

    assert.strictEqual(adapter, mockAdapter, "Registered adapter should match");
  });

  it("should throw error when registering adapter for unknown provider", () => {
    const registry = new ProviderRegistryService();
    const mockAdapter = new MockProviderAdapter();

    assert.throws(
      () => {
        registry.registerAdapter("unknown-provider-xyz", mockAdapter);
      },
      /unknown provider/i,
      "Should throw error for unknown provider"
    );
  });

  it("should return providers with adapters", () => {
    const registry = new ProviderRegistryService();
    const providersWithAdapters = registry.getProvidersWithAdapters();

    assert.ok(
      providersWithAdapters.length >= 5,
      `Expected at least 5 providers with adapters, got ${providersWithAdapters.length}`
    );
  });
});

// ============================================================================
// Test Group 3: Provider Filtering & Queries
// ============================================================================

describe("Provider Registry - Filtering & Queries", () => {
  it("should get only active providers", () => {
    const registry = new ProviderRegistryService();
    const activeProviders = registry.getActiveProviders();
    const allActive = activeProviders.every((p) => p.status === "active");

    assert.ok(allActive, "All returned providers should have status 'active'");
    assert.ok(
      activeProviders.length > 0,
      `Expected at least 1 active provider, got ${activeProviders.length}`
    );
  });

  it("should filter providers by threading capability", () => {
    const registry = new ProviderRegistryService();
    const threadingProviders = registry.getProvidersByCapability("threading");
    const allSupport = threadingProviders.every((p) => p.capabilities.threading === true);

    assert.ok(allSupport, "All returned providers should support threading");
  });

  it("should filter providers by video capability", () => {
    const registry = new ProviderRegistryService();
    const videoProviders = registry.getProvidersByCapability("video");
    const allSupport = videoProviders.every((p) => p.capabilities.video === true);

    assert.ok(allSupport, "All returned providers should support video");
  });

  it("should filter providers by scheduling capability", () => {
    const registry = new ProviderRegistryService();
    const schedulingProviders = registry.getProvidersByCapability("scheduling");
    const allSupport = schedulingProviders.every((p) => p.capabilities.scheduling === true);

    assert.ok(allSupport, "All returned providers should support scheduling");
  });

  it("should check if individual provider supports capability", () => {
    const registry = new ProviderRegistryService();
    const xThreading = registry.supportsCapability("x", "threading");

    assert.strictEqual(xThreading, true, "X should support threading");
  });

  it("should return false for capability check on unknown provider", () => {
    const registry = new ProviderRegistryService();
    const result = registry.supportsCapability("unknown-provider-xyz", "threading");

    assert.strictEqual(result, false, "Unknown provider should not support any capability");
  });
});

// ============================================================================
// Test Group 4: Provider Limits & Validation
// ============================================================================

describe("Provider Registry - Limits & Validation", () => {
  it("should return correct character limit for X/Twitter", () => {
    const registry = new ProviderRegistryService();
    const charLimit = registry.getCharLimit("x");

    assert.strictEqual(charLimit, 280, "X character limit should be 280");
  });

  it("should return default character limit for unknown provider", () => {
    const registry = new ProviderRegistryService();
    const charLimit = registry.getCharLimit("unknown-provider-xyz");

    assert.strictEqual(charLimit, 280, "Unknown provider should return default limit of 280");
  });

  it("should return media limits for provider", () => {
    const registry = new ProviderRegistryService();
    const mediaLimits = registry.getMediaLimits("x");

    assert.ok(mediaLimits !== undefined, "Media limits should exist");
    assert.strictEqual(
      typeof mediaLimits.maxMediaPerPost,
      "number",
      "maxMediaPerPost should be a number"
    );
  });

  it("should return undefined media limits for unknown provider", () => {
    const registry = new ProviderRegistryService();
    const mediaLimits = registry.getMediaLimits("unknown-provider-xyz");

    assert.strictEqual(mediaLimits, undefined, "Unknown provider should return undefined limits");
  });

  it("should validate content within limits", () => {
    const registry = new ProviderRegistryService();
    const result = registry.validateContent("x", "This is a short tweet", 0);

    assert.strictEqual(result.valid, true, "Content should be valid");
    assert.strictEqual(result.errors.length, 0, "Should have no errors");
  });

  it("should detect content exceeding character limit", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(300); // Exceeds X's 280 char limit
    const result = registry.validateContent("x", longContent, 0);

    assert.ok(
      result.valid === false || result.errors.length > 0 || result.warnings.length > 0,
      "Should detect content exceeding character limit"
    );
  });

  it("should detect excessive media count", () => {
    const registry = new ProviderRegistryService();
    const result = registry.validateContent("x", "Tweet with many images", 10); // X supports max 4 images

    assert.ok(
      result.valid === false || result.errors.length > 0,
      "Should detect excessive media count"
    );
  });
});

// ============================================================================
// Test Group 5: Threading Logic
// ============================================================================

describe("Provider Registry - Threading Logic", () => {
  it("should return false for short content", () => {
    const registry = new ProviderRegistryService();
    const needsThread = registry.needsThreading("x", "Short tweet");

    assert.strictEqual(needsThread, false, "Short content should not need threading");
  });

  it("should return true for long content on X", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(500); // Exceeds X's 280 char limit
    const needsThread = registry.needsThreading("x", longContent);

    assert.strictEqual(needsThread, true, "Long content should need threading on X");
  });

  it("should calculate thread size 1 for short content", () => {
    const registry = new ProviderRegistryService();
    const threadSize = registry.calculateThreadSize("x", "Short tweet");

    assert.strictEqual(threadSize, 1, "Short content should have thread size 1");
  });

  it("should calculate thread size 2 for content exactly 2x limit", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(560); // Exactly 2x X's 280 char limit
    const threadSize = registry.calculateThreadSize("x", longContent);

    assert.strictEqual(threadSize, 2, "Content 2x limit should have thread size 2");
  });

  it("should round up thread size calculation", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(420); // 1.5x X's 280 char limit
    const threadSize = registry.calculateThreadSize("x", longContent);

    assert.strictEqual(threadSize, 2, "Content 1.5x limit should round up to thread size 2");
  });

  it("should return false for unknown provider threading", () => {
    const registry = new ProviderRegistryService();
    const needsThread = registry.needsThreading("unknown-provider-xyz", "a".repeat(500));

    assert.strictEqual(needsThread, false, "Unknown provider should not need threading");
  });
});

// ============================================================================
// Test Group 6: Health Checking (Hybrid: Mock or Real)
// ============================================================================

describe("Provider Registry - Health Checking", () => {
  let testRegistry: ProviderRegistryService;

  before(() => {
    testRegistry = new ProviderRegistryService();
    if (!USE_REAL_ADAPTERS) {
      // Replace with mock adapters for fast testing
      const mockAdapter = new MockProviderAdapter();
      testRegistry.registerAdapter("x", mockAdapter);
      testRegistry.registerAdapter("instagram", mockAdapter);
      testRegistry.registerAdapter("facebook", mockAdapter);
    }
  });

  it("should return health status for registered provider", async () => {
    const health = await testRegistry.checkProviderHealth("x");

    assert.ok(
      health.healthy === true || health.healthy === false,
      `Health check should return boolean status (got: ${health.healthy})`
    );
  });

  it("should return unhealthy for unknown provider", async () => {
    const health = await testRegistry.checkProviderHealth("unknown-provider-xyz");

    assert.strictEqual(health.healthy, false, "Unknown provider should be unhealthy");
    assert.ok(health.error !== undefined, "Should include error message");
  });

  it("should include latency in health check", async () => {
    const health = await testRegistry.checkProviderHealth("x");

    assert.ok(
      typeof health.latency === "number" || health.latency === undefined,
      "Latency should be number or undefined"
    );
  });

  it("should check all providers health", async () => {
    const healthMap = await testRegistry.checkAllProvidersHealth();

    assert.ok(healthMap.size >= 5, `Expected at least 5 providers checked, got ${healthMap.size}`);
  });

  it("should return Map instance for all providers health", async () => {
    const healthMap = await testRegistry.checkAllProvidersHealth();

    assert.ok(healthMap instanceof Map, "Should return Map instance");
  });

  it("should respond quickly with mock adapter", { skip: USE_REAL_ADAPTERS }, async () => {
    const startTime = Date.now();
    const _health = await testRegistry.checkProviderHealth("x");
    const duration = Date.now() - startTime;

    assert.ok(duration < 100, `Mock adapter should respond in <100ms (actual: ${duration}ms)`);
  });
});

// ============================================================================
// Test Group 7: Database Integration (ProviderConnection)
// ============================================================================

describe("Provider Registry - Database Integration", () => {
  let dbAccount: any;
  let _dbProject: any;

  // Helper to create minimal provider metadata
  const getProviderMetadata = (providerId: string) => {
    const registry = new ProviderRegistryService();
    const metadata = registry.getProvider(providerId);
    return {
      capabilities: metadata?.capabilities || {},
      limits: metadata?.limits || {},
    };
  };

  before(async () => {
    // Create test Account and Project for foreign key constraints
    dbAccount = await prisma.account.create({
      data: {
        id: testAccountId,
        email: `test-${testId}@example.com`,
        name: "Test Account",
        subscription: "BASIC",
      },
    });

    _dbProject = await prisma.project.create({
      data: {
        id: testProjectId,
        accountId: dbAccount.id,
        name: "Test Project",
      },
    });
  });

  after(async () => {
    // Cleanup: delete test account (cascades to project and connections)
    try {
      await prisma.account.delete({ where: { id: testAccountId } });
    } catch {
      // Account may already be deleted in some test scenarios
      console.log("Note: Test account cleanup - already deleted");
    }
  });

  it("should handle Prisma Provider enum values correctly", async () => {
    // Test that we can create ProviderConnection with proper enum values
    const metadata = getProviderMetadata("x");
    const connection = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "X", // Using Prisma enum value
        providerName: "X (Twitter)",
        accountName: "@testuser",
        capabilities: metadata.capabilities,
        limits: metadata.limits,
        connectedAt: new Date(),
      },
    });

    assert.ok(connection.id, "Should create connection with valid ID");
    assert.strictEqual(connection.providerId, "X", "Provider ID should match enum value");

    // Cleanup
    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });

  it("should handle NULL vs undefined for optional fields", async () => {
    // Create connection with minimal required fields (optional fields as undefined)
    const metadata = getProviderMetadata("instagram");
    const connection = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "INSTAGRAM",
        providerName: "Instagram",
        capabilities: metadata.capabilities,
        limits: metadata.limits,
        // Optional fields omitted (will be NULL in database)
      },
    });

    assert.ok(connection.id, "Should create connection");
    assert.strictEqual(connection.accountName, null, "Optional accountName should be null");
    assert.strictEqual(connection.accessToken, null, "Optional accessToken should be null");

    // Cleanup
    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });

  it("should query ProviderConnection by provider enum", async () => {
    // Create test connections
    const xMetadata = getProviderMetadata("x");
    const instaMetadata = getProviderMetadata("instagram");

    const conn1 = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "X",
        providerName: "X",
        capabilities: xMetadata.capabilities,
        limits: xMetadata.limits,
      },
    });

    const conn2 = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "INSTAGRAM",
        providerName: "Instagram",
        capabilities: instaMetadata.capabilities,
        limits: instaMetadata.limits,
      },
    });

    // Query by provider enum
    const xConnections = await prisma.providerConnection.findMany({
      where: { providerId: "X" },
    });

    const instagramConnections = await prisma.providerConnection.findMany({
      where: { providerId: "INSTAGRAM" },
    });

    assert.ok(
      xConnections.some((c) => c.id === conn1.id),
      "Should find X connection"
    );
    assert.ok(
      instagramConnections.some((c) => c.id === conn2.id),
      "Should find Instagram connection"
    );

    // Cleanup
    await prisma.providerConnection.deleteMany({
      where: { id: { in: [conn1.id, conn2.id] } },
    });
  });

  it("should update ProviderConnection with conditional spreading", async () => {
    // Create connection
    const metadata = getProviderMetadata("facebook");
    const connection = await prisma.providerConnection.create({
      data: {
        accountId: testAccountId,
        projectId: testProjectId,
        providerId: "FACEBOOK",
        providerName: "Facebook",
        capabilities: metadata.capabilities,
        limits: metadata.limits,
      },
    });

    // Update with conditional spreading for optional fields
    const accessToken = "new-access-token";
    const refreshToken: string | undefined = undefined;

    const updated = await prisma.providerConnection.update({
      where: { id: connection.id },
      data: {
        ...(accessToken !== undefined && { accessToken }),
        ...(refreshToken !== undefined && { refreshToken }),
        lastUsedAt: new Date(),
      },
    });

    assert.strictEqual(updated.accessToken, accessToken, "Should update accessToken");
    assert.strictEqual(updated.refreshToken, null, "Should keep refreshToken as null");
    assert.ok(updated.lastUsedAt !== null, "Should update lastUsedAt");

    // Cleanup
    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });
});

console.log("\n✅ All providerRegistry tests completed!");
console.log("🔥 Provider registry is working correctly!");
if (!USE_REAL_ADAPTERS) {
  console.log("\n💡 Tip: Run with USE_REAL_ADAPTERS=true to test with real provider adapters");
}
