/**
 * Provider Adapter Interface Unit Tests
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the provider adapter interface type guards,
 * utility functions, and adapter upgrade mechanisms for social media providers.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - Type guard for full provider adapter detection
 * - Legacy adapter upgrade to universal adapter
 * - Default implementation generation for enhanced methods
 * - Interface completeness validation
 * - Capability structure validation
 * - Limits structure validation
 * - Metadata structure validation
 *
 * PROVIDER ADAPTER BUSINESS RULES:
 * - All providers must implement core methods (render, publish, validate)
 * - Enhanced providers include optional methods (schedule, analytics, threading)
 * - Legacy adapters can be upgraded with default implementations
 * - Type guards ensure interface compliance at runtime
 * - Metadata defines provider display info and auth requirements
 * - Limits define content constraints (chars, media, hashtags)
 * - Capabilities define feature support (publish, schedule, analytics, etc.)
 *
 * DEPENDENCIES:
 * - @shared/types for CanonicalPost, Result, and provider types
 * - Type-only imports to avoid runtime dependencies
 * - Pure type checking and utility functions
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api test apps/api/tests/unit/providerAdapterInterface.test.ts
 *
 * @module ProviderAdapterInterfaceTests
 * @category UnitTests
 *
 * @file providerAdapterInterface.test.ts
 * @description Tests for ProviderAdapterInterface - Type Guard
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  isFullProviderAdapter,
  upgradeAdapter,
  type ProviderAdapter,
  type LegacyProviderAdapter,
  type ContentValidationResult,
} from "../../src/providers/providerAdapter.interface.js";
import type { ProviderId } from "@shared/types";

// ========================================
// TEST UTILITIES & MOCKS
// ========================================

/**
 * Create mock legacy adapter for testing
 */
function createMockLegacyAdapter(): LegacyProviderAdapter {
  return {
    id: "twitter" as ProviderId,
    limits: {
      maxChars: 280,
      maxMediaPerPost: 4,
      allowedMedia: ["image", "video", "gif"],
    },
    capabilities: {
      publish: true,
      schedule: false,
      analytics: false,
      comments: false,
      replies: true,
      threading: true,
    },
    async validateCredentials(_creds: unknown) {
      return { ok: true, value: undefined };
    },
    render(canonical: any) {
      return {
        ok: true,
        value: {
          type: "single" as const,
          content: { text: canonical.content || "" },
        },
      };
    },
    async publish(_input: any) {
      return {
        ok: true,
        value: {
          providerPostId: "post-123",
          url: "https://twitter.com/user/status/123",
          publishedAt: new Date(),
        },
      };
    },
  };
}

/**
 * Create mock full provider adapter
 */
function createMockFullAdapter(): ProviderAdapter {
  const legacy = createMockLegacyAdapter();

  return {
    ...legacy,
    metadata: {
      id: "twitter" as ProviderId,
      name: "twitter",
      displayName: "Twitter/X",
      description: "Post updates to Twitter",
      icon: "/icons/twitter.svg",
      color: "#1DA1F2",
      website: "https://twitter.com",
      authType: "oauth" as const,
      requiredScopes: ["tweet.write", "tweet.read"],
      status: "active" as const,
    },
    constraints: {
      requiresApproval: false,
      businessAccountRequired: false,
    },

    async validateContent(_canonical: any) {
      const result: ContentValidationResult = {
        valid: true,
        errors: [],
        suggestions: [],
        adaptations: [],
      };
      return result;
    },

    async adaptContent(canonical: any) {
      return { ok: true, value: canonical };
    },

    async generatePreview(canonical: any) {
      return {
        providerId: "twitter" as ProviderId,
        content: {
          text: canonical.content || "",
        },
        constraints: {
          charactersUsed: canonical.content?.length || 0,
          charactersRemaining: 280 - (canonical.content?.length || 0),
          mediaCount: canonical.media?.length || 0,
          mediaLimit: 4,
        },
        warnings: [],
      };
    },

    async getAccountInfo(_config: any) {
      return {
        ok: true,
        value: {
          id: "user-123",
          name: "Test User",
          username: "testuser",
          verified: false,
        },
      };
    },

    async healthCheck(_config?: any) {
      return {
        ok: true,
        value: {
          healthy: true,
          latency: 50,
        },
      };
    },
  };
}

