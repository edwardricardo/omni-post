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

import { describe, it, expect } from "vitest";
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

    expect(Array.isArray(result.providers)).toBeTruthy();
    expect(typeof result.total).toBe("number");
    expect(result.total).toBe(result.providers.length);
  });

  it("should include complete provider metadata", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getAllProviders();

    if (result.providers.length > 0) {
      const provider = result.providers[0];
      expect(provider !== undefined).toBeTruthy();
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.name).toBe("string");
      expect(typeof provider.capabilities).toBe("object");
      expect(typeof provider.limits).toBe("object");
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

    expect(Array.isArray(result.providers)).toBeTruthy();
    expect(result.providers.every((p) => p.status === "active")).toBeTruthy();
  });

  it("should return correct total count matching array length", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getActiveProviders();

    expect(result.total).toBe(result.providers.length);
  });
});

// ========================================
// TEST SUITE: Get Providers by Capability
// ========================================

describe("ProviderService - Get Providers by Capability", () => {
  it("should return providers with threading capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("threading");

    expect(result.capability).toBe("threading");
    expect(Array.isArray(result.providers)).toBeTruthy();
    expect(result.providers.every((p) => p.capabilities.threading === true)).toBeTruthy();
  });

  it("should return providers with publish capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("publish");

    expect(result.capability).toBe("publish");
    expect(result.providers.length > 0).toBeTruthy();
  });

  it("should return providers with schedule capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("schedule");

    expect(result.capability).toBe("schedule");
    expect(result.providers.every((p) => p.capabilities.schedule === true)).toBeTruthy();
  });

  it("should return providers with analytics capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("analytics");

    expect(result.capability).toBe("analytics");
    expect(result.providers.every((p) => p.capabilities.analytics === true)).toBeTruthy();
  });

  it("should return providers with stories capability", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProvidersByCapability("stories");

    expect(result.capability).toBe("stories");
    expect(result.providers.every((p) => p.capabilities.stories === true)).toBeTruthy();
  });
});

// ========================================
// TEST SUITE: Get Provider by ID
// ========================================

describe("ProviderService - Get Provider by ID", () => {
  it("should return X provider with correct metadata", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderById("x");

    expect(result.id).toBe("x");
    expect(result.name).toBe("x");
    expect(result.displayName).toBe("X (Twitter)");
  });

  it("should return Instagram provider with correct metadata", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderById("instagram");

    expect(result.id).toBe("instagram");
    expect(result.name).toBe("instagram");
    expect(result.displayName).toBe("Instagram");
  });

  it("should return null for unknown provider", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderById("nonexistent");

    expect(result).toBe(null);
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.errors).toBe(undefined);
    }
  });

  it("should reject text exceeding X character limit", async () => {
    const service = new ProviderService(mockPrisma);
    const longText = "a".repeat(300); // Exceeds X's 280 limit
    const result = await service.validateProviderConstraints("x", {
      text: longText,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(Array.isArray(result.value.errors)).toBeTruthy();
      expect(result.value.errors.some((e) => e.includes("exceeds maximum length"))).toBeTruthy();
    }
  });

  it("should reject media count exceeding X limit", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      text: "Valid text",
      mediaCount: 10, // Exceeds X's 4 media limit
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(Array.isArray(result.value.errors)).toBeTruthy();
      expect(result.value.errors.some((e) => e.includes("Media count exceeds"))).toBeTruthy();
    }
  });

  it("should accept valid content for Instagram within limits", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("instagram", {
      text: "Valid Instagram caption under 2200 characters",
      mediaCount: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.errors).toBe(undefined);
    }
  });

  it("should handle multiple constraint violations", async () => {
    const service = new ProviderService(mockPrisma);
    const longText = "a".repeat(300);
    const result = await service.validateProviderConstraints("x", {
      text: longText,
      mediaCount: 10,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      expect(Array.isArray(result.value.errors)).toBeTruthy();
      expect(result.value.errors.length >= 2).toBeTruthy();
    }
  });

  it("should return error for unknown provider", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("nonexistent", {
      text: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.includes("Provider not found")).toBeTruthy();
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

    expect(result.id).toBe("x");
    expect(result.name).toBe("x");
    expect(typeof result.capabilities).toBe("object");
    expect(typeof result.limits).toBe("object");
    expect(typeof result.displayName).toBe("string");
    expect(result.displayName).toBe("X (Twitter)");
  });

  it("should return Instagram configuration with all required fields", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderConfig("instagram");

    expect(result.id).toBe("instagram");
    expect(typeof result.capabilities).toBe("object");
    expect(typeof result.limits).toBe("object");
  });

  it("should include capability details for all standard capabilities", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderConfig("x");

    const caps = result.capabilities;
    expect(typeof caps.publish).toBe("boolean");
    expect(typeof caps.schedule).toBe("boolean");
    expect(typeof caps.analytics).toBe("boolean");
    expect(typeof caps.threading).toBe("boolean");
  });

  it("should include limit details for content constraints", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.getProviderConfig("x");

    const limits = result.limits;
    expect(typeof limits.maxChars).toBe("number");
    expect(typeof limits.maxMediaPerPost).toBe("number");
  });

  it("should throw error for unknown provider", async () => {
    const service = new ProviderService(mockPrisma);

    await expect(service.getProviderConfig("nonexistent")).rejects.toThrow(/Provider not found/);
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it("should handle zero media count validation", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it("should handle validation with only text (no media)", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      text: "Just text, no media",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it("should handle validation with only media (no text)", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 2,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it("should handle validation at exact character limit", async () => {
    const service = new ProviderService(mockPrisma);
    const exactLimitText = "a".repeat(280); // Exactly X's 280 limit
    const result = await service.validateProviderConstraints("x", {
      text: exactLimitText,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it("should handle validation at exact media limit", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 4, // Exactly X's 4 media limit
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it("should handle validation one character over limit", async () => {
    const service = new ProviderService(mockPrisma);
    const overLimitText = "a".repeat(281); // One over X's 280 limit
    const result = await service.validateProviderConstraints("x", {
      text: overLimitText,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
    }
  });

  it("should handle validation one media over limit", async () => {
    const service = new ProviderService(mockPrisma);
    const result = await service.validateProviderConstraints("x", {
      mediaCount: 5, // One over X's 4 media limit
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
    }
  });
});
