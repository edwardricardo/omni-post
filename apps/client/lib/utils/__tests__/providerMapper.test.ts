/**
 * @file providerMapper.test.ts
 * @description Mutation-killing tests for providerMapper utility functions.
 * Covers mapProvidersToMetadata, mapCapabilities, default limits,
 * default colors, scopes, and fallback behavior.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mapProvidersToMetadata } from "../providerMapper.js";
import type { Provider } from "@/lib/api/types";

// ============================================================================
// Helpers
// ============================================================================

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "x",
    name: "x",
    displayName: "X (Twitter)",
    type: "social",
    capabilities: ["publish", "schedule", "analytics", "threading"],
    isActive: true,
    ...overrides,
  };
}

// ============================================================================
// mapProvidersToMetadata
// ============================================================================

describe("mapProvidersToMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps an array of providers to metadata", () => {
    const providers = [
      makeProvider(),
      makeProvider({ id: "instagram", name: "instagram", displayName: "Instagram" }),
    ];
    const result = mapProvidersToMetadata(providers);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("x");
    expect(result[1]?.id).toBe("instagram");
  });

  it("returns empty array for empty input", () => {
    const result = mapProvidersToMetadata([]);
    expect(result).toEqual([]);
  });

  // =========================================================================
  // Basic field mapping
  // =========================================================================

  describe("basic field mapping", () => {
    it("maps id, name, displayName", () => {
      const [meta] = mapProvidersToMetadata([
        makeProvider({ id: "linkedin", name: "linkedin", displayName: "LinkedIn" }),
      ]);
      expect(meta?.id).toBe("linkedin");
      expect(meta?.name).toBe("linkedin");
      expect(meta?.displayName).toBe("LinkedIn");
    });

    it("uses iconUrl from provider when available", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ iconUrl: "/custom/icon.svg" })]);
      expect(meta?.icon).toBe("/custom/icon.svg");
    });

    it("falls back to generated icon path when iconUrl missing", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "facebook", iconUrl: undefined })]);
      expect(meta?.icon).toBe("/icons/facebook.svg");
    });

    it("maps isActive=true to status=active", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ isActive: true })]);
      expect(meta?.status).toBe("active");
    });

    it("maps isActive=false to status=maintenance", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ isActive: false })]);
      expect(meta?.status).toBe("maintenance");
    });

    it("uses provider description when available", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ description: "Custom description" })]);
      expect(meta?.description).toBe("Custom description");
    });

    it("generates default description when missing", () => {
      const [meta] = mapProvidersToMetadata([
        makeProvider({ description: undefined, displayName: "Facebook" }),
      ]);
      expect(meta?.description).toBe("Connect your Facebook account");
    });

    it("sets authType to oauth by default", () => {
      const [meta] = mapProvidersToMetadata([makeProvider()]);
      expect(meta?.authType).toBe("oauth");
    });
  });

  // =========================================================================
  // Capabilities mapping
  // =========================================================================

  describe("capabilities mapping", () => {
    it("maps publish capability", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ capabilities: ["publish"] })]);
      expect(meta?.capabilities.publish).toBe(true);
      expect(meta?.capabilities.schedule).toBe(false);
    });

    it("maps all capabilities correctly", () => {
      const allCaps = [
        "publish",
        "schedule",
        "analytics",
        "comments",
        "replies",
        "threading",
        "stories",
        "reels",
        "carousel",
      ] as Provider["capabilities"];
      const [meta] = mapProvidersToMetadata([makeProvider({ capabilities: allCaps })]);
      expect(meta?.capabilities.publish).toBe(true);
      expect(meta?.capabilities.schedule).toBe(true);
      expect(meta?.capabilities.analytics).toBe(true);
      expect(meta?.capabilities.comments).toBe(true);
      expect(meta?.capabilities.replies).toBe(true);
      expect(meta?.capabilities.threading).toBe(true);
      expect(meta?.capabilities.stories).toBe(true);
      expect(meta?.capabilities.reels).toBe(true);
      expect(meta?.capabilities.carousel).toBe(true);
    });

    it("returns all false for empty capabilities", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ capabilities: [] })]);
      expect(meta?.capabilities.publish).toBe(false);
      expect(meta?.capabilities.schedule).toBe(false);
      expect(meta?.capabilities.analytics).toBe(false);
      expect(meta?.capabilities.threading).toBe(false);
    });
  });

  // =========================================================================
  // Default limits
  // =========================================================================

  describe("default limits", () => {
    it("uses X limits for provider id 'x'", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "x" })]);
      expect(meta?.limits.maxChars).toBe(280);
      expect(meta?.limits.maxMediaPerPost).toBe(4);
      expect(meta?.limits.maxPostsPerThread).toBe(25);
      expect(meta?.limits.maxVideoDuration).toBe(140);
      expect(meta?.limits.maxImageSize).toBe(5 * 1024 * 1024);
    });

    it("uses Twitter limits for provider id 'twitter'", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "twitter", name: "twitter" })]);
      expect(meta?.limits.maxChars).toBe(280);
      expect(meta?.limits.maxMediaPerPost).toBe(4);
    });

    it("uses Instagram limits for provider id 'instagram'", () => {
      const [meta] = mapProvidersToMetadata([
        makeProvider({ id: "instagram", name: "instagram", displayName: "Instagram" }),
      ]);
      expect(meta?.limits.maxChars).toBe(2200);
      expect(meta?.limits.maxMediaPerPost).toBe(10);
      expect(meta?.limits.maxVideoDuration).toBe(60);
      expect(meta?.limits.maxImageSize).toBe(8 * 1024 * 1024);
    });

    it("uses LinkedIn limits for provider id 'linkedin'", () => {
      const [meta] = mapProvidersToMetadata([
        makeProvider({ id: "linkedin", name: "linkedin", displayName: "LinkedIn" }),
      ]);
      expect(meta?.limits.maxChars).toBe(3000);
      expect(meta?.limits.maxMediaPerPost).toBe(20);
      expect(meta?.limits.maxVideoDuration).toBe(600);
      expect(meta?.limits.maxImageSize).toBe(10 * 1024 * 1024);
    });

    it("uses Facebook limits for provider id 'facebook'", () => {
      const [meta] = mapProvidersToMetadata([
        makeProvider({ id: "facebook", name: "facebook", displayName: "Facebook" }),
      ]);
      expect(meta?.limits.maxChars).toBe(63206);
      expect(meta?.limits.maxMediaPerPost).toBe(30);
      expect(meta?.limits.maxVideoDuration).toBe(240);
    });

    it("falls back to X defaults for unknown provider", () => {
      const [meta] = mapProvidersToMetadata([
        makeProvider({ id: "unknown-platform", name: "unknown" }),
      ]);
      expect(meta?.limits.maxChars).toBe(280);
      expect(meta?.limits.maxMediaPerPost).toBe(4);
      expect(meta?.limits.maxPostsPerThread).toBe(25);
    });
  });

  // =========================================================================
  // Default colors
  // =========================================================================

  describe("default colors", () => {
    it("uses correct color for X", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "x" })]);
      expect(meta?.color).toBe("#1DA1F2");
    });

    it("uses correct color for Instagram", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "instagram" })]);
      expect(meta?.color).toBe("#E4405F");
    });

    it("uses correct color for LinkedIn", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "linkedin" })]);
      expect(meta?.color).toBe("#0077B5");
    });

    it("uses correct color for Facebook", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "facebook" })]);
      expect(meta?.color).toBe("#1877F2");
    });

    it("uses correct color for YouTube", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "youtube" })]);
      expect(meta?.color).toBe("#FF0000");
    });

    it("uses correct color for TikTok", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "tiktok" })]);
      expect(meta?.color).toBe("#000000");
    });

    it("uses correct color for Pinterest", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "pinterest" })]);
      expect(meta?.color).toBe("#E60023");
    });

    it("falls back to gray for unknown provider", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "unknown" })]);
      expect(meta?.color).toBe("#6B7280");
    });
  });

  // =========================================================================
  // Default scopes
  // =========================================================================

  describe("default scopes", () => {
    it("returns X scopes for id 'x'", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "x" })]);
      expect(meta?.requiredScopes).toEqual(["read", "write"]);
    });

    it("returns Twitter scopes for id 'twitter'", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "twitter" })]);
      expect(meta?.requiredScopes).toEqual(["read", "write"]);
    });

    it("returns Instagram scopes", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "instagram" })]);
      expect(meta?.requiredScopes).toEqual(["basic", "content_publish"]);
    });

    it("returns LinkedIn scopes", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "linkedin" })]);
      expect(meta?.requiredScopes).toEqual(["r_liteprofile", "w_member_social"]);
    });

    it("returns Facebook scopes", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "facebook" })]);
      expect(meta?.requiredScopes).toEqual(["pages_show_list", "pages_manage_posts"]);
    });

    it("returns empty scopes for unknown provider", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "snapchat" })]);
      expect(meta?.requiredScopes).toEqual([]);
    });
  });

  // =========================================================================
  // Allowed media type mapping
  // =========================================================================

  describe("allowed media types", () => {
    it("includes correct media types for X", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "x" })]);
      expect(meta?.limits.allowedMedia).toContain("image/jpeg");
      expect(meta?.limits.allowedMedia).toContain("image/gif");
      expect(meta?.limits.allowedMedia).toContain("video/mp4");
      expect(meta?.limits.allowedMedia).toContain("image/png");
    });

    it("includes correct media types for LinkedIn (with PDF)", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "linkedin" })]);
      expect(meta?.limits.allowedMedia).toContain("application/pdf");
      expect(meta?.limits.allowedMedia).toContain("image/jpeg");
      expect(meta?.limits.allowedMedia).toContain("video/mp4");
    });

    it("includes correct media types for Instagram", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "instagram" })]);
      expect(meta?.limits.allowedMedia).toContain("image/jpeg");
      expect(meta?.limits.allowedMedia).toContain("video/mp4");
      expect(meta?.limits.allowedMedia).not.toContain("image/gif");
    });

    it("includes correct media types for Facebook", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "facebook" })]);
      expect(meta?.limits.allowedMedia).toContain("image/jpeg");
      expect(meta?.limits.allowedMedia).toContain("image/gif");
    });
  });

  // =========================================================================
  // Specific limit values
  // =========================================================================

  describe("specific limit values", () => {
    it("X maxVideoDuration is 140", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "x" })]);
      expect(meta?.limits.maxVideoDuration).toBe(140);
    });

    it("Instagram maxVideoDuration is 60", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "instagram" })]);
      expect(meta?.limits.maxVideoDuration).toBe(60);
    });

    it("LinkedIn maxVideoDuration is 600", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "linkedin" })]);
      expect(meta?.limits.maxVideoDuration).toBe(600);
    });

    it("Facebook maxVideoDuration is 240", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "facebook" })]);
      expect(meta?.limits.maxVideoDuration).toBe(240);
    });

    it("X aspectRatios include 16:9, 1:1, 4:5", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "x" })]);
      expect(meta?.limits.aspectRatios).toContain("16:9");
      expect(meta?.limits.aspectRatios).toContain("1:1");
      expect(meta?.limits.aspectRatios).toContain("4:5");
    });

    it("Instagram aspectRatios include 1:1, 4:5, 16:9", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "instagram" })]);
      expect(meta?.limits.aspectRatios).toContain("1:1");
      expect(meta?.limits.aspectRatios).toContain("4:5");
    });

    it("LinkedIn aspectRatios include 1.91:1", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "linkedin" })]);
      expect(meta?.limits.aspectRatios).toContain("1.91:1");
    });

    it("fallback maxImageSize is 5MB", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "unknown" })]);
      expect(meta?.limits.maxImageSize).toBe(5 * 1024 * 1024);
    });

    it("fallback maxVideoDuration is 140", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "unknown" })]);
      expect(meta?.limits.maxVideoDuration).toBe(140);
    });

    it("fallback aspectRatios", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "unknown" })]);
      expect(meta?.limits.aspectRatios).toEqual(["16:9", "1:1", "4:5"]);
    });

    it("fallback allowedMedia", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "unknown" })]);
      expect(meta?.limits.allowedMedia).toEqual([
        "image/jpeg",
        "image/png",
        "image/gif",
        "video/mp4",
      ]);
    });
  });

  // =========================================================================
  // Color exact values
  // =========================================================================

  describe("exact color values", () => {
    it("twitter color is #1DA1F2", () => {
      const [meta] = mapProvidersToMetadata([makeProvider({ id: "twitter" })]);
      expect(meta?.color).toBe("#1DA1F2");
    });
  });
});
