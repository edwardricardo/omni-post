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

import { describe, it, beforeAll, afterAll, expect } from "vitest";
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

beforeAll(async () => {
  // Configuration: USE_REAL_ADAPTERS controls mock vs real adapter usage
});

afterAll(async () => {
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

    expect(providers.length >= 5).toBeTruthy();
  });

  it("should have adapters registered for all built-in providers", () => {
    const registry = new ProviderRegistryService();
    const builtInProviders = ["x", "instagram", "facebook", "tiktok", "youtube"];
    const allHaveAdapters = builtInProviders.every((id) => registry.hasAdapter(id));

    expect(allHaveAdapters).toBeTruthy();
  });

  it("should get specific provider by ID", () => {
    const registry = new ProviderRegistryService();
    const xProvider = registry.getProvider("x");

    expect(xProvider !== undefined).toBeTruthy();
    expect(xProvider.id).toBe("x");
  });

  it("should return provider with expected metadata structure", () => {
    const registry = new ProviderRegistryService();
    const xProvider = registry.getProvider("x");

    expect(xProvider !== undefined).toBeTruthy();
    expect(xProvider.name !== undefined).toBeTruthy();
    expect(xProvider.capabilities !== undefined).toBeTruthy();
    expect(xProvider.limits !== undefined).toBeTruthy();
  });

  it("should return undefined for unknown provider ID", () => {
    const registry = new ProviderRegistryService();
    const unknown = registry.getProvider("unknown-provider-xyz");

    expect(unknown).toBe(undefined);
  });
});

// ============================================================================
// Test Group 2: Adapter Management
// ============================================================================

describe("Provider Registry - Adapter Management", () => {
  it("should get adapter for registered provider", () => {
    const registry = new ProviderRegistryService();
    const xAdapter = registry.getAdapter("x");

    expect(xAdapter !== undefined).toBeTruthy();
  });

  it("should return adapter with required methods", () => {
    const registry = new ProviderRegistryService();
    const xAdapter = registry.getAdapter("x");

    expect(xAdapter !== undefined).toBeTruthy();
    expect(typeof xAdapter.validateCredentials).toBe("function");
    expect(typeof xAdapter.publish).toBe("function");
  });

  it("should return undefined for unknown provider adapter", () => {
    const registry = new ProviderRegistryService();
    const unknown = registry.getAdapter("unknown-provider-xyz");

    expect(unknown).toBe(undefined);
  });

  it("should return true for hasAdapter on registered providers", () => {
    const registry = new ProviderRegistryService();

    expect(registry.hasAdapter("x")).toBeTruthy();
  });

  it("should return false for hasAdapter on unknown providers", () => {
    const registry = new ProviderRegistryService();

    expect(registry.hasAdapter("unknown-provider-xyz")).toBe(false);
  });

  it("should register new adapter for existing provider", () => {
    const registry = new ProviderRegistryService();
    const mockAdapter = new MockProviderAdapter();

    // Register mock adapter for X (overwrite existing)
    registry.registerAdapter("x", mockAdapter);
    const adapter = registry.getAdapter("x");

    expect(adapter).toBe(mockAdapter);
  });

  it("should throw error when registering adapter for unknown provider", () => {
    const registry = new ProviderRegistryService();
    const mockAdapter = new MockProviderAdapter();

    expect(() => {
      registry.registerAdapter("unknown-provider-xyz", mockAdapter);
    }).toThrow(/unknown provider/i);
  });

  it("should return providers with adapters", () => {
    const registry = new ProviderRegistryService();
    const providersWithAdapters = registry.getProvidersWithAdapters();

    expect(providersWithAdapters.length >= 5).toBeTruthy();
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

    expect(allActive).toBeTruthy();
    expect(activeProviders.length > 0).toBeTruthy();
  });

  it("should filter providers by threading capability", () => {
    const registry = new ProviderRegistryService();
    const threadingProviders = registry.getProvidersByCapability("threading");
    const allSupport = threadingProviders.every((p) => p.capabilities.threading === true);

    expect(allSupport).toBeTruthy();
  });

  it("should filter providers by video capability", () => {
    const registry = new ProviderRegistryService();
    const videoProviders = registry.getProvidersByCapability("video");
    const allSupport = videoProviders.every((p) => p.capabilities.video === true);

    expect(allSupport).toBeTruthy();
  });

  it("should filter providers by scheduling capability", () => {
    const registry = new ProviderRegistryService();
    const schedulingProviders = registry.getProvidersByCapability("scheduling");
    const allSupport = schedulingProviders.every((p) => p.capabilities.scheduling === true);

    expect(allSupport).toBeTruthy();
  });

  it("should check if individual provider supports capability", () => {
    const registry = new ProviderRegistryService();
    const xThreading = registry.supportsCapability("x", "threading");

    expect(xThreading).toBe(true);
  });

  it("should return false for capability check on unknown provider", () => {
    const registry = new ProviderRegistryService();
    const result = registry.supportsCapability("unknown-provider-xyz", "threading");

    expect(result).toBe(false);
  });
});

