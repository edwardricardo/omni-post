/**
 * Comprehensive Tests for ProviderService
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the provider service layer which acts as a facade
 * over the provider registry, providing business-level operations for managing
 * social media provider integrations.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - Provider discovery and listing (all providers, active only, by capability)
 * - Provider metadata retrieval (config, limits, capabilities)
 * - Content validation against provider-specific constraints
 * - Error handling for invalid providers
 * - Edge cases (empty content, exact limits, boundary conditions)
 *
 * PROVIDER BUSINESS RULES:
 * - Each provider has unique character limits (X: 280, Instagram: 2200)
 * - Each provider has unique media limits (X: 4, Instagram: 10)
 * - Content validation must check all constraints before publishing
 * - Poor performing content filtering requires minimum view threshold (100 views)
 * - Active providers must have status === "active"
 *
 * DEPENDENCIES:
 * - Provider Registry: Real registry used (no mocking required)
 * - NO database required - pure service layer logic
 * - NO external API calls
 * - NO authentication required
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api test apps/api/tests/unit/providerService.test.ts
 *
 * @module ProviderServiceTests
 * @category UnitTests
 */

import { describe, it } from "node:test";
import * as assert from "node:assert";
import type { PrismaClient } from "@infra/prisma";
import { ProviderService } from "../../src/providers/providerService.js";

/** Minimal Prisma mock — these tests only exercise registry methods, not DB queries */
const mockPrisma = {} as unknown as PrismaClient;

// ========================================
// TEST SUITE: Get All Providers
// ========================================

describe("ProviderService - Get All Providers", () => {
  it("should return list of providers with correct structure", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getAllProviders();

    assert.ok(Array.isArray(result.providers), "Should return providers array");
    assert.strictEqual(typeof result.total, "number", "Should return total count");
    assert.strictEqual(
      result.total,
      result.providers.length,
      "Total should match providers length"
    );
  });

  it("should include complete provider metadata", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getAllProviders();

    if (result.providers.length > 0) {
      const provider = result.providers[0];
      assert.ok(provider !== undefined, "Should have at least one provider");
      assert.strictEqual(typeof provider.id, "string", "Provider should have id");
      assert.strictEqual(typeof provider.name, "string", "Provider should have name");
      assert.strictEqual(
        typeof provider.capabilities,
        "object",
        "Provider should have capabilities"
      );
      assert.strictEqual(typeof provider.limits, "object", "Provider should have limits");
    }
  });
});

// ========================================
// TEST SUITE: Get Active Providers
// ========================================

describe("ProviderService - Get Active Providers", () => {
  it("should return only active providers", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getActiveProviders();

    assert.ok(Array.isArray(result.providers), "Should return providers array");
    assert.ok(
      result.providers.every((p) => p.status === "active"),
      "All providers should have active status"
    );
  });

  it("should return correct total count matching array length", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getActiveProviders();

    assert.strictEqual(
      result.total,
      result.providers.length,
      "Total should match providers length"
    );
  });
});

// ========================================
// TEST SUITE: Get Providers by Capability
// ========================================

describe("ProviderService - Get Providers by Capability", () => {
  it("should return providers with threading capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("threading");

    assert.strictEqual(result.capability, "threading", "Should return queried capability");
    assert.ok(Array.isArray(result.providers), "Should return providers array");
    assert.ok(
      result.providers.every((p) => p.capabilities.threading === true),
      "All providers should support threading"
    );
  });

  it("should return providers with publish capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("publish");

    assert.strictEqual(result.capability, "publish", "Should return queried capability");
    assert.ok(result.providers.length > 0, "Should find providers with publish capability");
  });

  it("should return providers with schedule capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("schedule");

    assert.strictEqual(result.capability, "schedule", "Should return queried capability");
    assert.ok(
      result.providers.every((p) => p.capabilities.schedule === true),
      "All providers should support scheduling"
    );
  });

  it("should return providers with analytics capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("analytics");

    assert.strictEqual(result.capability, "analytics", "Should return queried capability");
    assert.ok(
      result.providers.every((p) => p.capabilities.analytics === true),
      "All providers should support analytics"
    );
  });

  it("should return providers with stories capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("stories");

    assert.strictEqual(result.capability, "stories", "Should return queried capability");
    assert.ok(
      result.providers.every((p) => p.capabilities.stories === true),
      "All providers should support stories"
    );
  });
});

// ========================================
// TEST SUITE: Get Provider by ID
// ========================================

describe("ProviderService - Get Provider by ID", () => {
  it("should return X provider with correct metadata", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderById("x");

    assert.strictEqual(result.id, "x", "Should return X provider");
    assert.strictEqual(result.name, "x", "Should have correct name");
    assert.strictEqual(result.displayName, "X (Twitter)", "Should have correct displayName");
  });

  it("should return Instagram provider with correct metadata", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderById("instagram");

    assert.strictEqual(result.id, "instagram", "Should return Instagram provider");
    assert.strictEqual(result.name, "instagram", "Should have correct name");
    assert.strictEqual(result.displayName, "Instagram", "Should have correct displayName");
  });

  it("should return null for unknown provider", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderById("nonexistent");

    assert.strictEqual(result, null, "Should return null for unknown provider");
  });
});

// ========================================
// TEST SUITE: Validate Provider Constraints
// ========================================

