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
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

    assert.strictEqual(
      isFullProviderAdapter(fullAdapter),
      true,
      "Should identify full provider adapter"
    );
  });

  it("should reject legacy provider adapter", () => {
    const legacyAdapter = createMockLegacyAdapter();

    assert.strictEqual(
      isFullProviderAdapter(legacyAdapter),
      false,
      "Should reject legacy adapter without metadata"
    );
  });

  it("should reject null value", () => {
    assert.strictEqual(isFullProviderAdapter(null), false, "Should reject null");
  });

  it("should reject undefined value", () => {
    assert.strictEqual(isFullProviderAdapter(undefined), false, "Should reject undefined");
  });

  it("should reject plain object", () => {
    assert.strictEqual(isFullProviderAdapter({}), false, "Should reject empty object");
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

    assert.strictEqual(
      isFullProviderAdapter(partial),
      false,
      "Should reject partial implementation"
    );
  });

  it("should require metadata property", () => {
    const withoutMetadata = {
      validateContent: async () => ({}) as any,
      constraints: {},
    };

    assert.strictEqual(
      isFullProviderAdapter(withoutMetadata),
      false,
      "Should require metadata property"
    );
  });

  it("should require validateContent method", () => {
    const withoutValidateContent = {
      metadata: {} as any,
      constraints: {},
    };

    assert.strictEqual(
      isFullProviderAdapter(withoutValidateContent),
      false,
      "Should require validateContent method"
    );
  });

  it("should require constraints property", () => {
    const withoutConstraints = {
      metadata: {} as any,
      validateContent: async () => ({}) as any,
    };

    assert.strictEqual(
      isFullProviderAdapter(withoutConstraints),
      false,
      "Should require constraints property"
    );
  });
});

// ========================================
// TEST SUITE: Adapter Upgrade
// ========================================