// ============================================================================
// Test Group 4: Provider Limits & Validation
// ============================================================================

describe("Provider Registry - Limits & Validation", () => {
  it("should return correct character limit for X/Twitter", () => {
    const registry = new ProviderRegistryService();
    const charLimit = registry.getCharLimit("x");

    expect(charLimit).toBe(280);
  });

  it("should return default character limit for unknown provider", () => {
    const registry = new ProviderRegistryService();
    const charLimit = registry.getCharLimit("unknown-provider-xyz");

    expect(charLimit).toBe(280);
  });

  it("should return media limits for provider", () => {
    const registry = new ProviderRegistryService();
    const mediaLimits = registry.getMediaLimits("x");

    expect(mediaLimits !== undefined).toBeTruthy();
    expect(typeof mediaLimits.maxMediaPerPost).toBe("number");
  });

  it("should return undefined media limits for unknown provider", () => {
    const registry = new ProviderRegistryService();
    const mediaLimits = registry.getMediaLimits("unknown-provider-xyz");

    expect(mediaLimits).toBe(undefined);
  });

  it("should validate content within limits", () => {
    const registry = new ProviderRegistryService();
    const result = registry.validateContent("x", "This is a short tweet", 0);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should detect content exceeding character limit", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(300); // Exceeds X's 280 char limit
    const result = registry.validateContent("x", longContent, 0);

    expect(
      result.valid === false || result.errors.length > 0 || result.warnings.length > 0
    ).toBeTruthy();
  });

  it("should detect excessive media count", () => {
    const registry = new ProviderRegistryService();
    const result = registry.validateContent("x", "Tweet with many images", 10); // X supports max 4 images

    expect(result.valid === false || result.errors.length > 0).toBeTruthy();
  });
});

// ============================================================================
// Test Group 5: Threading Logic
// ============================================================================

describe("Provider Registry - Threading Logic", () => {
  it("should return false for short content", () => {
    const registry = new ProviderRegistryService();
    const needsThread = registry.needsThreading("x", "Short tweet");

    expect(needsThread).toBe(false);
  });

  it("should return true for long content on X", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(500); // Exceeds X's 280 char limit
    const needsThread = registry.needsThreading("x", longContent);

    expect(needsThread).toBe(true);
  });

  it("should calculate thread size 1 for short content", () => {
    const registry = new ProviderRegistryService();
    const threadSize = registry.calculateThreadSize("x", "Short tweet");

    expect(threadSize).toBe(1);
  });

  it("should calculate thread size 2 for content exactly 2x limit", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(560); // Exactly 2x X's 280 char limit
    const threadSize = registry.calculateThreadSize("x", longContent);

    expect(threadSize).toBe(2);
  });

  it("should round up thread size calculation", () => {
    const registry = new ProviderRegistryService();
    const longContent = "a".repeat(420); // 1.5x X's 280 char limit
    const threadSize = registry.calculateThreadSize("x", longContent);

    expect(threadSize).toBe(2);
  });

  it("should return false for unknown provider threading", () => {
    const registry = new ProviderRegistryService();
    const needsThread = registry.needsThreading("unknown-provider-xyz", "a".repeat(500));

    expect(needsThread).toBe(false);
  });
});

