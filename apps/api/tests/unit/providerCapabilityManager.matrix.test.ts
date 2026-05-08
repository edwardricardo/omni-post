/**
 * @file providerCapabilityManager.matrix.test.ts
 * @description Tests for ProviderCapabilityManager - Capability Matrix
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
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
    expect(typeof matrix).toBe("object");
    expect(Object.keys(matrix).length > 0).toBeTruthy();

    Object.values(matrix).forEach((providerIds) => {
      expect(Array.isArray(providerIds)).toBeTruthy();
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

      expect(threadingAfter >= threadingBefore).toBeTruthy();
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
    expect(stats.totalProviders).toBe(testProviders.length);
  });

  it("should calculate averages correctly", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const stats = manager.getCapabilityStatistics();
    expect(stats.averageCharacterLimit > 0).toBeTruthy();
    expect(stats.averageMediaSupport >= 0).toBeTruthy();

    const totalChars = testProviders.reduce((sum, p) => sum + p.limits.maxChars, 0);
    const expectedAvgChars = Math.round(totalChars / testProviders.length);
    expect(stats.averageCharacterLimit).toBe(expectedAvgChars);
  });

  it("should identify most supported capabilities", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const stats = manager.getCapabilityStatistics();
    expect(stats.mostSupportedCapabilities.length > 0).toBeTruthy();
    expect(stats.mostSupportedCapabilities.length <= 3).toBeTruthy();
  });

  it("should identify least supported capabilities", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const stats = manager.getCapabilityStatistics();
    expect(stats.leastSupportedCapabilities.length > 0).toBeTruthy();
    expect(stats.leastSupportedCapabilities.length <= 3).toBeTruthy();
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
    expect(compatibility.length).toBe(testProviders.length);
    expect(compatibility.every((c) => typeof c.compatible === "boolean")).toBeTruthy();
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

    expect(xCompatibility !== undefined).toBeTruthy();
    expect(xCompatibility.compatible).toBe(false);
    expect(xCompatibility.limitations.some((l) => l.type === "character_limit")).toBeTruthy();
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

    expect(instagramCompatibility !== undefined).toBeTruthy();
    expect(instagramCompatibility.compatible).toBe(false);
    expect(instagramCompatibility.limitations.some((l) => l.type === "media_count")).toBeTruthy();
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

    expect(xCompatibility !== undefined).toBeTruthy();
    expect(xCompatibility.adaptationRequired).toBe(true);
    expect(xCompatibility.limitations.some((l) => l.suggestion !== undefined)).toBeTruthy();
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

    expect(compatibility.length).toBe(1);
    expect(compatibility[0]!.providerId).toBe("x");
  });

  it("should include reach estimates", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const content: CanonicalPost = {
      body: "Test content",
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(content);
    expect(compatibility.every((c) => typeof c.estimatedReach === "number")).toBeTruthy();
  });

  it("should include optimal timing", async () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const content: CanonicalPost = {
      body: "Test content",
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(content);
    expect(compatibility.every((c) => Array.isArray(c.optimalTiming))).toBeTruthy();
  });
});