describe("ProviderAdapterInterface - Adapter Upgrade", () => {
  it("should upgrade legacy adapter to full adapter", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    assert.ok(upgradedAdapter.metadata, "Upgraded adapter should have metadata");
    assert.ok(upgradedAdapter.constraints, "Upgraded adapter should have constraints");
    assert.strictEqual(
      typeof upgradedAdapter.validateContent,
      "function",
      "Should have validateContent method"
    );
    assert.strictEqual(
      typeof upgradedAdapter.adaptContent,
      "function",
      "Should have adaptContent method"
    );
    assert.strictEqual(
      typeof upgradedAdapter.generatePreview,
      "function",
      "Should have generatePreview method"
    );
  });

  it("should preserve original adapter properties", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    assert.strictEqual(upgradedAdapter.id, legacyAdapter.id, "Should preserve ID");
    assert.deepStrictEqual(upgradedAdapter.limits, legacyAdapter.limits, "Should preserve limits");
    assert.deepStrictEqual(
      upgradedAdapter.capabilities,
      legacyAdapter.capabilities,
      "Should preserve capabilities"
    );
  });

  it("should generate metadata from adapter ID", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    assert.strictEqual(upgradedAdapter.metadata.id, legacyAdapter.id, "Metadata ID should match");
    assert.strictEqual(
      upgradedAdapter.metadata.name,
      legacyAdapter.id,
      "Metadata name should match ID"
    );
    assert.strictEqual(
      upgradedAdapter.metadata.displayName,
      legacyAdapter.id.toUpperCase(),
      "Display name should be uppercase ID"
    );
    assert.ok(upgradedAdapter.metadata.description, "Should have description");
  });

  it("should set default auth type to OAuth", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    assert.strictEqual(
      upgradedAdapter.metadata.authType,
      "oauth",
      "Default auth type should be OAuth"
    );
  });

  it("should set status to active", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    assert.strictEqual(
      upgradedAdapter.metadata.status,
      "active",
      "Status should be active by default"
    );
  });

  it("should provide empty constraints by default", () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    assert.deepStrictEqual(upgradedAdapter.constraints, {}, "Constraints should be empty object");
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

    assert.ok(result, "Should return validation result");
    assert.strictEqual(typeof result.valid, "boolean", "Should have valid flag");
    assert.ok(Array.isArray(result.errors), "Should have errors array");
    assert.ok(Array.isArray(result.suggestions), "Should have suggestions array");
    assert.ok(Array.isArray(result.adaptations), "Should have adaptations array");
  });

  it("should validate content using render method", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = {
      content: "Valid content",
      media: [],
    };

    const result = await upgradedAdapter.validateContent(canonical);

    assert.strictEqual(result.valid, true, "Valid content should pass validation");
    assert.strictEqual(result.errors.length, 0, "Should have no errors for valid content");
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

    assert.strictEqual(result.valid, false, "Should mark as invalid when render fails");
    assert.ok(result.errors.length > 0, "Should have errors when render fails");
  });

  it("should provide working adaptContent implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = { content: "Test", media: [] };
    const result = await upgradedAdapter.adaptContent(canonical);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.deepStrictEqual(
        result.value,
        canonical,
        "Default adaptation should return unchanged content"
      );
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

    assert.strictEqual(preview.providerId, legacyAdapter.id, "Should use correct provider ID");
    assert.ok(preview.content, "Should have content");
    assert.ok(preview.constraints, "Should have constraints");
    assert.ok(Array.isArray(preview.warnings), "Should have warnings array");
  });

  it("should calculate character counts in preview", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const canonical = {
      content: "Hello",
      media: [],
    };

    const preview = await upgradedAdapter.generatePreview(canonical);

    assert.strictEqual(preview.constraints.charactersUsed, 5, "Should count characters used");
    assert.strictEqual(
      preview.constraints.charactersRemaining,
      275,
      "Should calculate remaining (280-5)"
    );
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

    assert.strictEqual(preview.constraints.mediaCount, 2, "Should count media items");
    assert.strictEqual(preview.constraints.mediaLimit, 4, "Should use adapter media limit");
  });

  it("should provide working getAccountInfo implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const result = await upgradedAdapter.getAccountInfo({} as any);

    assert.ok(!result.ok, "Default implementation should return error");
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH", "Should return AUTH error");
    }
  });

  it("should provide working healthCheck implementation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const result = await upgradedAdapter.healthCheck();

    assert.ok(result.ok, "Default health check should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.healthy, true, "Should report healthy status");
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

    assert.ok(metadata.id, "Metadata should have ID");
    assert.ok(metadata.name, "Metadata should have name");
    assert.ok(metadata.displayName, "Metadata should have display name");
    assert.ok(metadata.description, "Metadata should have description");
    assert.ok(metadata.icon, "Metadata should have icon");
    assert.ok(metadata.color, "Metadata should have color");
    assert.ok(metadata.website, "Metadata should have website");
    assert.ok(
      ["oauth", "api_key", "username_password"].includes(metadata.authType),
      "Should have valid auth type"
    );
    assert.ok(
      ["active", "beta", "coming_soon", "maintenance", "deprecated"].includes(metadata.status),
      "Should have valid status"
    );
  });

  it("should validate capabilities structure", () => {
    const fullAdapter = createMockFullAdapter();
    const capabilities = fullAdapter.capabilities;

    assert.strictEqual(typeof capabilities.publish, "boolean", "publish should be boolean");
    assert.strictEqual(typeof capabilities.schedule, "boolean", "schedule should be boolean");
    assert.strictEqual(typeof capabilities.analytics, "boolean", "analytics should be boolean");
    assert.strictEqual(typeof capabilities.comments, "boolean", "comments should be boolean");
    assert.strictEqual(typeof capabilities.replies, "boolean", "replies should be boolean");
    assert.strictEqual(typeof capabilities.threading, "boolean", "threading should be boolean");
  });

  it("should validate limits structure", () => {
    const fullAdapter = createMockFullAdapter();
    const limits = fullAdapter.limits;

    assert.strictEqual(typeof limits.maxChars, "number", "maxChars should be number");
    assert.strictEqual(typeof limits.maxMediaPerPost, "number", "maxMediaPerPost should be number");
    assert.ok(Array.isArray(limits.allowedMedia), "allowedMedia should be array");
  });

  it("should validate constraints structure", () => {
    const fullAdapter = createMockFullAdapter();
    const constraints = fullAdapter.constraints;

    assert.ok(typeof constraints === "object", "Constraints should be object");
  });
});

// ========================================
// TEST SUITE: Method Signature Validation
// ========================================