// ========================================
// TEST SUITE: Type Guard - isFullProviderAdapter
// ========================================

describe("ProviderAdapterInterface - Type Guard", () => {
  it("should detect full provider adapter", () => {
    const fullAdapter = createMockFullAdapter();

    expect(isFullProviderAdapter(fullAdapter)).toBe(true);
  });

  it("should reject legacy provider adapter", () => {
    const legacyAdapter = createMockLegacyAdapter();

    expect(isFullProviderAdapter(legacyAdapter)).toBe(false);
  });

  it("should reject null value", () => {
    expect(isFullProviderAdapter(null)).toBe(false);
  });

  it("should reject undefined value", () => {
    expect(isFullProviderAdapter(undefined)).toBe(false);
  });

  it("should reject plain object", () => {
    expect(isFullProviderAdapter({})).toBe(false);
  });

  it("should reject object with only metadata", () => {
    const partial = {
      metadata: {
        id: "twitter" as ProviderId,
        name: "twitter",
        displayName: "Twitter",
        description: "Twitter adapter",
        icon: "/icon.svg",
        color: "#000",
        website: "https://twitter.com",
        authType: "oauth" as const,
        status: "active" as const,
      },
    };

    expect(isFullProviderAdapter(partial)).toBe(false);
  });

  it("should require metadata property", () => {
    const withoutMetadata = {
      validateContent: async () => ({}) as any,
      constraints: {},
    };

    expect(isFullProviderAdapter(withoutMetadata)).toBe(false);
  });

  it("should require validateContent method", () => {
    const withoutValidateContent = {
      metadata: {} as any,
      constraints: {},
    };

    expect(isFullProviderAdapter(withoutValidateContent)).toBe(false);
  });

  it("should require constraints property", () => {
    const withoutConstraints = {
      metadata: {} as any,
      validateContent: async () => ({}) as any,
    };

    expect(isFullProviderAdapter(withoutConstraints)).toBe(false);
  });
});

// ========================================
// TEST SUITE: Adapter Upgrade
// ========================================

describe("ProviderAdapterInterface - Adapter Upgrade", () => {
  it("should upgrade legacy adapter to full adapter", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    expect(upgradedAdapter.metadata).toBeTruthy();
    expect(upgradedAdapter.constraints).toBeTruthy();
    expect(typeof upgradedAdapter.validateContent).toBe("function");
    expect(typeof upgradedAdapter.adaptContent).toBe("function");
    expect(typeof upgradedAdapter.generatePreview).toBe("function");
  });

  it("should preserve original adapter properties", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    expect(upgradedAdapter.id).toBe(legacyAdapter.id);
    expect(upgradedAdapter.limits).toStrictEqual(legacyAdapter.limits);
    expect(upgradedAdapter.capabilities).toStrictEqual(legacyAdapter.capabilities);
  });

  it("should generate metadata from adapter ID", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    expect(upgradedAdapter.metadata.id).toBe(legacyAdapter.id);
    expect(upgradedAdapter.metadata.name).toBe(legacyAdapter.id);
    expect(upgradedAdapter.metadata.displayName).toBe(legacyAdapter.id.toUpperCase());
    expect(upgradedAdapter.metadata.description).toBeTruthy();
  });

  it("should set default auth type to OAuth", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    expect(upgradedAdapter.metadata.authType).toBe("oauth");
  });

  it("should set status to active", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    expect(upgradedAdapter.metadata.status).toBe("active");
  });

  it("should provide empty constraints by default", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    expect(upgradedAdapter.constraints).toStrictEqual({});
  });
});

// ========================================
// TEST SUITE: Default Method Implementations
// ========================================