describe("ProviderService - Validate Provider Constraints", () => {
  it("should accept valid content for X within limits", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      text: "This is a valid tweet under 280 characters",
      mediaCount: 2,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Content should be valid");
      assert.strictEqual(result.value.errors, undefined, "Should have no errors");
    }
  });

  it("should reject text exceeding X character limit", async () => {
    const service = new ProviderService(mockPrisma);
    const longText = "a".repeat(300); // Exceeds X's 280 limit
    const result = await service.validateProviderConstraints("x", {
      text: longText,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, false, "Content should be invalid");
      assert.ok(Array.isArray(result.value.errors), "Should have errors array");
      assert.ok(
        result.value.errors.some((e) => e.includes("exceeds maximum length")),
        "Should mention character limit"
      );
    }
  });

  it("should reject media count exceeding X limit", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      text: "Valid text",
      mediaCount: 10, // Exceeds X's 4 media limit
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, false, "Content should be invalid");
      assert.ok(Array.isArray(result.value.errors), "Should have errors array");
      assert.ok(
        result.value.errors.some((e) => e.includes("Media count exceeds")),
        "Should mention media count limit"
      );
    }
  });

  it("should accept valid content for Instagram within limits", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("instagram", {
      text: "Valid Instagram caption under 2200 characters",
      mediaCount: 5,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Content should be valid");
      assert.strictEqual(result.value.errors, undefined, "Should have no errors");
    }
  });

  it("should handle multiple constraint violations", async () => {
    const service = new ProviderService(mockPrisma);
    const longText = "a".repeat(300);
    const result = await service.validateProviderConstraints("x", {
      text: longText,
      mediaCount: 10,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, false, "Content should be invalid");
      assert.ok(Array.isArray(result.value.errors), "Should have errors array");
      assert.ok(result.value.errors.length >= 2, "Should have multiple errors");
    }
  });

  it("should return error for unknown provider", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("nonexistent", {
      text: "Test",
    });

    assert.strictEqual(result.ok, false, "Validation should fail for unknown provider");
    if (!result.ok) {
      assert.ok(
        result.error.includes("Provider not found"),
        "Error should mention provider not found"
      );
    }
  });
});

// ========================================
// TEST SUITE: Get Provider Config
// ========================================

describe("ProviderService - Get Provider Config", () => {
  it("should return X configuration with all required fields", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderConfig("x");

    assert.strictEqual(result.id, "x", "Should return X provider config");
    assert.strictEqual(result.name, "x", "Should have correct name");
    assert.strictEqual(typeof result.capabilities, "object", "Should have capabilities");
    assert.strictEqual(typeof result.limits, "object", "Should have limits");
    assert.strictEqual(typeof result.displayName, "string", "Should have displayName");
    assert.strictEqual(result.displayName, "X (Twitter)", "Should have correct displayName");
  });

  it("should return Instagram configuration with all required fields", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderConfig("instagram");

    assert.strictEqual(result.id, "instagram", "Should return Instagram provider config");
    assert.strictEqual(typeof result.capabilities, "object", "Should have capabilities");
    assert.strictEqual(typeof result.limits, "object", "Should have limits");
  });

  it("should include capability details for all standard capabilities", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderConfig("x");

    const caps = result.capabilities;
    assert.strictEqual(typeof caps.publish, "boolean", "Should have publish capability");
    assert.strictEqual(typeof caps.schedule, "boolean", "Should have schedule capability");
    assert.strictEqual(typeof caps.analytics, "boolean", "Should have analytics capability");
    assert.strictEqual(typeof caps.threading, "boolean", "Should have threading capability");
  });

  it("should include limit details for content constraints", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderConfig("x");

    const limits = result.limits;
    assert.strictEqual(typeof limits.maxChars, "number", "Should have maxChars limit");
    assert.strictEqual(
      typeof limits.maxMediaPerPost,
      "number",
      "Should have maxMediaPerPost limit"
    );
  });

  it("should throw error for unknown provider", async () => {
    const service = new ProviderService(mockPrisma);

    await assert.rejects(
      async () => {
        await service.getProviderConfig("nonexistent");
      },
      {
        name: "Error",
        message: /Provider not found/,
      },
      "Should throw error for unknown provider"
    );
  });
});

// ========================================
// TEST SUITE: Edge Cases and Boundary Conditions
// ========================================

describe("ProviderService - Edge Cases", () => {
  it("should handle empty text validation", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      text: "",
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Empty text should be valid");
    }
  });

  it("should handle zero media count validation", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 0,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Zero media count should be valid");
    }
  });

  it("should handle validation with only text (no media)", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      text: "Just text, no media",
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Text-only content should be valid");
    }
  });

  it("should handle validation with only media (no text)", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 2,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Media-only content should be valid");
    }
  });

  it("should handle validation at exact character limit", async () => {
    const service = new ProviderService(mockPrisma);
    const exactLimitText = "a".repeat(280); // Exactly X's 280 limit
    const result = await service.validateProviderConstraints("x", {
      text: exactLimitText,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Content at exact limit should be valid");
    }
  });

  it("should handle validation at exact media limit", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 4, // Exactly X's 4 media limit
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, true, "Media at exact limit should be valid");
    }
  });

  it("should handle validation one character over limit", async () => {
    const service = new ProviderService(mockPrisma);
    const overLimitText = "a".repeat(281); // One over X's 280 limit
    const result = await service.validateProviderConstraints("x", {
      text: overLimitText,
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, false, "Content over limit should be invalid");
    }
  });

  it("should handle validation one media over limit", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 5, // One over X's 4 media limit
    });

    assert.strictEqual(result.ok, true, "Validation should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.valid, false, "Media over limit should be invalid");
    }
  });
});