describe("ProviderAdapterInterface - Method Signatures", () => {
  it("should have async validateContent method", () => {
    const fullAdapter = createMockFullAdapter();

    assert.strictEqual(
      typeof fullAdapter.validateContent,
      "function",
      "validateContent should be function"
    );
    const result = fullAdapter.validateContent({ content: "test", media: [] });
    assert.ok(result instanceof Promise, "validateContent should return Promise");
  });

  it("should have async adaptContent method", () => {
    const fullAdapter = createMockFullAdapter();

    assert.strictEqual(
      typeof fullAdapter.adaptContent,
      "function",
      "adaptContent should be function"
    );
    const result = fullAdapter.adaptContent(
      { content: "test", media: [] },
      "twitter" as ProviderId
    );
    assert.ok(result instanceof Promise, "adaptContent should return Promise");
  });

  it("should have async generatePreview method", () => {
    const fullAdapter = createMockFullAdapter();

    assert.strictEqual(
      typeof fullAdapter.generatePreview,
      "function",
      "generatePreview should be function"
    );
    const result = fullAdapter.generatePreview({ content: "test", media: [] });
    assert.ok(result instanceof Promise, "generatePreview should return Promise");
  });

  it("should have sync render method", () => {
    const fullAdapter = createMockFullAdapter();

    assert.strictEqual(typeof fullAdapter.render, "function", "render should be function");
    const result = fullAdapter.render({ content: "test", media: [] });
    assert.ok(!(result instanceof Promise), "render should be synchronous");
  });

  it("should have async publish method", () => {
    const fullAdapter = createMockFullAdapter();

    assert.strictEqual(typeof fullAdapter.publish, "function", "publish should be function");
    const result = fullAdapter.publish({
      channelId: "ch-123",
      post: { type: "single" as const, content: {} },
      dedupeKey: "key",
      config: {} as any,
    });
    assert.ok(result instanceof Promise, "publish should return Promise");
  });

  it("should have async healthCheck method", () => {
    const fullAdapter = createMockFullAdapter();

    assert.strictEqual(
      typeof fullAdapter.healthCheck,
      "function",
      "healthCheck should be function"
    );
    const result = fullAdapter.healthCheck();
    assert.ok(result instanceof Promise, "healthCheck should return Promise");
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

    assert.strictEqual(preview.constraints.charactersUsed, 0, "Empty content should be 0 chars");
    assert.strictEqual(
      preview.constraints.charactersRemaining,
      280,
      "Should have full character limit"
    );
  });

  it("should handle missing content in preview generation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const preview = await upgradedAdapter.generatePreview({ media: [] } as any);

    assert.strictEqual(preview.constraints.charactersUsed, 0, "Missing content should be 0 chars");
  });

  it("should handle missing media in preview generation", async () => {
    const legacyAdapter = createMockLegacyAdapter();
    const upgradedAdapter = upgradeAdapter(legacyAdapter);

    const preview = await upgradedAdapter.generatePreview({ content: "test" } as any);

    assert.strictEqual(preview.constraints.mediaCount, 0, "Missing media should be 0 count");
  });

  it("should handle adapter with different provider ID", () => {
    const instagramAdapter: LegacyProviderAdapter = {
      ...createMockLegacyAdapter(),
      id: "instagram" as ProviderId,
    };

    const upgraded = upgradeAdapter(instagramAdapter);

    assert.strictEqual(upgraded.id, "instagram", "Should preserve Instagram ID");
    assert.strictEqual(upgraded.metadata.id, "instagram", "Metadata should use Instagram ID");
    assert.strictEqual(
      upgraded.metadata.displayName,
      "INSTAGRAM",
      "Display name should be INSTAGRAM"
    );
  });

  it("should handle type guard with string primitive", () => {
    assert.strictEqual(
      isFullProviderAdapter("not an adapter"),
      false,
      "Should reject string primitive"
    );
  });

  it("should handle type guard with number primitive", () => {
    assert.strictEqual(isFullProviderAdapter(123), false, "Should reject number primitive");
  });

  it("should handle type guard with boolean primitive", () => {
    assert.strictEqual(isFullProviderAdapter(true), false, "Should reject boolean primitive");
  });

  it("should handle type guard with array", () => {
    assert.strictEqual(isFullProviderAdapter([{ metadata: {} }]), false, "Should reject array");
  });
});
