import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.strictEqual(providers.length, 0, "Manager should have no providers initially");
  });

  it("should initialize with providers", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const providers = manager.getAllProviders();
    assert.strictEqual(
      providers.length,
      testProviders.length,
      `Manager should have ${testProviders.length} providers`
    );
  });

  it("should register a provider", () => {
    const manager = new ProviderCapabilityManager([]);
    const testProviders = getTestProviders();

    manager.registerProvider(testProviders[0]!);

    const providers = manager.getAllProviders();
    assert.strictEqual(providers.length, 1, "Manager should have 1 provider after registration");
    assert.strictEqual(providers[0]!.id, testProviders[0]!.id, "Registered provider should match");
  });

  it("should unregister a provider", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    manager.unregisterProvider(testProviders[0]!.id);

    const providers = manager.getAllProviders();
    assert.strictEqual(
      providers.length,
      testProviders.length - 1,
      "Manager should have one less provider"
    );
    assert.strictEqual(
      providers.some((p) => p.id === testProviders[0]!.id),
      false,
      "Unregistered provider should be removed"
    );
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
    assert.ok(threadingProviders.length > 0, "Should find providers with threading capability");
    assert.ok(
      threadingProviders.every((p) => p.capabilities.threading === true),
      "All returned providers should support threading"
    );
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
      assert.strictEqual(
        providers.length,
        0,
        "Should return no providers for unsupported capability"
      );
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
    assert.ok(compatibleProviders.length > 0, "Should find compatible providers");
    assert.ok(
      compatibleProviders.every((p) => p.score > 0),
      "All compatible providers should have score > 0"
    );
    assert.ok(
      compatibleProviders[0]!.score >= compatibleProviders[compatibleProviders.length - 1]!.score,
      "Providers should be sorted by score (descending)"
    );
  });

  it("should exclude providers missing required capabilities", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["stories", "reels"], // Only Instagram has both
    };

    const compatibleProviders = manager.getCompatibleProviders(query);
    assert.ok(
      compatibleProviders.every((p) => {
        const provider = manager.getAllProviders().find((pr) => pr.id === p.providerId);
        return provider?.capabilities.stories && provider?.capabilities.reels;
      }),
      "Only providers with both stories and reels should be returned"
    );
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
      assert.ok(
        xProvider.limitations.some((l) => l.includes("Character limit")),
        "X provider should have character limit limitation"
      );
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
    assert.ok(
      compatibleProviders.every((p) => {
        const provider = manager.getAllProviders().find((pr) => pr.id === p.providerId);
        return provider && provider.limits.maxMediaPerPost > 0;
      }),
      "All compatible providers should support media"
    );
  });
});
