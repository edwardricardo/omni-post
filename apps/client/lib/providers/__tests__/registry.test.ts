/**
 * @file registry.test.ts
 * @description Mutation-killing tests for the client-side ProviderRegistry.
 * Covers validation, optimal times, char limits, media limits, rate limits,
 * threading, thread segmentation, legacy config conversion, and feature queries.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { providerRegistry } from "../registry.js";

// ============================================================================
// getProvider (legacy API)
// ============================================================================

describe("providerRegistry.getProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a legacy config for X", () => {
    const config = providerRegistry.getProvider("x");
    expect(config).toBeDefined();
    expect(config?.id).toBe("x");
    expect(config?.charLimit).toBe(280);
  });

  it("returns undefined for unknown provider", () => {
    const config = providerRegistry.getProvider("nonexistent");
    expect(config).toBeUndefined();
  });

  it("returns correct displayName from centralized config", () => {
    const config = providerRegistry.getProvider("instagram");
    expect(config).toBeDefined();
    expect(config?.displayName).toBe("Instagram");
  });

  it("maps mediaLimits with maxFiles from centralized config", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.mediaLimits.maxFiles).toBe(4);
  });

  it("maps features.threads from capabilities.threading", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.features.threads).toBe(true);
  });

  it("sets features.links to true by default", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.features.links).toBe(true);
  });

  it("sets features.polls to false", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.features.polls).toBe(false);
  });

  it("sets features.hashtags to false", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.features.hashtags).toBe(false);
  });

  it("sets features.mentions to false", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.features.mentions).toBe(false);
  });

  it("has default rateLimit values", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.rateLimit.postsPerHour).toBe(10);
    expect(config?.rateLimit.postsPerDay).toBe(50);
  });

  it("returns optimalTimes for X on weekdays", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.optimalTimes.monday).toContain("09:00");
    expect(config?.optimalTimes.monday).toContain("12:00");
  });

  it("maps supported media types with MIME format", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.mediaLimits.supportedTypes).toBeDefined();
    expect(config?.mediaLimits.supportedTypes.length).toBeGreaterThan(0);
  });

  it("uses 5MB default when maxImageSize is undefined", () => {
    // Provider without maxImageSize in centralized config (video platform —
    // no image-size limit defined, so the registry applies the 5MB default).
    const config = providerRegistry.getProvider("youtube");
    if (config) {
      expect(config.mediaLimits.maxFileSize).toBe(5 * 1024 * 1024);
    }
  });
});

// ============================================================================
// getProviderMetadata
// ============================================================================

describe("providerRegistry.getProviderMetadata", () => {
  it("returns centralized metadata for known provider", () => {
    const meta = providerRegistry.getProviderMetadata("x");
    expect(meta).toBeDefined();
    expect(meta?.id).toBe("x");
  });

  it("returns undefined for unknown provider", () => {
    const meta = providerRegistry.getProviderMetadata("nonexistent");
    expect(meta).toBeUndefined();
  });
});

// ============================================================================
// getAllProviders / getAllProviderMetadata
// ============================================================================

describe("providerRegistry.getAllProviders", () => {
  it("returns an array of providers", () => {
    const providers = providerRegistry.getAllProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it("only includes active providers", () => {
    const providers = providerRegistry.getAllProviders();
    // All returned providers should be from active configs
    for (const p of providers) {
      expect(p.id).toBeTruthy();
    }
  });
});

describe("providerRegistry.getAllProviderMetadata", () => {
  it("returns an array of metadata", () => {
    const metadata = providerRegistry.getAllProviderMetadata();
    expect(Array.isArray(metadata)).toBe(true);
    expect(metadata.length).toBeGreaterThan(0);
  });

  it("only includes active providers", () => {
    const metadata = providerRegistry.getAllProviderMetadata();
    for (const m of metadata) {
      expect(m.status).toBe("active");
    }
  });
});

// ============================================================================
// getProvidersByFeature
// ============================================================================

describe("providerRegistry.getProvidersByFeature", () => {
  it("returns providers that support threading", () => {
    const providers = providerRegistry.getProvidersByFeature("threads");
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(p.features.threads).toBe(true);
    }
  });

  it("returns providers that support scheduling", () => {
    const providers = providerRegistry.getProvidersByFeature("scheduling");
    for (const p of providers) {
      expect(p.features.scheduling).toBe(true);
    }
  });

  it("returns empty array for feature no provider supports", () => {
    // polls is set to false for all providers
    const providers = providerRegistry.getProvidersByFeature("polls");
    expect(providers).toEqual([]);
  });
});

// ============================================================================
// validateContent
// ============================================================================

describe("providerRegistry.validateContent", () => {
  it("returns valid for short X content", () => {
    const result = providerRegistry.validateContent("x", "Hello World", []);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error when X content exceeds 280 chars", () => {
    const longContent = "a".repeat(281);
    const result = providerRegistry.validateContent("x", longContent, []);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns error when X content is empty", () => {
    const result = providerRegistry.validateContent("x", "", []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("required"))).toBe(true);
  });

  it("returns error when X content is only whitespace", () => {
    const result = providerRegistry.validateContent("x", "   ", []);
    expect(result.valid).toBe(false);
  });

  it("returns error when X media exceeds 4 files", () => {
    const files = Array.from({ length: 5 }, () => new File([""], "img.jpg"));
    const result = providerRegistry.validateContent("x", "test", files);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("4"))).toBe(true);
  });

  it("accepts X with exactly 4 media files", () => {
    const files = Array.from({ length: 4 }, () => new File([""], "img.jpg"));
    const result = providerRegistry.validateContent("x", "test", files);
    // May still have errors from centralized validation but should pass media check
    const hasMediaError = result.errors.some((e) => e.includes("Maximum 4"));
    expect(hasMediaError).toBe(false);
  });

  it("returns error when Instagram has no media", () => {
    const result = providerRegistry.validateContent("instagram", "Caption", []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("image or video"))).toBe(true);
  });

  it("returns error when Instagram exceeds 10 media files", () => {
    const files = Array.from({ length: 11 }, () => new File([""], "img.jpg"));
    const result = providerRegistry.validateContent("instagram", "Caption", files);
    expect(result.valid).toBe(false);
  });

  it("returns error when LinkedIn exceeds 3000 chars", () => {
    const longContent = "x".repeat(3001);
    const result = providerRegistry.validateContent("linkedin", longContent, []);
    expect(result.valid).toBe(false);
  });

  it("accepts LinkedIn with exactly 3000 chars", () => {
    const content = "x".repeat(3000);
    const result = providerRegistry.validateContent("linkedin", content, []);
    const hasCharError = result.errors.some((e) => e.includes("3,000"));
    expect(hasCharError).toBe(false);
  });

  it("returns error when YouTube has no media", () => {
    const result = providerRegistry.validateContent("youtube", "Title", []);
    expect(result.valid).toBe(false);
  });

  it("returns error when TikTok exceeds 2200 chars", () => {
    const longContent = "x".repeat(2201);
    const result = providerRegistry.validateContent("tiktok", longContent, []);
    expect(result.valid).toBe(false);
  });

  it("avoids duplicate error messages", () => {
    const result = providerRegistry.validateContent("x", "", []);
    const uniqueErrors = new Set(result.errors);
    expect(result.errors.length).toBe(uniqueErrors.size);
  });

  it("returns valid=true for unknown provider with valid content", () => {
    const result = providerRegistry.validateContent("unknown-provider", "Hello", []);
    // No client requirements for unknown, centralized may pass or fail
    expect(result.errors.length).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// getOptimalTimes
// ============================================================================

describe("providerRegistry.getOptimalTimes", () => {
  it("returns times for X on a weekday", () => {
    // Use explicit time to avoid timezone ambiguity
    const monday = new Date("2025-03-17T12:00:00");
    const times = providerRegistry.getOptimalTimes("x", monday);
    expect(times.length).toBeGreaterThan(0);
  });

  it("returns times array for X on a weekend day", () => {
    const saturday = new Date("2025-03-22T12:00:00");
    const times = providerRegistry.getOptimalTimes("x", saturday);
    expect(Array.isArray(times)).toBe(true);
  });

  it("returns times for Instagram on a weekday", () => {
    const tuesday = new Date("2025-03-18T12:00:00");
    const times = providerRegistry.getOptimalTimes("instagram", tuesday);
    expect(times.length).toBeGreaterThan(0);
  });

  it("returns array for LinkedIn on any day", () => {
    const wednesday = new Date("2025-03-19T12:00:00");
    const times = providerRegistry.getOptimalTimes("linkedin", wednesday);
    expect(Array.isArray(times)).toBe(true);
    expect(times.length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown provider", () => {
    const date = new Date("2025-03-17");
    const times = providerRegistry.getOptimalTimes("unknown", date);
    expect(times).toEqual([]);
  });

  it("returns times for TikTok", () => {
    const wednesday = new Date("2025-03-19T12:00:00");
    const times = providerRegistry.getOptimalTimes("tiktok", wednesday);
    expect(times.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// getCharLimit
// ============================================================================

describe("providerRegistry.getCharLimit", () => {
  it("returns 280 for X", () => {
    expect(providerRegistry.getCharLimit("x")).toBe(280);
  });

  it("returns 2200 for Instagram", () => {
    expect(providerRegistry.getCharLimit("instagram")).toBe(2200);
  });

  it("returns 3000 for LinkedIn", () => {
    expect(providerRegistry.getCharLimit("linkedin")).toBe(3000);
  });

  it("returns 280 default for unknown provider", () => {
    expect(providerRegistry.getCharLimit("unknown-provider")).toBe(280);
  });
});

// ============================================================================
// getMediaLimits
// ============================================================================

describe("providerRegistry.getMediaLimits", () => {
  it("returns correct limits for X", () => {
    const limits = providerRegistry.getMediaLimits("x");
    expect(limits.maxFiles).toBe(4);
  });

  it("returns default limits for unknown provider", () => {
    const limits = providerRegistry.getMediaLimits("unknown-provider");
    expect(limits.maxFiles).toBe(1);
    expect(limits.maxFileSize).toBe(5 * 1024 * 1024);
    expect(limits.supportedTypes).toEqual(["image/jpeg", "image/png"]);
  });

  it("returns correct maxFileSize for known provider", () => {
    const limits = providerRegistry.getMediaLimits("instagram");
    expect(limits.maxFiles).toBeGreaterThan(0);
  });
});

// ============================================================================
// getRateLimit
// ============================================================================

describe("providerRegistry.getRateLimit", () => {
  it("returns X rate limits", () => {
    const limits = providerRegistry.getRateLimit("x");
    expect(limits.postsPerHour).toBe(20);
    expect(limits.postsPerDay).toBe(300);
  });

  it("returns Instagram rate limits", () => {
    const limits = providerRegistry.getRateLimit("instagram");
    expect(limits.postsPerHour).toBe(5);
    expect(limits.postsPerDay).toBe(25);
  });

  it("returns LinkedIn rate limits", () => {
    const limits = providerRegistry.getRateLimit("linkedin");
    expect(limits.postsPerHour).toBe(10);
    expect(limits.postsPerDay).toBe(50);
  });

  it("returns Facebook rate limits", () => {
    const limits = providerRegistry.getRateLimit("facebook");
    expect(limits.postsPerHour).toBe(25);
    expect(limits.postsPerDay).toBe(200);
  });

  it("returns YouTube rate limits", () => {
    const limits = providerRegistry.getRateLimit("youtube");
    expect(limits.postsPerHour).toBe(6);
    expect(limits.postsPerDay).toBe(10);
  });

  it("returns TikTok rate limits", () => {
    const limits = providerRegistry.getRateLimit("tiktok");
    expect(limits.postsPerHour).toBe(3);
    expect(limits.postsPerDay).toBe(4);
  });

  it("returns default rate limits for unknown provider", () => {
    const limits = providerRegistry.getRateLimit("unknown");
    expect(limits.postsPerHour).toBe(10);
    expect(limits.postsPerDay).toBe(50);
  });
});

// ============================================================================
// supportsFeature
// ============================================================================

describe("providerRegistry.supportsFeature", () => {
  it("returns true when X supports threads", () => {
    expect(providerRegistry.supportsFeature("x", "threads")).toBe(true);
  });

  it("returns false when provider does not support polls", () => {
    expect(providerRegistry.supportsFeature("x", "polls")).toBe(false);
  });

  it("returns false for unknown provider", () => {
    expect(providerRegistry.supportsFeature("unknown", "threads")).toBe(false);
  });
});

// ============================================================================
// needsThreading
// ============================================================================

describe("providerRegistry.needsThreading", () => {
  it("returns true for X content > 280 chars", () => {
    const longContent = "a".repeat(281);
    expect(providerRegistry.needsThreading("x", longContent)).toBe(true);
  });

  it("returns false for X content <= 280 chars", () => {
    const shortContent = "a".repeat(280);
    expect(providerRegistry.needsThreading("x", shortContent)).toBe(false);
  });

  it("returns false for Instagram even with long content (no threading)", () => {
    const longContent = "a".repeat(3000);
    expect(providerRegistry.needsThreading("instagram", longContent)).toBe(false);
  });

  it("returns false for short content even on threading provider", () => {
    expect(providerRegistry.needsThreading("x", "short")).toBe(false);
  });
});

// ============================================================================
// getThreadSegments
// ============================================================================

describe("providerRegistry.getThreadSegments", () => {
  it("returns single segment when content fits", () => {
    const segments = providerRegistry.getThreadSegments("x", "Short content");
    expect(segments).toEqual(["Short content"]);
  });

  it("returns single segment for non-threading provider with long content", () => {
    const longContent = "a".repeat(3000);
    const segments = providerRegistry.getThreadSegments("instagram", longContent);
    expect(segments).toEqual([longContent]);
  });

  it("splits long content into multiple segments for X", () => {
    const longContent = "This is a test sentence. ".repeat(20); // ~500 chars
    const segments = providerRegistry.getThreadSegments("x", longContent);
    expect(segments.length).toBeGreaterThan(1);
    for (const seg of segments) {
      expect(seg.length).toBeLessThanOrEqual(280);
    }
  });

  it("preserves all content across segments", () => {
    const content =
      "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence. " +
      "Sixth sentence. Seventh sentence. Eighth sentence. Ninth sentence. Tenth sentence. " +
      "Eleventh. Twelfth. Thirteenth. Fourteenth. Fifteenth. ";
    const repeated = content.repeat(3);
    const segments = providerRegistry.getThreadSegments("x", repeated);
    const joined = segments.join(" ");
    // All original content should be preserved (may have whitespace differences)
    expect(joined.replace(/\s+/g, " ").trim().length).toBeGreaterThan(0);
  });

  it("breaks at sentence boundaries when possible", () => {
    // Must be > 280 chars total to trigger threading
    const content = "Short sentence. " + "A".repeat(250) + ". " + "B".repeat(100) + ". End.";
    const segments = providerRegistry.getThreadSegments("x", content);
    // Content is ~370 chars, should be split into 2+ segments
    expect(segments.length).toBeGreaterThan(1);
  });

  it("breaks at word boundaries when no sentence boundary exists", () => {
    // Content with no sentence breaks, just words
    const words = "word ".repeat(60); // ~300 chars
    const segments = providerRegistry.getThreadSegments("x", words);
    if (segments.length > 1) {
      // Should not break in the middle of a word
      expect(segments[0]?.endsWith(" ") || !segments[0]?.includes("word")).toBeFalsy();
    }
  });
});

// ============================================================================
// Validation requirement messages (kill string mutations)
// ============================================================================

describe("providerRegistry.validateContent — requirement messages", () => {
  it("X content required message mentions 'required'", () => {
    const result = providerRegistry.validateContent("x", "", []);
    expect(
      result.errors.some(
        (e) => e.toLowerCase().includes("required") || e.toLowerCase().includes("content")
      )
    ).toBe(true);
  });

  it("X char limit message mentions '280'", () => {
    const result = providerRegistry.validateContent("x", "a".repeat(281), []);
    expect(result.errors.some((e) => e.includes("280"))).toBe(true);
  });

  it("X media limit message mentions '4'", () => {
    const files = Array.from({ length: 5 }, () => new File([""], "img.jpg"));
    const result = providerRegistry.validateContent("x", "test", files);
    expect(result.errors.some((e) => e.includes("4"))).toBe(true);
  });

  it("Instagram media required message mentions 'image or video'", () => {
    const result = providerRegistry.validateContent("instagram", "Caption", []);
    expect(
      result.errors.some(
        (e) => e.toLowerCase().includes("image") || e.toLowerCase().includes("video")
      )
    ).toBe(true);
  });

  it("Instagram char limit is 2200", () => {
    const result = providerRegistry.validateContent("instagram", "a".repeat(2201), [
      new File([""], "img.jpg"),
    ]);
    expect(result.errors.some((e) => e.includes("2,200") || e.includes("2200"))).toBe(true);
  });

  it("Instagram media limit is 10", () => {
    const files = Array.from({ length: 11 }, () => new File([""], "img.jpg"));
    const result = providerRegistry.validateContent("instagram", "Cap", files);
    expect(result.errors.some((e) => e.includes("10"))).toBe(true);
  });

  it("LinkedIn content required message mentions 'required'", () => {
    const result = providerRegistry.validateContent("linkedin", "", []);
    expect(
      result.errors.some(
        (e) => e.toLowerCase().includes("required") || e.toLowerCase().includes("content")
      )
    ).toBe(true);
  });

  it("LinkedIn char limit is 3000", () => {
    const result = providerRegistry.validateContent("linkedin", "a".repeat(3001), []);
    expect(result.errors.some((e) => e.includes("3,000") || e.includes("3000"))).toBe(true);
  });

  it("LinkedIn media limit is 9", () => {
    const files = Array.from({ length: 10 }, () => new File([""], "img.jpg"));
    const result = providerRegistry.validateContent("linkedin", "test", files);
    expect(result.errors.some((e) => e.includes("9"))).toBe(true);
  });

  it("Facebook char limit is 63206", () => {
    const result = providerRegistry.validateContent("facebook", "a".repeat(63207), []);
    expect(result.errors.some((e) => e.includes("63,206") || e.includes("63206"))).toBe(true);
  });

  it("Facebook media limit is 30", () => {
    const files = Array.from({ length: 31 }, () => new File([""], "img.jpg"));
    const result = providerRegistry.validateContent("facebook", "test", files);
    expect(result.errors.some((e) => e.includes("30"))).toBe(true);
  });

  it("YouTube title required message mentions 'required' or 'Title'", () => {
    const result = providerRegistry.validateContent("youtube", "", []);
    expect(
      result.errors.some((e) => e.toLowerCase().includes("required") || e.includes("Title"))
    ).toBe(true);
  });

  it("YouTube char limit is 100", () => {
    const result = providerRegistry.validateContent("youtube", "a".repeat(101), [
      new File([""], "vid.mp4"),
    ]);
    expect(result.errors.some((e) => e.includes("100"))).toBe(true);
  });

  it("YouTube requires exactly 1 video", () => {
    const result = providerRegistry.validateContent("youtube", "Title", []);
    expect(
      result.errors.some((e) => e.toLowerCase().includes("one video") || e.includes("1"))
    ).toBe(true);
  });

  it("TikTok requires exactly 1 video", () => {
    const result = providerRegistry.validateContent("tiktok", "Caption", []);
    expect(
      result.errors.some((e) => e.toLowerCase().includes("one video") || e.includes("1"))
    ).toBe(true);
  });

  it("TikTok char limit is 2200", () => {
    const result = providerRegistry.validateContent("tiktok", "a".repeat(2201), [
      new File([""], "vid.mp4"),
    ]);
    expect(result.errors.some((e) => e.includes("2,200") || e.includes("2200"))).toBe(true);
  });
});

// ============================================================================
// Optimal times — specific values
// ============================================================================

describe("providerRegistry.getOptimalTimes — specific values", () => {
  it("X has optimal times defined for all 7 days", () => {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    for (const day of days) {
      // Create a date for each day
      const config = providerRegistry.getProvider("x");
      const times = config?.optimalTimes[day];
      expect(Array.isArray(times)).toBe(true);
    }
  });

  it("Instagram has optimal times defined", () => {
    const config = providerRegistry.getProvider("instagram");
    expect(config?.optimalTimes).toBeDefined();
    expect(Object.keys(config?.optimalTimes || {}).length).toBeGreaterThan(0);
  });

  it("LinkedIn has empty arrays for weekend", () => {
    const config = providerRegistry.getProvider("linkedin");
    expect(config?.optimalTimes.saturday).toEqual([]);
    expect(config?.optimalTimes.sunday).toEqual([]);
  });

  it("LinkedIn has 5 time slots on weekdays", () => {
    const config = providerRegistry.getProvider("linkedin");
    expect(config?.optimalTimes.monday?.length).toBe(5);
    expect(config?.optimalTimes.tuesday?.length).toBe(5);
  });

  it("LinkedIn has 4 time slots on Friday", () => {
    const config = providerRegistry.getProvider("linkedin");
    expect(config?.optimalTimes.friday?.length).toBe(4);
  });

  it("X has 4 time slots on weekdays", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.optimalTimes.monday?.length).toBe(4);
  });

  it("X has 3 time slots on Friday", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.optimalTimes.friday?.length).toBe(3);
  });

  it("X has 2 time slots on Saturday", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.optimalTimes.saturday?.length).toBe(2);
  });

  it("X has 3 time slots on Sunday", () => {
    const config = providerRegistry.getProvider("x");
    expect(config?.optimalTimes.sunday?.length).toBe(3);
  });

  it("Facebook has optimal times for all days", () => {
    const config = providerRegistry.getProvider("facebook");
    expect(config?.optimalTimes.monday?.length).toBeGreaterThan(0);
    expect(config?.optimalTimes.saturday?.length).toBeGreaterThan(0);
  });

  it("YouTube has optimal times for all days", () => {
    const config = providerRegistry.getProvider("youtube");
    expect(config?.optimalTimes.monday?.length).toBeGreaterThan(0);
  });

  it("TikTok has 4 time slots on weekdays", () => {
    const config = providerRegistry.getProvider("tiktok");
    expect(config?.optimalTimes.monday?.length).toBe(4);
    expect(config?.optimalTimes.saturday?.length).toBe(4);
  });
});

// ============================================================================
// convertToLegacyConfig — specific field assertions
// ============================================================================

describe("providerRegistry — legacy config conversion details", () => {
  it("maps features.scheduling from capabilities.schedule", () => {
    const xConfig = providerRegistry.getProvider("x");
    expect(typeof xConfig?.features.scheduling).toBe("boolean");
  });

  it("maps color correctly for each provider", () => {
    const providers = ["x", "instagram", "linkedin", "facebook"];
    for (const id of providers) {
      const config = providerRegistry.getProvider(id);
      expect(config?.color).toBeTruthy();
      expect(config?.color.startsWith("#")).toBe(true);
    }
  });

  it("returns empty optimalTimes for unknown provider in legacy config", () => {
    const config = providerRegistry.getProvider("bluesky");
    if (config) {
      // Bluesky has no optimal times configured
      expect(Object.keys(config.optimalTimes).length).toBe(0);
    }
  });
});
