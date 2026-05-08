/**
 * @file providerCapabilityManager.init.test.ts
 * @description Tests for ProviderCapabilityManager - Initialization & Basic Operations
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import type { ProviderCapabilities } from "../../src/providers/providerAdapter.interface.js";
import {
  ProviderCapabilityManager,
  type CapabilityQuery,
} from "../../src/providers/providerCapabilityManager.js";
import { getTestProviders } from "./providerCapabilityManager.test-helpers.js";

// ========================================
// TEST SUITE: Initialization & Basic Operations
// ========================================
describe("ProviderCapabilityManager - Initialization & Basic Operations", () => {
  it("should initialize with empty providers", () => {
    const manager = new ProviderCapabilityManager([]);

    const providers = manager.getAllProviders();
    expect(providers.length).toBe(0);
  });

  it("should initialize with providers", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const providers = manager.getAllProviders();
    expect(providers.length).toBe(testProviders.length);
  });

  it("should register a provider", () => {
    const manager = new ProviderCapabilityManager([]);
    const testProviders = getTestProviders();

    manager.registerProvider(testProviders[0]!);

    const providers = manager.getAllProviders();
    expect(providers.length).toBe(1);
    expect(providers[0]!.id).toBe(testProviders[0]!.id);
  });

  it("should unregister a provider", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    manager.unregisterProvider(testProviders[0]!.id);

    const providers = manager.getAllProviders();
    expect(providers.length).toBe(testProviders.length - 1);
    expect(providers.some((p) => p.id === testProviders[0]!.id)).toBe(false);
  });
});

// ========================================
// TEST SUITE: Capability Queries
// ========================================
describe("ProviderCapabilityManager - Capability Queries", () => {
  it("should return providers with specific capability", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const threadingProviders = manager.getProvidersByCapability("threading");
    expect(threadingProviders.length > 0).toBeTruthy();
    expect(threadingProviders.every((p) => p.capabilities.threading === true)).toBeTruthy();
  });

  it("should return empty for unsupported capability", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const allProviders = manager.getAllProviders();
    let unsupportedCapability: keyof ProviderCapabilities | null = null;

    const capabilities: (keyof ProviderCapabilities)[] = [
      "publish",
      "schedule",
      "analytics",
      "comments",
      "replies",
      "threading",
      "stories",
      "reels",
      "carousel",
      "liveStreaming",
      "directMessages",
    ];

    for (const cap of capabilities) {
      if (allProviders.every((p) => !p.capabilities[cap])) {
        unsupportedCapability = cap;
        break;
      }
    }

    if (unsupportedCapability) {
      const providers = manager.getProvidersByCapability(unsupportedCapability);
      expect(providers.length).toBe(0);
    }
  });

  it("should return scored providers for query", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish", "schedule"],
      optionalCapabilities: ["analytics"],
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    expect(compatibleProviders.length > 0).toBeTruthy();
    expect(compatibleProviders.every((p) => p.score > 0)).toBeTruthy();
    expect(
      compatibleProviders[0]!.score >= compatibleProviders[compatibleProviders.length - 1]!.score
    ).toBeTruthy();
  });

  it("should exclude providers missing required capabilities", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["stories", "reels"], // Only Instagram has both
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    expect(
      compatibleProviders.every((p) => {
        const provider = manager.getAllProviders().find((pr) => pr.id === p.providerId);
        return provider?.capabilities.stories && provider?.capabilities.reels;
      })
    ).toBeTruthy();
  });

  it("should handle character limit constraints", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      minCharacterLimit: 1000, // X has only 280, should be penalized
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    const xProvider = compatibleProviders.find((p) => p.providerId === "x");

    if (xProvider) {
      expect(xProvider.limitations.some((l) => l.includes("Character limit"))).toBeTruthy();
    }
  });

  it("should handle media requirements", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      mediaRequired: true,
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    expect(
      compatibleProviders.every((p) => {
        const provider = manager.getAllProviders().find((pr) => pr.id === p.providerId);
        return provider && provider.limits.maxMediaPerPost > 0;
      })
    ).toBeTruthy();
  });
});