describe("ProviderAdapterInterface - Default Method Implementations", () => {
  it("should provide working validateContent implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const result = await upgradedAdapter.validateContent({
      content: "Test content",
      media: [],
    });

    expect(result).toBeTruthy();
    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.errors)).toBeTruthy();
    expect(Array.isArray(result.suggestions)).toBeTruthy();
    expect(Array.isArray(result.adaptations)).toBeTruthy();
  });

  it("should validate content using render method", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = {
      content: "Valid content",
      media: [],
    };

    const result = await upgradedAdapter.validateContent(canonical);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should detect render errors in validation", async () => {
    const failingAdapter: LegacyProviderAdapter = {
      ...createMockLegacyAdapter(),
      render(_canonical: any) {
        return { ok: false, error: "Render failed" };
      },
    };

    const upgradedAdapter = upgradeAdapter(failingAdapter);
    const result = await upgradedAdapter.validateContent({ content: "test", media: [] });

    expect(result.valid).toBe(false);
    expect(result.errors.length > 0).toBeTruthy();
  });

  it("should provide working adaptContent implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = { content: "Test", media: [] };
    const result = await upgradedAdapter.adaptContent(canonical);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value).toStrictEqual(canonical);
    }
  });

  it("should provide working generatePreview implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = {
      content: "Preview test content",
      media: [{ type: "image" as const, url: "https://example.com/img.jpg" }],
    };

    const preview = await upgradedAdapter.generatePreview(canonical);

    expect(preview.providerId).toBe(legacyAdapter.id);
    expect(preview.content).toBeTruthy();
    expect(preview.constraints).toBeTruthy();
    expect(Array.isArray(preview.warnings)).toBeTruthy();
  });

  it("should calculate character counts in preview", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = {
      content: "Hello",
      media: [],
    };

    const preview = await upgradedAdapter.generatePreview(canonical);

    expect(preview.constraints.charactersUsed).toBe(5);
    expect(preview.constraints.charactersRemaining).toBe(275);
  });

  it("should count media items in preview", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = {
      content: "Test",
      media: [
        { type: "image" as const, url: "img1.jpg" },
        { type: "image" as const, url: "img2.jpg" },
      ],
    };

    const preview = await upgradedAdapter.generatePreview(canonical);

    expect(preview.constraints.mediaCount).toBe(2);
    expect(preview.constraints.mediaLimit).toBe(4);
  });

  it("should provide working getAccountInfo implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const result = await upgradedAdapter.getAccountInfo({} as any);

    expect(result.ok).toBeFalsy();
    if (!result.ok) {
      expect(result.error).toBe("AUTH");
    }
  });

  it("should provide working healthCheck implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const result = await upgradedAdapter.healthCheck();

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.healthy).toBe(true);
    }
  });
});

// ========================================
// TEST SUITE: Interface Structure Validation
// ========================================

describe("ProviderAdapterInterface - Interface Structure", () => {
  it("should validate metadata structure", () => {
    const fullAdapter = createMockFullAdapter();
    const metadata = fullAdapter.metadata;

    expect(metadata.id).toBeTruthy();
    expect(metadata.name).toBeTruthy();
    expect(metadata.displayName).toBeTruthy();
    expect(metadata.description).toBeTruthy();
    expect(metadata.icon).toBeTruthy();
    expect(metadata.color).toBeTruthy();
    expect(metadata.website).toBeTruthy();
    expect(["oauth", "api_key", "username_password"].includes(metadata.authType)).toBeTruthy();
    expect(
      ["active", "beta", "coming_soon", "maintenance", "deprecated"].includes(metadata.status)
    ).toBeTruthy();
  });

  it("should validate capabilities structure", () => {
    const fullAdapter = createMockFullAdapter();
    const capabilities = fullAdapter.capabilities;

    expect(typeof capabilities.publish).toBe("boolean");
    expect(typeof capabilities.schedule).toBe("boolean");
    expect(typeof capabilities.analytics).toBe("boolean");
    expect(typeof capabilities.comments).toBe("boolean");
    expect(typeof capabilities.replies).toBe("boolean");
    expect(typeof capabilities.threading).toBe("boolean");
  });

  it("should validate limits structure", () => {
    const fullAdapter = createMockFullAdapter();
    const limits = fullAdapter.limits;

    expect(typeof limits.maxChars).toBe("number");
    expect(typeof limits.maxMediaPerPost).toBe("number");
    expect(Array.isArray(limits.allowedMedia)).toBeTruthy();
  });

  it("should validate constraints structure", () => {
    const fullAdapter = createMockFullAdapter();
    const constraints = fullAdapter.constraints;

    expect(typeof constraints === "object").toBeTruthy();
  });
});

