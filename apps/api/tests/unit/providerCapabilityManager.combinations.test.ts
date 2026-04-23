/**
 * @file providerCapabilityManager.combinations.test.ts
 * @description Tests for ProviderCapabilityManager - Provider Combinations
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import type { ProviderAdapter, ProviderId } from "../../src/providers/providerAdapter.interface.js";
import type { CanonicalPost } from "@shared/types";
import {
  ProviderCapabilityManager,
  type CapabilityQuery,
} from "../../src/providers/providerCapabilityManager.js";
import { getTestProviders } from "./providerCapabilityManager.test-helpers.js";

// ========================================
// TEST SUITE: Provider Combinations
// ========================================
describe("ProviderCapabilityManager - Provider Combinations", () => {
  it("should return single provider combinations", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      maxProviders: 1,
    };

    const combinations = manager.suggestProviderCombinations(query);
    expect(combinations.length > 0).toBeTruthy();
    expect(combinations.every((combo) => combo.length === 1)).toBeTruthy();
  });

  it("should return multi-provider combinations", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      maxProviders: 2,
    };

    const combinations = manager.suggestProviderCombinations(query);
    expect(combinations.length > 0).toBeTruthy();

    const multiProviderCombos = combinations.filter((combo) => combo.length > 1);
    expect(multiProviderCombos.length > 0).toBeTruthy();
  });

  it("should respect maxProviders limit", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      maxProviders: 2,
    };

    const combinations = manager.suggestProviderCombinations(query);
    expect(combinations.every((combo) => combo.length <= 2)).toBeTruthy();
  });

  it("should return empty for no compatible providers", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      minCharacterLimit: 100000, // Impossible requirement
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    if (compatibleProviders.length === 0) {
      const combinations = manager.suggestProviderCombinations(query);
      expect(combinations.length).toBe(0);
    }
  });
});

// ========================================
// TEST SUITE: Edge Cases
// ========================================
describe("ProviderCapabilityManager - Edge Cases", () => {
  it("should handle empty capability query", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {};
    const compatibleProviders = manager.getCompatibleProviders(query);

    expect(compatibleProviders.length > 0).toBeTruthy();
    expect(compatibleProviders.every((p) => p.score >= 0)).toBeTruthy();
  });

  it("should handle provider with all capabilities disabled", () => {
    const disabledProvider: ProviderAdapter = {
      id: "disabled" as ProviderId,
      metadata: {
        id: "disabled",
        name: "Disabled Provider",
        description: "Provider with no capabilities",
        status: "deprecated",
        authType: "oauth2",
      },
      limits: {
        maxChars: 100,
        maxMediaPerPost: 0,
        maxVideoLength: 0,
        maxImageSize: 0,
        maxVideoSize: 0,
        supportedMediaTypes: [],
        maxThreadLength: 1,
      },
      capabilities: {
        publish: false,
        schedule: false,
        analytics: false,
        comments: false,
        replies: false,
        threading: false,
        stories: false,
        reels: false,
        carousel: false,
        liveStreaming: false,
        directMessages: false,
      },
      validateContent: async () => ({
        valid: false,
        errors: [{ field: "provider", message: "Provider is disabled", severity: "error" }],
        warnings: [],
        suggestions: [],
      }),
    } as ProviderAdapter;

    const manager = new ProviderCapabilityManager([disabledProvider]);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    expect(compatibleProviders.length).toBe(0);
  });

  it("should handle provider status in scoring", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    const activeProvider = compatibleProviders.find((p) => {
      const provider = manager.getAllProviders().find((pr) => pr.id === p.providerId);
      return provider?.metadata.status === "active";
    });

    const betaProvider = compatibleProviders.find((p) => {
      const provider = manager.getAllProviders().find((pr) => pr.id === p.providerId);
      return provider?.metadata.status === "beta";
    });

    if (activeProvider && betaProvider) {
      expect(activeProvider.score > betaProvider.score).toBeTruthy();
    }
  });

  it("should handle validation errors gracefully", async () => {
    const errorProvider: ProviderAdapter = {
      id: "error" as ProviderId,
      metadata: {
        id: "error",
        name: "Error Provider",
        description: "Provider that throws errors",
        status: "active",
        authType: "oauth2",
      },
      limits: {
        maxChars: 100,
        maxMediaPerPost: 1,
        maxVideoLength: 60,
        maxImageSize: 1024,
        maxVideoSize: 1024,
        supportedMediaTypes: [],
        maxThreadLength: 1,
      },
      capabilities: {
        publish: true,
        schedule: false,
        analytics: false,
        comments: false,
        replies: false,
        threading: false,
        stories: false,
        reels: false,
        carousel: false,
        liveStreaming: false,
        directMessages: false,
      },
      validateContent: async () => {
        throw new Error("Validation failed");
      },
    } as ProviderAdapter;

    const manager = new ProviderCapabilityManager([errorProvider]);

    const content: CanonicalPost = {
      body: "Test",
      media: [],
    };

    const compatibility = await manager.checkContentCompatibility(content);
    expect(compatibility.length).toBe(1);
    expect(compatibility[0]!.compatible).toBe(false);
    expect(
      compatibility[0]!.limitations.some((l) => l.message.includes("Validation failed"))
    ).toBeTruthy();
  });
});
