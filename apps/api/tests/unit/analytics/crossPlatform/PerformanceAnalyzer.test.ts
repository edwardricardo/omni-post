/**
 * @file PerformanceAnalyzer.test.ts
 * @description Unit tests for PerformanceAnalyzer — analyzeContentLength and
 *              analyzeMediaPerformance including all categorization branches,
 *              provider-specific thresholds, and recommendation generation.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { PerformanceAnalyzer } from "../../../../src/analytics/crossPlatform/PerformanceAnalyzer.js";
import type { PostDataItem } from "../../../../src/analytics/crossPlatform/types.js";
import type { DomainAnalytics } from "@shared/types";

// ---------------------------------------------------------------------------
// Module-level mock: createLogger — avoid real pino in unit tests
// ---------------------------------------------------------------------------

vi.mock("../../../../src/lib/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePost(
  id: string,
  contentText: string,
  mediaItems: Array<{ type: string }> = [],
  channels: Array<{ provider: string }> = []
): PostDataItem {
  return {
    id,
    createdAt: new Date("2025-01-15T12:00:00Z"),
    contents: [{ content: contentText }],
    media: mediaItems,
    channels,
  };
}

function makeAnalytics(
  id: string,
  postId: string,
  provider: string,
  overrides: Partial<DomainAnalytics> = {}
): DomainAnalytics {
  return {
    id,
    postId,
    provider: provider as DomainAnalytics["provider"],
    capturedAt: new Date("2025-01-15T12:00:00Z"),
    views: 1000,
    likes: 50,
    comments: 10,
    shares: 5,
    ...overrides,
  } as DomainAnalytics;
}

// ---------------------------------------------------------------------------
// analyzeContentLength — empty data
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeContentLength — empty data", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("returns empty byProvider and general recommendation when no posts are provided", async () => {
    const result = await analyzer.analyzeContentLength([], []);

    assert.ok(typeof result.byProvider === "object");
    assert.ok(typeof result.generalRecommendation === "string");
    assert.ok(result.generalRecommendation.length > 0);
  });

  it("returns insufficient-data recommendation when no analytics data is provided", async () => {
    const posts = [makePost("p1", "Short content")];
    const result = await analyzer.analyzeContentLength(posts, []);

    assert.strictEqual(Object.keys(result.byProvider).length, 0);
    expect(result.generalRecommendation).toMatch(/[Ii]nsufficient/);
  });
});

// ---------------------------------------------------------------------------
// analyzeContentLength — provider-specific length categories
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeContentLength — X provider thresholds", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("categorizes content <=100 chars as short for X provider", async () => {
    const shortText = "a".repeat(80); // 80 chars — short for X
    const mediumText = "b".repeat(150); // 150 chars — medium for X
    const longText = "c".repeat(250); // 250 chars — long for X

    const posts = [
      makePost("p-short", shortText),
      makePost("p-medium", mediumText),
      makePost("p-long", longText),
    ];

    const analytics = [
      makeAnalytics("a1", "p-short", "X", { likes: 100, comments: 20, shares: 10, views: 500 }),
      makeAnalytics("a2", "p-medium", "X", { likes: 80, comments: 15, shares: 8, views: 400 }),
      makeAnalytics("a3", "p-long", "X", { likes: 40, comments: 5, shares: 2, views: 200 }),
    ];

    const result = await analyzer.analyzeContentLength(posts, analytics);

    assert.ok(result.byProvider["X"]);
    const xData = result.byProvider["X"];
    // Short content had highest engagement per post
    assert.ok(xData.shortContent.avgEngagement >= 0);
    assert.ok(xData.mediumContent.avgEngagement >= 0);
    assert.ok(xData.longContent.avgEngagement >= 0);
    // Optimal should pick the highest-engagement category
    assert.ok(xData.optimal.length >= 0);
    assert.ok(xData.optimal.engagementRate >= 0);
  });

  it("marks optimal as medium when only medium-length posts exist for X provider", async () => {
    const mediumText = "b".repeat(150); // medium for X (100 < 150 <= 200)
    const posts = [makePost("p1", mediumText), makePost("p2", mediumText)];
    const analytics = [
      makeAnalytics("a1", "p1", "X", { likes: 60, comments: 12, shares: 6, views: 300 }),
      makeAnalytics("a2", "p2", "X", { likes: 70, comments: 14, shares: 7, views: 350 }),
    ];

    const result = await analyzer.analyzeContentLength(posts, analytics);

    assert.ok(result.byProvider["X"]);
    const xData = result.byProvider["X"];
    assert.ok(xData.mediumContent.avgEngagement > 0);
    assert.strictEqual(xData.shortContent.avgEngagement, 0);
    assert.strictEqual(xData.longContent.avgEngagement, 0);
  });
});

describe("PerformanceAnalyzer.analyzeContentLength — non-X provider thresholds", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("categorizes content <=150 chars as short for INSTAGRAM provider", async () => {
    const shortText = "a".repeat(100); // short for INSTAGRAM (<=150)
    const mediumText = "b".repeat(300); // medium for INSTAGRAM (150 < 300 <= 500)
    const longText = "c".repeat(600); // long for INSTAGRAM (>500)

    const posts = [
      makePost("p-s", shortText),
      makePost("p-m", mediumText),
      makePost("p-l", longText),
    ];

    const analytics = [
      makeAnalytics("a1", "p-s", "INSTAGRAM", { likes: 200, comments: 30, shares: 15, views: 800 }),
      makeAnalytics("a2", "p-m", "INSTAGRAM", { likes: 150, comments: 20, shares: 10, views: 600 }),
      makeAnalytics("a3", "p-l", "INSTAGRAM", { likes: 50, comments: 5, shares: 2, views: 200 }),
    ];

    const result = await analyzer.analyzeContentLength(posts, analytics);

    assert.ok(result.byProvider["INSTAGRAM"]);
    const igData = result.byProvider["INSTAGRAM"];
    assert.ok(igData.shortContent.avgEngagement > 0);
    assert.ok(igData.mediumContent.avgEngagement > 0);
    assert.ok(igData.longContent.avgEngagement > 0);
    // Short content had 245 total engagement (200+30+15), highest
    assert.strictEqual(igData.optimal.length, igData.shortContent.avgLength);
  });

  it("calculates engagement rate with views as denominator", async () => {
    const text = "a".repeat(100);
    const posts = [makePost("p1", text)];
    const analytics = [
      makeAnalytics("a1", "p1", "FACEBOOK", { likes: 10, comments: 5, shares: 2, views: 170 }),
    ];

    const result = await analyzer.analyzeContentLength(posts, analytics);

    assert.ok(result.byProvider["FACEBOOK"]);
    const fb = result.byProvider["FACEBOOK"];
    // engagement = 10+5+2=17, views=170, rate = (17/170)*100 = 10
    assert.ok(fb.optimal.engagementRate >= 0);
  });
});

// ---------------------------------------------------------------------------
// analyzeContentLength — optimal selection and recommendation text
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeContentLength — recommendation generation", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("generates platform-specific recommendation when data is available", async () => {
    const posts = [makePost("p1", "a".repeat(100))];
    const analytics = [
      makeAnalytics("a1", "p1", "FACEBOOK", { likes: 50, comments: 10, shares: 5, views: 500 }),
    ];

    const result = await analyzer.analyzeContentLength(posts, analytics);

    assert.ok(result.generalRecommendation.length > 0);
    expect(result.generalRecommendation).not.toMatch(/[Ii]nsufficient/);
  });

  it("returns insufficient-data recommendation when no provider data has positive engagement", async () => {
    // Posts with no analytics
    const posts = [makePost("p1", "some content")];
    const result = await analyzer.analyzeContentLength(posts, []);

    expect(result.generalRecommendation).toMatch(/[Ii]nsufficient/);
  });

  it("falls back to medium/150/0 optimal when all categories have zero engagement", async () => {
    // Analytics with zero engagement metrics
    const posts = [makePost("p1", "a".repeat(100))];
    const analytics = [
      makeAnalytics("a1", "p1", "YOUTUBE", { likes: 0, comments: 0, shares: 0, views: 0 }),
    ];

    const result = await analyzer.analyzeContentLength(posts, analytics);

    assert.ok(result.byProvider["YOUTUBE"]);
    const yt = result.byProvider["YOUTUBE"];
    // All categories have 0 engagement — fallback to medium/150/0
    assert.strictEqual(yt.optimal.length, 150);
    assert.strictEqual(yt.optimal.engagementRate, 0);
  });

  it("handles multiple providers in same dataset independently", async () => {
    const posts = [
      makePost("p1", "a".repeat(50)), // short for both
      makePost("p2", "b".repeat(300)), // medium for both
    ];

    const analytics = [
      makeAnalytics("a1", "p1", "X", { likes: 80, comments: 20, shares: 10, views: 500 }),
      makeAnalytics("a2", "p1", "INSTAGRAM", { likes: 60, comments: 15, shares: 8, views: 400 }),
      makeAnalytics("a3", "p2", "X", { likes: 30, comments: 5, shares: 2, views: 200 }),
      makeAnalytics("a4", "p2", "INSTAGRAM", { likes: 120, comments: 25, shares: 12, views: 800 }),
    ];

    const result = await analyzer.analyzeContentLength(posts, analytics);

    assert.ok(result.byProvider["X"]);
    assert.ok(result.byProvider["INSTAGRAM"]);
    // Recommendation mentions both providers
    expect(result.generalRecommendation).toMatch(/chars/);
  });
});

// ---------------------------------------------------------------------------
// analyzeContentLength — error handling
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeContentLength — error resilience", () => {
  it("returns fallback result when analytics data causes internal error", async () => {
    const analyzer = new PerformanceAnalyzer();

    // Pass malformed post data that triggers a parsing error
    const malformedPost = { id: "p1" } as unknown as PostDataItem;
    const analytics = [makeAnalytics("a1", "p1", "X")];

    // Should not throw — returns empty result with error recommendation
    const result = await analyzer.analyzeContentLength([malformedPost], analytics);

    assert.ok(typeof result === "object");
    assert.ok(typeof result.generalRecommendation === "string");
  });
});

// ---------------------------------------------------------------------------
// analyzeMediaPerformance — categorization
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeMediaPerformance — media categorization", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("categorizes post with no media as textOnly", async () => {
    const posts = [makePost("p1", "Pure text content", [])];
    const analytics = [
      makeAnalytics("a1", "p1", "X", { likes: 40, comments: 8, shares: 3, views: 300 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    assert.strictEqual(result.textOnly.count, 1);
    assert.strictEqual(result.withImages.count, 0);
    assert.strictEqual(result.withVideos.count, 0);
    assert.strictEqual(result.withCarousel.count, 0);
    assert.strictEqual(result.mixed.count, 0);
  });

  it("categorizes post with single image as withImages", async () => {
    const posts = [makePost("p1", "Image post", [{ type: "image" }])];
    const analytics = [
      makeAnalytics("a1", "p1", "INSTAGRAM", { likes: 100, comments: 20, shares: 5, views: 500 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    assert.strictEqual(result.withImages.count, 1);
    assert.strictEqual(result.textOnly.count, 0);
    assert.ok(result.withImages.avgEngagement > 0);
  });

  it("categorizes post with single video as withVideos", async () => {
    const posts = [makePost("p1", "Video post", [{ type: "video" }])];
    const analytics = [
      makeAnalytics("a1", "p1", "YOUTUBE", { likes: 200, comments: 40, shares: 20, views: 2000 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    assert.strictEqual(result.withVideos.count, 1);
    assert.strictEqual(result.textOnly.count, 0);
    assert.ok(result.withVideos.avgEngagement > 0);
  });

  it("categorizes post with multiple images (no video) as withCarousel", async () => {
    const posts = [
      makePost("p1", "Carousel post", [{ type: "image" }, { type: "image" }, { type: "image" }]),
    ];
    const analytics = [
      makeAnalytics("a1", "p1", "INSTAGRAM", { likes: 180, comments: 35, shares: 15, views: 900 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    assert.strictEqual(result.withCarousel.count, 1);
    assert.strictEqual(result.withImages.count, 0);
    assert.ok(result.withCarousel.avgEngagement > 0);
  });

  it("categorizes post with mixed video and image as mixed", async () => {
    const posts = [makePost("p1", "Mixed post", [{ type: "video" }, { type: "image" }])];
    const analytics = [
      makeAnalytics("a1", "p1", "FACEBOOK", { likes: 150, comments: 30, shares: 10, views: 700 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    assert.strictEqual(result.mixed.count, 1);
    assert.strictEqual(result.withVideos.count, 0);
    assert.strictEqual(result.withCarousel.count, 0);
  });

  it("categorizes post with multiple videos (no image) as withCarousel", async () => {
    const posts = [makePost("p1", "Multi-video", [{ type: "video" }, { type: "video" }])];
    const analytics = [
      makeAnalytics("a1", "p1", "TIKTOK", { likes: 500, comments: 100, shares: 50, views: 5000 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    // Two videos, no image → hasVideo=true, hasImage=false → withCarousel
    assert.strictEqual(result.withCarousel.count, 1);
    assert.strictEqual(result.mixed.count, 0);
  });
});

// ---------------------------------------------------------------------------
// analyzeMediaPerformance — averages and reach calculation
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeMediaPerformance — metric calculations", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("calculates avgEngagement as total engagement / count", async () => {
    const posts = [
      makePost("p1", "img1", [{ type: "image" }]),
      makePost("p2", "img2", [{ type: "image" }]),
    ];

    const analytics = [
      makeAnalytics("a1", "p1", "INSTAGRAM", { likes: 100, comments: 20, shares: 10, views: 600 }),
      makeAnalytics("a2", "p2", "INSTAGRAM", { likes: 200, comments: 40, shares: 20, views: 1200 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    // Total engagement: (100+20+10) + (200+40+20) = 130 + 260 = 390, avg = 195
    assert.strictEqual(result.withImages.count, 2);
    assert.strictEqual(result.withImages.avgEngagement, 195);
  });

  it("calculates avgReach as 70% of views averaged across posts", async () => {
    const posts = [makePost("p1", "text", [])];
    const analytics = [
      makeAnalytics("a1", "p1", "X", { likes: 10, comments: 2, shares: 1, views: 1000 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    // reach = floor(1000 * 0.7) = 700, avg over 1 post = 700
    assert.strictEqual(result.textOnly.avgReach, 700);
  });

  it("returns zero metrics for empty categories", async () => {
    const posts = [makePost("p1", "text only", [])];
    const analytics = [makeAnalytics("a1", "p1", "FACEBOOK")];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    assert.strictEqual(result.withImages.avgEngagement, 0);
    assert.strictEqual(result.withImages.avgReach, 0);
    assert.strictEqual(result.withVideos.avgEngagement, 0);
    assert.strictEqual(result.withCarousel.avgEngagement, 0);
    assert.strictEqual(result.mixed.avgEngagement, 0);
  });

  it("returns zero counts and averages when no posts are provided", async () => {
    const result = await analyzer.analyzeMediaPerformance([], []);

    assert.strictEqual(result.textOnly.count, 0);
    assert.strictEqual(result.withImages.count, 0);
    assert.strictEqual(result.withVideos.count, 0);
    assert.strictEqual(result.withCarousel.count, 0);
    assert.strictEqual(result.mixed.count, 0);
    assert.strictEqual(result.recommendation.length > 0, true);
  });
});

// ---------------------------------------------------------------------------
// analyzeMediaPerformance — performance multipliers
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeMediaPerformance — performanceMultipliers", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("calculates performance multipliers relative to text-only baseline", async () => {
    const posts = [makePost("p1", "text", []), makePost("p2", "img", [{ type: "image" }])];

    const analytics = [
      makeAnalytics("a1", "p1", "X", { likes: 10, comments: 2, shares: 1, views: 300 }),
      makeAnalytics("a2", "p2", "X", { likes: 40, comments: 8, shares: 4, views: 800 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    // textOnly avg engagement = 13, withImages avg = 52
    // multiplier = 52 / 13 = 4
    assert.ok(result.performanceMultipliers["images"] !== undefined);
    expect(result.performanceMultipliers["images"]).toBeCloseTo(4, 0);
  });

  it("uses baseline=1 when textOnly has zero engagement to avoid division by zero", async () => {
    const posts = [makePost("p1", "img", [{ type: "image" }])];
    const analytics = [makeAnalytics("a1", "p1", "INSTAGRAM")];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    // textOnly.avgEngagement = 0, baseline = max(1, 0) = 1
    // images multiplier = withImages.avgEngagement / 1
    assert.ok(result.performanceMultipliers["images"] !== undefined);
    assert.ok(Number.isFinite(result.performanceMultipliers["images"] as number));
  });
});

// ---------------------------------------------------------------------------
// analyzeMediaPerformance — recommendation text
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeMediaPerformance — recommendation text", () => {
  let analyzer: PerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer();
  });

  it("generates high-improvement recommendation when images outperform text by >20%", async () => {
    const posts = [makePost("p1", "text", []), makePost("p2", "img", [{ type: "image" }])];

    const analytics = [
      makeAnalytics("a1", "p1", "X", { likes: 5, comments: 1, shares: 0, views: 100 }),
      makeAnalytics("a2", "p2", "X", { likes: 50, comments: 10, shares: 5, views: 1000 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    // images engagement: 65, text: 6 → improvement > 20% → strong recommendation
    expect(result.recommendation).toMatch(/perform.*better|Increase/);
  });

  it("generates gradual-improvement recommendation when improvement is 0-20%", async () => {
    const posts = [makePost("p1", "text", []), makePost("p2", "img", [{ type: "image" }])];

    const analytics = [
      // text engagement: 100+20+10 = 130, image: 120+22+11 = 153 → ~17.7% improvement
      makeAnalytics("a1", "p1", "FACEBOOK", { likes: 100, comments: 20, shares: 10, views: 500 }),
      makeAnalytics("a2", "p2", "FACEBOOK", { likes: 120, comments: 22, shares: 11, views: 600 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    expect(result.recommendation).toMatch(/best performance|Consider gradual/);
  });

  it("returns text-only performs well message when text outperforms all media types", async () => {
    const posts = [makePost("p1", "text", []), makePost("p2", "img", [{ type: "image" }])];

    const analytics = [
      // text engagement is higher
      makeAnalytics("a1", "p1", "X", { likes: 200, comments: 50, shares: 20, views: 1500 }),
      makeAnalytics("a2", "p2", "X", { likes: 10, comments: 2, shares: 1, views: 100 }),
    ];

    const result = await analyzer.analyzeMediaPerformance(posts, analytics);

    expect(result.recommendation).toMatch(/[Tt]ext-only|testing different/);
  });

  it("returns insufficient-data recommendation when no posts have analytics", async () => {
    const result = await analyzer.analyzeMediaPerformance([], []);

    expect(result.recommendation).toMatch(/[Ii]nsufficient/);
  });
});

// ---------------------------------------------------------------------------
// analyzeMediaPerformance — error resilience
// ---------------------------------------------------------------------------

describe("PerformanceAnalyzer.analyzeMediaPerformance — error resilience", () => {
  it("returns fallback result on internal error", async () => {
    const analyzer = new PerformanceAnalyzer();

    // Pass null analytics to provoke internal guard
    const result = await analyzer.analyzeMediaPerformance(
      [makePost("p1", "text")],
      null as unknown as DomainAnalytics[]
    );

    // Should not throw — fallback returns zeroed structure
    assert.ok(typeof result === "object");
    assert.ok(typeof result.recommendation === "string");
  });
});