// ========================================
// TEST SUITE: Method Signature Validation
// ========================================

describe("ProviderAdapterInterface - Method Signatures", () => {
  it("should have async validateContent method", () => {
    const fullAdapter = createMockFullAdapter();

    expect(typeof fullAdapter.validateContent).toBe("function");
    const result = fullAdapter.validateContent({ content: "test", media: [] });
    expect(result instanceof Promise).toBeTruthy();
  });

  it("should have async adaptContent method", () => {
    const fullAdapter = createMockFullAdapter();

    expect(typeof fullAdapter.adaptContent).toBe("function");
    const result = fullAdapter.adaptContent(
      { content: "test", media: [] },
      "twitter" as ProviderId
    );
    expect(result instanceof Promise).toBeTruthy();
  });

  it("should have async generatePreview method", () => {
    const fullAdapter = createMockFullAdapter();

    expect(typeof fullAdapter.generatePreview).toBe("function");
    const result = fullAdapter.generatePreview({ content: "test", media: [] });
    expect(result instanceof Promise).toBeTruthy();
  });

  it("should have sync render method", () => {
    const fullAdapter = createMockFullAdapter();

    expect(typeof fullAdapter.render).toBe("function");
    const result = fullAdapter.render({ content: "test", media: [] });
    expect(result instanceof Promise).toBeFalsy();
  });

  it("should have async publish method", () => {
    const fullAdapter = createMockFullAdapter();

    expect(typeof fullAdapter.publish).toBe("function");
    const result = fullAdapter.publish({
      channelId: "ch-123",
      post: { type: "single" as const, content: {} },
      dedupeKey: "key",
      config: {} as any,
    });
    expect(result instanceof Promise).toBeTruthy();
  });

  it("should have async healthCheck method", () => {
    const fullAdapter = createMockFullAdapter();

    expect(typeof fullAdapter.healthCheck).toBe("function");
    const result = fullAdapter.healthCheck();
    expect(result instanceof Promise).toBeTruthy();
  });
});

// ========================================
// TEST SUITE: Edge Cases
// ========================================

describe("ProviderAdapterInterface - Edge Cases", () => {
  it("should handle empty content in preview generation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const preview = await upgradedAdapter.generatePreview({ content: "", media: [] });

    expect(preview.constraints.charactersUsed).toBe(0);
    expect(preview.constraints.charactersRemaining).toBe(280);
  });

  it("should handle missing content in preview generation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const preview = await upgradedAdapter.generatePreview({ media: [] } as any);

    expect(preview.constraints.charactersUsed).toBe(0);
  });

  it("should handle missing media in preview generation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const preview = await upgradedAdapter.generatePreview({ content: "test" } as any);

    expect(preview.constraints.mediaCount).toBe(0);
  });

  it("should handle adapter with different provider ID", () => {
    const instagramAdapter: LegacyProviderAdapter = {
      ...createMockLegacyAdapter(),
      id: "instagram" as ProviderId,
    };

    const upgraded = upgradeAdapter(instagramAdapter);

    expect(upgraded.id).toBe("instagram");
    expect(upgraded.metadata.id).toBe("instagram");
    expect(upgraded.metadata.displayName).toBe("INSTAGRAM");
  });

  it("should handle type guard with string primitive", () => {
    expect(isFullProviderAdapter("not an adapter")).toBe(false);
  });

  it("should handle type guard with number primitive", () => {
    expect(isFullProviderAdapter(123)).toBe(false);
  });

  it("should handle type guard with boolean primitive", () => {
    expect(isFullProviderAdapter(true)).toBe(false);
  });

  it("should handle type guard with array", () => {
    expect(isFullProviderAdapter([{ metadata: {} }])).toBe(false);
  });
});
