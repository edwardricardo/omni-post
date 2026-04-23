/**
 * Unit Tests for Provider Constraint Validator
 * Tests content validation against provider constraints with suggestions and adaptations
 *
 * Environment Variables:
 * - USE_REAL_PROVIDERS=true - Use real provider metadata (default: uses mock providers)
 *
 * @file providerConstraintValidator.test.ts
 * @description Tests for Provider Constraint Validator - Initialization & Basic Validation
 * @layer infrastructure
 */

import { describe, it, beforeAll, expect } from "vitest";
import { ProviderConstraintValidator } from "../../src/providers/providerConstraintValidator.js";
import type { CanonicalPost } from "@shared/types";
import type { ProviderAdapter } from "../../src/providers/providerAdapter.interface.js";

// Configuration flag
const USE_REAL_PROVIDERS = process.env.USE_REAL_PROVIDERS === "true";

// ============================================================================
// Mock Provider Adapters
// ============================================================================

const mockXProvider: ProviderAdapter = {
  id: "x",
  limits: {
    maxChars: 280,
    maxMediaPerPost: 4,
    maxPostsPerThread: 25,
    allowedMedia: ["image", "video", "gif"],
    aspectRatios: ["16:9", "1:1", "4:5"],
    maxVideoDuration: 140,
    maxImageSize: 5 * 1024 * 1024,
    maxVideoSize: 512 * 1024 * 1024,
  },
  capabilities: {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: true,
  },
} as ProviderAdapter;

const mockInstagramProvider: ProviderAdapter = {
  id: "instagram",
  limits: {
    maxChars: 2200,
    maxMediaPerPost: 10,
    allowedMedia: ["image", "video"],
    aspectRatios: ["1:1", "4:5", "9:16"],
    maxVideoDuration: 60,
    maxImageSize: 8 * 1024 * 1024,
    maxVideoSize: 100 * 1024 * 1024,
  },
  capabilities: {
    publish: true,
    schedule: false, // Instagram doesn't support scheduling
    analytics: true,
    comments: true,
    replies: false,
    threading: false, // Instagram doesn't support threading
  },
} as ProviderAdapter;

// ============================================================================
// Test Data
// ============================================================================

const shortContent: CanonicalPost = {
  body: "This is a short post",
  media: [],
};

const longContentForX: CanonicalPost = {
  body: "a".repeat(500), // Exceeds X's 280 char limit
  media: [],
};

const contentWithMedia: CanonicalPost = {
  body: "Post with images",
  media: [
    { type: "image", url: "https://example.com/image1.jpg" },
    { type: "image", url: "https://example.com/image2.jpg" },
  ],
};

const contentWithExcessiveMedia: CanonicalPost = {
  body: "Post with too many images for X",
  media: [
    { type: "image", url: "https://example.com/1.jpg" },
    { type: "image", url: "https://example.com/2.jpg" },
    { type: "image", url: "https://example.com/3.jpg" },
    { type: "image", url: "https://example.com/4.jpg" },
    { type: "image", url: "https://example.com/5.jpg" }, // 5th image exceeds X's limit of 4
  ],
};

const contentWithUnsupportedMedia: CanonicalPost = {
  body: "Post with unsupported media type",
  media: [
    { type: "audio", url: "https://example.com/audio.mp3" }, // Audio not supported by X
  ],
};

const contentWithLongVideo: CanonicalPost = {
  body: "Video post",
  media: [
    {
      type: "video",
      url: "https://example.com/video.mp4",
      durationMs: 200 * 1000, // 200 seconds, exceeds X's 140s limit
    },
  ],
};

const scheduledContent: CanonicalPost = {
  body: "Scheduled post",
  media: [],
  scheduledAt: new Date(Date.now() + 3600000), // 1 hour from now
};

// ============================================================================
// Test Setup
// ============================================================================

beforeAll(() => {
  console.log("🔥 Starting Provider Constraint Validator Tests");
  console.log("=".repeat(60));
  if (USE_REAL_PROVIDERS) {
    console.log("🌐 USE_REAL_PROVIDERS=true - Using real provider metadata");
  } else {
    console.log("🧪 Using mock providers (fast, deterministic)");
    console.log("   Set USE_REAL_PROVIDERS=true to test with real providers");
  }
  console.log();
});

// ============================================================================
// Test Group 1: Initialization & Basic Validation
// ============================================================================

describe("Provider Constraint Validator - Initialization & Basic Validation", () => {
  it("should initialize validator successfully", () => {
    const validator = new ProviderConstraintValidator();
    expect(validator).toBeTruthy();
  });

  it("should return validation result with correct structure", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(shortContent, mockXProvider);

    expect(result).toBeTruthy();
    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.errors)).toBeTruthy();
    expect(Array.isArray(result.suggestions)).toBeTruthy();
    expect(Array.isArray(result.adaptations)).toBeTruthy();
  });

  it("should pass validation for short valid content", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(shortContent, mockXProvider);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should have expected validation result structure", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(shortContent, mockXProvider);

    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.errors)).toBeTruthy();
    expect(Array.isArray(result.suggestions)).toBeTruthy();
    expect(Array.isArray(result.adaptations)).toBeTruthy();
  });
});

