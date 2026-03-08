import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.ok(combinations.length > 0, "Should suggest provider combinations");
    assert.ok(
      combinations.every((combo) => combo.length === 1),
      "All combinations should have exactly 1 provider"
    );
  });

  it("should return multi-provider combinations", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      maxProviders: 2,
    };

    const combinations = manager.suggestProviderCombinations(query);
    assert.ok(combinations.length > 0, "Should suggest provider combinations");

    const multiProviderCombos = combinations.filter((combo) => combo.length > 1);
    assert.ok(multiProviderCombos.length > 0, "Should include multi-provider combinations");
  });

  it("should respect maxProviders limit", () => {
    const testProviders = getTestProviders();
    const manager = new ProviderCapabilityManager(testProviders);

    const query: CapabilityQuery = {
      requiredCapabilities: ["publish"],
      maxProviders: 2,
    };

    const combinations = manager.suggestProviderCombinations(query);
    assert.ok(
      combinations.every((combo) => combo.length <= 2),
      "All combinations should respect maxProviders limit"
    );
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
      assert.strictEqual(
        combinations.length,
        0,
        "Should return empty array when no compatible providers"
      );
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

    assert.ok(compatibleProviders.length > 0, "Empty query should return providers");
    assert.ok(
      compatibleProviders.every((p) => p.score >= 0),
      "All providers should have non-negative scores"
    );
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
    assert.strictEqual(
      compatibleProviders.length,
      0,
      "Disabled provider should not match any capability query"
    );
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
      assert.ok(
        activeProvider.score > betaProvider.score,
        "Active provider should have higher score than beta provider"
      );
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
    assert.strictEqual(
      compatibility.length,
      1,
      "Should return compatibility result even with error"
    );
    assert.strictEqual(compatibility[0]!.compatible, false, "Should mark as incompatible on error");
    assert.ok(
      compatibility[0]!.limitations.some((l) => l.message.includes("Validation failed")),
      "Should include error message in limitations"
    );
  });
});