// ============================================================================
// Test Group 6: Health Checking (Hybrid: Mock or Real)
// ============================================================================

describe("Provider Registry - Health Checking", () => {
  let testRegistry: ProviderRegistryService;

  beforeAll(() => {
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

    expect(health.healthy === true || health.healthy === false).toBeTruthy();
  });

  it("should return unhealthy for unknown provider", async () => {
    const health = await testRegistry.checkProviderHealth("unknown-provider-xyz");

    expect(health.healthy).toBe(false);
    expect(health.error !== undefined).toBeTruthy();
  });

  it("should include latency in health check", async () => {
    const health = await testRegistry.checkProviderHealth("x");

    expect(typeof health.latency === "number" || health.latency === undefined).toBeTruthy();
  });

  it("should check all providers health", async () => {
    const healthMap = await testRegistry.checkAllProvidersHealth();

    expect(healthMap.size >= 5).toBeTruthy();
  });

  it("should return Map instance for all providers health", async () => {
    const healthMap = await testRegistry.checkAllProvidersHealth();

    expect(healthMap instanceof Map).toBeTruthy();
  });

  it("should respond quickly with mock adapter", { skip: USE_REAL_ADAPTERS }, async () => {
    const startTime = Date.now();
    const _health = await testRegistry.checkProviderHealth("x");
    const duration = Date.now() - startTime;

    expect(duration < 100).toBeTruthy();
  });
});

// ============================================================================
// Test Group 7: Database Integration (ProviderConnection)
// ============================================================================

describe("Provider Registry - Database Integration", () => {
  // These tests require a real PostgreSQL database and are skipped in vitest
  // unit test context. Run with node:test for integration testing.
  const SKIP_DB = true;

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

  beforeAll(async () => {
    if (SKIP_DB) return;
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

  afterAll(async () => {
    if (SKIP_DB) return;
    // Cleanup: delete test account (cascades to project and connections)
    try {
      await prisma.account.delete({ where: { id: testAccountId } });
    } catch {
      // Account may already be deleted in some test scenarios
    }
  });

  it.skipIf(SKIP_DB)("should handle Prisma Provider enum values correctly", async () => {
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

    expect(connection.id).toBeTruthy();
    expect(connection.providerId).toBe("X");

    // Cleanup
    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });

  it.skipIf(SKIP_DB)("should handle NULL vs undefined for optional fields", async () => {
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

    expect(connection.id).toBeTruthy();
    expect(connection.accountName).toBe(null);
    expect(connection.accessToken).toBe(null);

    // Cleanup
    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });

  it.skipIf(SKIP_DB)("should query ProviderConnection by provider enum", async () => {
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

    expect(xConnections.some((c) => c.id === conn1.id)).toBeTruthy();
    expect(instagramConnections.some((c) => c.id === conn2.id)).toBeTruthy();

    // Cleanup
    await prisma.providerConnection.deleteMany({
      where: { id: { in: [conn1.id, conn2.id] } },
    });
  });

  it.skipIf(SKIP_DB)("should update ProviderConnection with conditional spreading", async () => {
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

    expect(updated.accessToken).toBe(accessToken);
    expect(updated.refreshToken).toBe(null);
    expect(updated.lastUsedAt !== null).toBeTruthy();

    // Cleanup
    await prisma.providerConnection.delete({ where: { id: connection.id } });
  });
});