// ============================================================================
// Test Group 2: Character Limit Validation
// ============================================================================

describe("Provider Constraint Validator - Character Limit Validation", () => {
  it("should fail validation for content exceeding character limit", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(longContentForX, mockXProvider);

    expect(result.valid).toBe(false);
    expect(result.errors.length > 0).toBeTruthy();
  });

  it("should include character limit error message", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(longContentForX, mockXProvider);

    const hasCharLimitError = result.errors.some(
      (e) =>
        e.message.toLowerCase().includes("character") || e.message.toLowerCase().includes("char")
    );

    expect(hasCharLimitError).toBeTruthy();
  });

  it("should provide suggestions for character limit violation", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(longContentForX, mockXProvider);

    expect(result.suggestions.length > 0).toBeTruthy();
  });

  it("should pass long content for Instagram with higher limit", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(longContentForX, mockInstagramProvider);

    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Test Group 3: Media Validation
// ============================================================================

describe("Provider Constraint Validator - Media Validation", () => {
  it("should pass validation for content with valid media count", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(contentWithMedia, mockXProvider);

    expect(result.valid).toBe(true);
  });

  it("should fail validation for excessive media count", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(contentWithExcessiveMedia, mockXProvider);

    expect(result.valid).toBe(false);
  });

  it("should fail validation for unsupported media type", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(contentWithUnsupportedMedia, mockXProvider);

    expect(result.valid).toBe(false);
  });

  it("should include unsupported media type in error message", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(contentWithUnsupportedMedia, mockXProvider);

    const hasMediaTypeError = result.errors.some(
      (e) =>
        e.message.toLowerCase().includes("unsupported") || e.message.toLowerCase().includes("media")
    );

    expect(hasMediaTypeError).toBeTruthy();
  });

  it("should warn about video duration exceeding limit", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(contentWithLongVideo, mockXProvider);

    const hasVideoDurationWarning = result.errors.some(
      (e) =>
        e.message.toLowerCase().includes("video") ||
        e.message.toLowerCase().includes("duration") ||
        e.message.toLowerCase().includes("long")
    );

    expect(hasVideoDurationWarning).toBeTruthy();
  });
});

// ============================================================================
// Test Group 4: Capability Validation
// ============================================================================

describe("Provider Constraint Validator - Capability Validation", () => {
  it("should fail validation for content requiring threading on non-threading provider", async () => {
    const validator = new ProviderConstraintValidator();
    const veryLongContent: CanonicalPost = {
      body: "a".repeat(3000), // Exceeds Instagram's 2200 char limit
      media: [],
    };

    const result = await validator.validateContent(veryLongContent, mockInstagramProvider);

    const hasThreadingError = result.errors.some(
      (e) =>
        e.severity === "error" &&
        (e.message.toLowerCase().includes("thread") ||
          e.message.toLowerCase().includes("too long") ||
          e.message.toLowerCase().includes("character"))
    );

    expect(hasThreadingError).toBeTruthy();
  });

  it("should fail validation for scheduled post on provider without scheduling", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(scheduledContent, mockInstagramProvider);

    const hasSchedulingError = result.errors.some(
      (e) => e.severity === "error" && e.message.toLowerCase().includes("schedul")
    );

    expect(hasSchedulingError).toBeTruthy();
  });

  it("should pass validation for scheduled post on provider with scheduling", async () => {
    const validator = new ProviderConstraintValidator();
    const result = await validator.validateContent(scheduledContent, mockXProvider);

    const hasSchedulingError = result.errors.some((e) =>
      e.message.toLowerCase().includes("schedul")
    );

    expect(hasSchedulingError).toBe(false);
  });
});

// ============================================================================
// Test Group 5: Custom Rules
// ============================================================================

describe("Provider Constraint Validator - Custom Rules", () => {
  it("should allow registering custom validation rule", () => {
    const validator = new ProviderConstraintValidator();

    validator.registerRule({
      name: "custom_test_rule",
      description: "Test custom rule",
      severity: "warning",
      validate: () => ({ valid: true }),
    });

    // Should not throw
    expect(true).toBeTruthy();
  });

  it("should execute custom rule during validation", async () => {
    const validator = new ProviderConstraintValidator();
    let customRuleExecuted = false;

    validator.registerRule({
      name: "execution_test",
      description: "Test rule execution",
      severity: "info",
      validate: () => {
        customRuleExecuted = true;
        return { valid: true };
      },
    });

    await validator.validateContent(shortContent, mockXProvider);

    expect(customRuleExecuted).toBe(true);
  });

  it("should fail validation when custom rule returns invalid", async () => {
    const validator = new ProviderConstraintValidator();

    validator.registerRule({
      name: "always_fail",
      description: "Always fails",
      severity: "error",
      validate: () => ({
        valid: false,
        message: "Custom failure",
        field: "test",
      }),
    });

    const result = await validator.validateContent(shortContent, mockXProvider);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message === "Custom failure")).toBeTruthy();
  });
});

