import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";
import { ProviderCapabilityManager } from "../../src/providers/providerCapabilityManager.js";
import { getTestProviders } from "./providerCapabilityManager.test-helpers.js";

// ========================================
// TEST SUITE: Capability Matrix
// ========================================
describe("ProviderCapabilityManager - Capability Matrix", () => {
  it("should return matrix of capabilities", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const matrix = manager.getCapabilityMatrix();
    assert.strictEqual(typeof matrix, "object", "Matrix should be an object");
    assert.ok(Object.keys(matrix).length > 0, "Matrix should have capabilities");

    Object.values(matrix).forEach((providerIds) => {
      assert.ok(Array.isArray(providerIds), "Each capability should have an array of provider IDs");
    });
  });

  it("should reflect provider registration changes", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager([testProviders[0]!]);

    const matrixBefore = manager.getCapabilityMatrix();
    const threadingBefore = matrixBefore.threading?.length || 0;

    const threadingProvider = testProviders.find((p) => p.capabilities.threading);
    if (threadingProvider && threadingProvider.id !== testProviders[0]!.id) {
      manager.registerProvider(threadingProvider);

      const matrixAfter = manager.getCapabilityMatrix();
      const threadingAfter = matrixAfter.threading?.length || 0;

      assert.ok(
        threadingAfter >= threadingBefore,
        "Threading capability count should increase or stay the same"
      );
    }
  });
});

// ========================================
// TEST SUITE: Capability Statistics
// ========================================
describe("ProviderCapabilityManager - Capability Statistics", () => {
  it("should return correct provider count", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const stats = manager.getCapabilityStatistics();
    assert.strictEqual(
      stats.totalProviders,
      testProviders.length,
      "Total provider count should match"
    );
  });

  it("should calculate averages correctly", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const stats = manager.getCapabilityStatistics();
    assert.ok(stats.averageCharacterLimit > 0, "Average character limit should be positive");
    assert.ok(stats.averageMediaSupport >= 0, "Average media support should be non-negative");

    const totalChars = testProviders.reduce((sum, p) => sum + p.limits.maxChars, 0);
    const expectedAvgChars = Math.round(totalChars / testProviders.length);
    assert.strictEqual(
      stats.averageCharacterLimit,
      expectedAvgChars,
      `Average character limit should be ${expectedAvgChars}, got ${stats.averageCharacterLimit}`
    );
  });

  it("should identify most supported capabilities", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const stats = manager.getCapabilityStatistics();
    assert.ok(
      stats.mostSupportedCapabilities.length > 0,
      "Should identify most supported capabilities"
    );
    assert.ok(stats.mostSupportedCapabilities.length <= 3, "Should return at most 3 capabilities");
  });

  it("should identify least supported capabilities", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const stats = manager.getCapabilityStatistics();
    assert.ok(
      stats.leastSupportedCapabilities.length > 0,
      "Should identify least supported capabilities"
    );
    assert.ok(stats.leastSupportedCapabilities.length <= 3, "Should return at most 3 capabilities");
  });
});

// ========================================
// TEST SUITE: Content Compatibility
// ========================================
describe("ProviderCapabilityManager - Content Compatibility", () => {
  it("should validate content for all providers", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const content: CanonicalPost = {
      body: "This is a test post that should be valid for most providers",
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(content);
    assert.strictEqual(
      compatibility.length,
      testProviders.length,
      "Should return compatibility for all providers"
    );
    assert.ok(
      compatibility.every((c) => typeof c.compatible === "boolean"),
      "All compatibility results should have a boolean compatible field"
    );
  });

  it("should detect character limit violations", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const longContent: CanonicalPost = {
      body: "a".repeat(500), // Exceeds X's 280 limit
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(longContent);
    const xCompatibility = compatibility.find((c) => c.providerId === "x");

    assert.ok(xCompatibility !== undefined, "Should have compatibility result for X");
    assert.strictEqual(
      xCompatibility.compatible,
      false,
      "X should be incompatible with 500 char content"
    );
    assert.ok(
      xCompatibility.limitations.some((l) => l.type === "character_limit"),
      "Should identify character limit violation"
    );
  });

  it("should detect media requirements", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const textOnlyContent: CanonicalPost = {
      body: "Text only post",
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(textOnlyContent);
    const instagramCompatibility = compatibility.find((c) => c.providerId === "instagram");

    assert.ok(
      instagramCompatibility !== undefined,
      "Should have compatibility result for Instagram"
    );
    assert.strictEqual(
      instagramCompatibility.compatible,
      false,
      "Instagram should be incompatible with text-only content"
    );
    assert.ok(
      instagramCompatibility.limitations.some((l) => l.type === "media_count"),
      "Should identify media requirement"
    );
  });

  it("should provide adaptation suggestions", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const longContent: CanonicalPost = {
      body: "a".repeat(500),
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(longContent);
    const xCompatibility = compatibility.find((c) => c.providerId === "x");

    assert.ok(xCompatibility !== undefined, "Should have compatibility result for X");
    assert.strictEqual(
      xCompatibility.adaptationRequired,
      true,
      "Should indicate adaptation is required"
    );
    assert.ok(
      xCompatibility.limitations.some((l) => l.suggestion !== undefined),
      "Should provide adaptation suggestions"
    );
  });

  it("should filter by target providers", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const content: CanonicalPost = {
      body: "Test content",
      media: [],
    };

    const targetProviders: ProviderId[] = ["x" as ProviderId];
    const compatibility = await manager.checkContentCompatibility(content, targetProviders);

    assert.strictEqual(compatibility.length, 1, "Should only check targeted providers");
    assert.strictEqual(compatibility[0]!.providerId, "x", "Should check X provider");
  });

  it("should include reach estimates", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const content: CanonicalPost = {
      body: "Test content",
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(content);
    assert.ok(
      compatibility.every((c) => typeof c.estimatedReach === "number"),
      "All compatibility results should have reach estimates"
    );
  });

  it("should include optimal timing", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const content: CanonicalPost = {
      body: "Test content",
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(content);
    assert.ok(
      compatibility.every((c) => Array.isArray(c.optimalTiming)),
      "All compatibility results should have optimal timing arrays"
    );
  });
});