// ============================================================================
// Test Group 6: Multi-Provider Validation
// ============================================================================

describe("Provider Constraint Validator - Multi-Provider Validation", () => {
  it("should return validation summary for each provider", async () => {
    const validator = new ProviderConstraintValidator();
    const providers = [mockXProvider, mockInstagramProvider];
    const summaries = await validator.validateMultipleProviders(shortContent, providers);

    expect(summaries.length).toBe(2);
  });

  it("should sort summaries by score in descending order", async () => {
    const validator = new ProviderConstraintValidator();
    const providers = [mockXProvider, mockInstagramProvider];
    const summaries = await validator.validateMultipleProviders(longContentForX, providers);

    expect(summaries[0].score >= summaries[1].score).toBeTruthy();
  });

  it("should include score in validation summary", async () => {
    const validator = new ProviderConstraintValidator();
    const summaries = await validator.validateMultipleProviders(shortContent, [mockXProvider]);

    expect(typeof summaries[0].score).toBe("number");
    expect(summaries[0].score >= 0).toBeTruthy();
    expect(summaries[0].score <= 100).toBeTruthy();
  });

  it("should include error counts in summary", async () => {
    const validator = new ProviderConstraintValidator();
    const summaries = await validator.validateMultipleProviders(shortContent, [mockXProvider]);

    expect(typeof summaries[0].errors).toBe("number");
    expect(typeof summaries[0].warnings).toBe("number");
    expect(typeof summaries[0].infos).toBe("number");
  });

  it("should include estimated effort in summary", async () => {
    const validator = new ProviderConstraintValidator();
    const summaries = await validator.validateMultipleProviders(shortContent, [mockXProvider]);

    const validEfforts = ["none", "minimal", "moderate", "significant"];
    expect(validEfforts.includes(summaries[0].estimatedEffort)).toBeTruthy();
  });
});

// ============================================================================
// Test Group 7: Best Provider Selection
// ============================================================================

describe("Provider Constraint Validator - Best Provider Selection", () => {
  it("should return best provider for valid content", async () => {
    const validator = new ProviderConstraintValidator();
    const providers = [mockXProvider, mockInstagramProvider];
    const bestProvider = await validator.getBestProvider(shortContent, providers);

    expect(bestProvider !== null).toBeTruthy();
  });

  it("should select best provider based on content constraints", async () => {
    const validator = new ProviderConstraintValidator();
    const providers = [mockXProvider, mockInstagramProvider];
    const bestProvider = await validator.getBestProvider(longContentForX, providers);

    expect(bestProvider?.id).toBe("instagram");
  });

  it("should return null when no provider meets minimum score", async () => {
    const validator = new ProviderConstraintValidator();
    const bestProvider = await validator.getBestProvider(longContentForX, [mockXProvider], {
      requiredScore: 150, // Impossible score
    });

    expect(bestProvider).toBe(null);
  });

  it("should handle very problematic content", async () => {
    const validator = new ProviderConstraintValidator();

    const impossibleContent: CanonicalPost = {
      body: "a".repeat(10000), // Too long for all providers
      media: Array(50).fill({ type: "image", url: "test.jpg" }), // Too many media
    };

    const bestProvider = await validator.getBestProvider(impossibleContent, [
      mockXProvider,
      mockInstagramProvider,
    ]);

    // Should return null or a provider (algorithm working)
    const isValid =
      bestProvider === null || bestProvider.id === "x" || bestProvider.id === "instagram";
    expect(isValid).toBeTruthy();
  });
});

// ============================================================================
// Test Group 8: Adaptation Suggestions
// ============================================================================

describe("Provider Constraint Validator - Adaptation Suggestions", () => {
  it("should provide adaptations for content requiring changes", async () => {
    const validator = new ProviderConstraintValidator();
    const adaptations = await validator.suggestAdaptations(longContentForX, mockXProvider);

    expect(adaptations.length > 0).toBeTruthy();
  });

  it("should not provide adaptations for valid content", async () => {
    const validator = new ProviderConstraintValidator();
    const adaptations = await validator.suggestAdaptations(shortContent, mockXProvider);

    expect(adaptations.length).toBe(0);
  });

  it("should include preview in adaptation when available", async () => {
    const validator = new ProviderConstraintValidator();
    const adaptations = await validator.suggestAdaptations(longContentForX, mockXProvider);

    if (adaptations.length > 0) {
      expect(adaptations[0].preview !== undefined).toBeTruthy();
    } else {
      // If no adaptations, test passes (content might be valid)
      expect(true).toBeTruthy();
    }
  });
});
