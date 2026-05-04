/**
 * @file hashtagManager.test.ts
 * @description Mutation-killing tests for TikTokHashtagManager covering strategy
 *              generation, hashtag performance analysis, challenge discovery/creation,
 *              and recommendation pipelines.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// Mock external dependencies before importing source
vi.mock("@adapters/external-apis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/external-apis")>();
  return {
    ...actual,
    createExternalApiCircuitBreaker: vi.fn(() => ({
      call: vi.fn((_service: string, _op: string, fn: () => unknown) => fn()),
      getAllStatuses: vi.fn(() => ({ "tiktok-hashtag-manager": "CLOSED" })),
      clearCache: vi.fn(),
    })),
  };
});

vi.mock("@adapters/fallback-strategies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/fallback-strategies")>();
  return {
    ...actual,
    CommonFallbackStrategies: {
      ANALYTICS_FALLBACK: { type: "analytics" },
    },
  };
});

vi.mock("prom-client", () => ({
  Registry: class MockRegistry {},
}));

import { TikTokHashtagManager } from "../src/hashtagManager.js";
import type { TikTokResearchApiClient, TikTokTrendingHashtag } from "../src/researchApiClient.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTrendingHashtag = (
  overrides?: Partial<TikTokTrendingHashtag>
): TikTokTrendingHashtag => ({
  hashtag: "#testhashtag",
  volume: 50000,
  growth: 15,
  difficulty: 40,
  engagement: 65,
  category: "general",
  relatedHashtags: ["#related1", "#related2"],
  trendingScore: 72,
  ...overrides,
});

const createMockResearchClient = (overrides?: Partial<TikTokResearchApiClient>) =>
  ({
    getTrendingHashtags: vi.fn().mockResolvedValue([]),
    getKeywordTrends: vi.fn().mockResolvedValue([]),
    getTrendingVideos: vi.fn().mockResolvedValue([]),
    getTrendingSounds: vi.fn().mockResolvedValue([]),
    getContentGaps: vi.fn().mockResolvedValue([]),
    getViralContentAnalysis: vi.fn().mockResolvedValue([]),
    getCircuitBreakerStatus: vi.fn().mockReturnValue({}),
    clearCache: vi.fn(),
    ...overrides,
  }) as unknown as TikTokResearchApiClient;

describe("TikTokHashtagManager", () => {
  let manager: TikTokHashtagManager;
  let mockClient: TikTokResearchApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockResearchClient();
    manager = new TikTokHashtagManager(mockClient);
  });

  // =========================================================================
  // generateHashtagStrategy
  // =========================================================================
  describe("generateHashtagStrategy", () => {
    it("calls getTrendingHashtags with correct options", async () => {
      await manager.generateHashtagStrategy({
        contentCategory: "dance",
        region: "US",
      });

      expect(mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
        category: "dance",
        region: "US",
        timeframe: "7d",
        limit: 50,
      });
    });

    it("does not include region when not provided", async () => {
      await manager.generateHashtagStrategy({
        contentCategory: "comedy",
      });

      expect(mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
        category: "comedy",
        timeframe: "7d",
        limit: 50,
      });
    });

    it("returns HashtagMix with all required fields", async () => {
      const sampleHashtag = makeTrendingHashtag({
        hashtag: "#dance",
        difficulty: 30,
        engagement: 80,
        growth: 25,
      });
      // First call: main trending fetch; subsequent calls: analyzeHashtagPerformance
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValue([
        sampleHashtag,
      ]);

      const result = await manager.generateHashtagStrategy({
        contentCategory: "dance",
      });

      assert.ok(result.strategy);
      assert.ok(typeof result.totalHashtags === "number");
      assert.ok(typeof result.estimatedReach === "number");
      assert.ok(typeof result.difficultyScore === "number");
      assert.ok(["low", "medium", "high"].includes(result.competitionLevel));
      assert.ok(typeof result.viralPotential === "number");
      assert.ok(Array.isArray(result.recommendations));
      assert.ok(Array.isArray(result.warnings));
    });

    it("limits trending hashtags to first 20 for performance analysis", async () => {
      const manyHashtags = Array.from({ length: 30 }, (_, i) =>
        makeTrendingHashtag({ hashtag: `#tag${i}`, difficulty: 40, engagement: 60, growth: 15 })
      );
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        manyHashtags
      );

      // The inner analyzeHashtagPerformance will call getTrendingHashtags again
      // for each of the sliced 20 hashtags
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValue(manyHashtags);

      await manager.generateHashtagStrategy({ contentCategory: "test" });

      // First call is the main one, subsequent calls are from analyzeHashtagPerformance
      // Total calls: 1 (main) + 20 (analyze each of top 20)
      const callCount = (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mock.calls
        .length;
      assert.strictEqual(callCount, 21);
    });

    it("handles zero trending hashtags gracefully", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await manager.generateHashtagStrategy({
        contentCategory: "empty",
      });

      assert.strictEqual(result.totalHashtags, 0);
    });
  });

  // =========================================================================
  // analyzeHashtagPerformance
  // =========================================================================
  describe("analyzeHashtagPerformance", () => {
    it("returns performance data for found hashtag", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({
          hashtag: "#myhashtag",
          volume: 80000,
          growth: 15,
          difficulty: 45,
          engagement: 70,
          relatedHashtags: ["#rel1"],
        }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#myhashtag");

      assert.strictEqual(result.hashtag, "#myhashtag");
      assert.strictEqual(result.usage, 80000);
      assert.strictEqual(result.reach, 80000 * 70);
      assert.strictEqual(result.engagement, 70);
      assert.strictEqual(result.difficulty, 45);
      assert.strictEqual(result.competitiveness, 45);
      expect(result.relatedHashtags).toEqual(["#rel1"]);
      expect(result.optimalTiming).toEqual(["12:00 PM", "6:00 PM", "9:00 PM"]);
    });

    it("throws ProviderError when hashtag not found in trending data", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#other" }),
      ]);

      await expect(manager.analyzeHashtagPerformance("#nonexistent")).rejects.toThrow(
        "Hashtag data for: #nonexistent"
      );
    });

    // Recommendation logic: difficulty > 80 => "avoid"
    it("sets recommendation to avoid when difficulty > 80", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#hard", difficulty: 85, growth: 15 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#hard");

      assert.strictEqual(result.recommendation, "avoid");
    });

    it("sets recommendation to avoid when difficulty is 81", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#h", difficulty: 81, growth: 50 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#h");

      assert.strictEqual(result.recommendation, "avoid");
    });

    // Recommendation logic: difficulty > 60 => "monitor"
    it("sets recommendation to monitor when difficulty > 60 and <= 80", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#med", difficulty: 65, growth: 15 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#med");

      assert.strictEqual(result.recommendation, "monitor");
    });

    it("sets recommendation to monitor at difficulty boundary 80", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#b", difficulty: 80, growth: 15 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#b");

      assert.strictEqual(result.recommendation, "monitor");
    });

    // Recommendation logic: growth < 10 => "monitor" (even if difficulty <= 60)
    it("sets recommendation to monitor when growth < 10 and difficulty <= 60", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#slow", difficulty: 40, growth: 5 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#slow");

      assert.strictEqual(result.recommendation, "monitor");
    });

    it("sets recommendation to monitor when growth is exactly 9", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#g9", difficulty: 30, growth: 9 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#g9");

      assert.strictEqual(result.recommendation, "monitor");
    });

    // Recommendation logic: difficulty <= 60 && growth >= 10 => "use"
    it("sets recommendation to use when difficulty <= 60 and growth >= 10", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#good", difficulty: 50, growth: 15 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#good");

      assert.strictEqual(result.recommendation, "use");
    });

    it("sets recommendation to use at boundary difficulty 60 and growth 10", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#boundary", difficulty: 60, growth: 10 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#boundary");

      assert.strictEqual(result.recommendation, "use");
    });

    // Difficulty 61, growth >= 10 => monitor (difficulty > 60)
    it("sets recommendation to monitor at difficulty 61 regardless of growth", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#d61", difficulty: 61, growth: 50 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#d61");

      assert.strictEqual(result.recommendation, "monitor");
    });

    // Trend logic: growth > 20 => "rising"
    it("sets trend to rising when growth > 20", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#r", difficulty: 40, growth: 25 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#r");

      assert.strictEqual(result.trend, "rising");
    });

    it("sets trend to rising at growth 21", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#g21", difficulty: 40, growth: 21 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#g21");

      assert.strictEqual(result.trend, "rising");
    });

    it("does not set trend to rising at exactly growth 20", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#g20", difficulty: 40, growth: 20 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#g20");

      assert.strictEqual(result.trend, "stable");
    });

    // Trend logic: growth < -10 => "declining"
    it("sets trend to declining when growth < -10", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#dec", difficulty: 40, growth: -15 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#dec");

      assert.strictEqual(result.trend, "declining");
    });

    it("sets trend to declining at growth -11", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#g-11", difficulty: 40, growth: -11 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#g-11");

      assert.strictEqual(result.trend, "declining");
    });

    it("does not set trend to declining at exactly -10", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#g-10", difficulty: 40, growth: -10 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#g-10");

      assert.strictEqual(result.trend, "stable");
    });

    // Trend logic: -10 <= growth <= 20 => "stable"
    it("sets trend to stable when growth is 0", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#flat", difficulty: 40, growth: 0 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#flat");

      assert.strictEqual(result.trend, "stable");
    });

    it("sets trend to stable when growth is 10", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#s10", difficulty: 40, growth: 10 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#s10");

      assert.strictEqual(result.trend, "stable");
    });

    it("computes reach as volume * engagement", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#calc", volume: 1000, engagement: 50, difficulty: 40 }),
      ]);

      const result = await manager.analyzeHashtagPerformance("#calc");

      assert.strictEqual(result.reach, 50000);
    });
  });

  // =========================================================================
  // getActiveHashtagChallenges
  // =========================================================================
  describe("getActiveHashtagChallenges", () => {
    it("returns both challenges with no filters", async () => {
      const result = await manager.getActiveHashtagChallenges();

      assert.strictEqual(result.length, 2);
    });

    it("returns dance challenge when category filter is dance", async () => {
      const result = await manager.getActiveHashtagChallenges({ category: "dance" });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.id, "dance-trend-2024");
      assert.strictEqual(result[0]!.category, "dance");
    });

    it("returns education challenge when category filter is education", async () => {
      const result = await manager.getActiveHashtagChallenges({ category: "education" });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.id, "edu-challenge-2024");
      assert.strictEqual(result[0]!.category, "education");
    });

    it("returns empty array when category filter matches nothing", async () => {
      const result = await manager.getActiveHashtagChallenges({ category: "sports" });

      assert.strictEqual(result.length, 0);
    });

    it("filters by minParticipants returning only matching challenges", async () => {
      const result = await manager.getActiveHashtagChallenges({ minParticipants: 100000 });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.id, "dance-trend-2024");
      assert.ok(result[0]!.participantCount >= 100000);
    });

    it("returns both when minParticipants is low enough", async () => {
      const result = await manager.getActiveHashtagChallenges({ minParticipants: 50000 });

      assert.strictEqual(result.length, 2);
    });

    it("returns empty when minParticipants exceeds all", async () => {
      const result = await manager.getActiveHashtagChallenges({ minParticipants: 200000 });

      assert.strictEqual(result.length, 0);
    });

    it("applies both category and minParticipants filters together", async () => {
      const result = await manager.getActiveHashtagChallenges({
        category: "dance",
        minParticipants: 100000,
      });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.id, "dance-trend-2024");
    });

    it("returns empty when category matches but minParticipants does not", async () => {
      const result = await manager.getActiveHashtagChallenges({
        category: "education",
        minParticipants: 100000,
      });

      assert.strictEqual(result.length, 0);
    });

    it("returns correct challenge fields for dance challenge", async () => {
      const result = await manager.getActiveHashtagChallenges({ category: "dance" });
      const challenge = result[0]!;

      assert.strictEqual(challenge.hashtag, "#DanceTrend2024");
      assert.strictEqual(challenge.name, "Dance Trend Challenge 2024");
      assert.strictEqual(challenge.participantCount, 125000);
      assert.strictEqual(challenge.totalViews, 45000000);
      assert.strictEqual(challenge.difficulty, "easy");
      assert.strictEqual(challenge.trending, true);
      assert.strictEqual(challenge.officialAccount, "@tiktok");
      assert.strictEqual(challenge.rules.length, 4);
    });

    it("returns correct challenge fields for education challenge", async () => {
      const result = await manager.getActiveHashtagChallenges({ category: "education" });
      const challenge = result[0]!;

      assert.strictEqual(challenge.hashtag, "#LearnOnTikTok");
      assert.strictEqual(challenge.participantCount, 78000);
      assert.strictEqual(challenge.totalViews, 22000000);
      assert.strictEqual(challenge.difficulty, "medium");
      assert.strictEqual(challenge.officialAccount, undefined);
      expect(challenge.judging.criteria).toEqual(["Accuracy", "Clarity", "Engagement", "Impact"]);
    });
  });

  // =========================================================================
  // createHashtagChallenge
  // =========================================================================
  describe("createHashtagChallenge", () => {
    const makeChallengeInput = () => ({
      hashtag: "#MyChallenge",
      name: "My Custom Challenge",
      description: "A test challenge",
      startDate: "2024-06-01",
      endDate: "2024-08-01",
      rules: ["Rule 1", "Rule 2"],
      category: "lifestyle",
      difficulty: "medium" as const,
      eligibility: ["All users"],
      submissionGuidelines: ["Be creative"],
      judging: {
        criteria: ["Originality"],
        winners: 10,
        announcement: "Weekly",
      },
      trending: false,
      relatedHashtags: ["#lifestyle"],
    });

    it("returns challenge with auto-generated id", async () => {
      const result = await manager.createHashtagChallenge(makeChallengeInput());

      assert.ok(result.id.startsWith("custom-"));
    });

    it("sets participantCount to 0 for new challenges", async () => {
      const result = await manager.createHashtagChallenge(makeChallengeInput());

      assert.strictEqual(result.participantCount, 0);
    });

    it("sets totalViews to 0 for new challenges", async () => {
      const result = await manager.createHashtagChallenge(makeChallengeInput());

      assert.strictEqual(result.totalViews, 0);
    });

    it("preserves all input fields in the returned challenge", async () => {
      const input = makeChallengeInput();
      const result = await manager.createHashtagChallenge(input);

      assert.strictEqual(result.hashtag, "#MyChallenge");
      assert.strictEqual(result.name, "My Custom Challenge");
      assert.strictEqual(result.description, "A test challenge");
      assert.strictEqual(result.startDate, "2024-06-01");
      assert.strictEqual(result.endDate, "2024-08-01");
      assert.strictEqual(result.category, "lifestyle");
      assert.strictEqual(result.difficulty, "medium");
      assert.strictEqual(result.trending, false);
      expect(result.rules).toEqual(["Rule 1", "Rule 2"]);
      expect(result.relatedHashtags).toEqual(["#lifestyle"]);
      expect(result.judging.criteria).toEqual(["Originality"]);
      assert.strictEqual(result.judging.winners, 10);
    });
  });

  // =========================================================================
  // getHashtagRecommendations
  // =========================================================================
  describe("getHashtagRecommendations", () => {
    it("calls getKeywordTrends with extracted keywords", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await manager.getHashtagRecommendations({
        content: "Amazing dance tutorial for beginners",
        goals: "reach",
      });

      const kwCall = (mockClient.getKeywordTrends as ReturnType<typeof vi.fn>).mock.calls[0]!;
      // extractKeywords filters stopwords and short words, keeps words > 3 chars
      expect(kwCall[0]).toContain("amazing");
      expect(kwCall[0]).toContain("dance");
      expect(kwCall[0]).toContain("tutorial");
      expect(kwCall[0]).toContain("beginners");
    });

    it("passes region to getKeywordTrends when provided", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await manager.getHashtagRecommendations({
        content: "cooking recipes",
        goals: "engagement",
        region: "UK",
      });

      const kwCall = (mockClient.getKeywordTrends as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(kwCall[1]).toEqual({ region: "UK", timeframe: "30d" });
    });

    it("does not include region in getKeywordTrends when not provided", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await manager.getHashtagRecommendations({
        content: "cooking recipes",
        goals: "engagement",
      });

      const kwCall = (mockClient.getKeywordTrends as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(kwCall[1]).toEqual({ timeframe: "30d" });
    });

    it("passes region to getTrendingHashtags when provided", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await manager.getHashtagRecommendations({
        content: "test content here",
        goals: "viral",
        region: "DE",
      });

      expect(mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
        region: "DE",
        timeframe: "7d",
        limit: 100,
      });
    });

    it("returns HashtagRecommendation with all required fields", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#trending1", volume: 200000, growth: 60 }),
      ]);

      const result = await manager.getHashtagRecommendations({
        content: "trending content video",
        goals: "reach",
      });

      assert.ok(Array.isArray(result.recommended));
      assert.ok(typeof result.reasons === "object");
      assert.ok(typeof result.alternatives === "object");
      assert.ok(result.optimal);
      assert.ok(Array.isArray(result.optimal.mix));
      assert.ok(typeof result.optimal.reasoning === "string");
      assert.ok(typeof result.optimal.expectedReach === "number");
      assert.ok(typeof result.optimal.competitionLevel === "string");
      assert.ok(Array.isArray(result.avoid));
      assert.ok(result.timing);
      assert.ok(Array.isArray(result.timing.bestTimes));
      assert.ok(Array.isArray(result.timing.avoid));
      assert.ok(Array.isArray(result.timing.seasonal));
    });

    it("limits recommended to max 15 items", async () => {
      const manyHashtags = Array.from({ length: 25 }, (_, i) =>
        makeTrendingHashtag({
          hashtag: `#tag${i}`,
          volume: 200000,
          growth: 60,
          difficulty: 30,
        })
      );
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        manyHashtags
      );

      const result = await manager.getHashtagRecommendations({
        content: "popular trendy amazing viral content video dance",
        goals: "reach",
      });

      assert.ok(result.recommended.length <= 15);
    });

    it("includes avoid list for high difficulty hashtags", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        makeTrendingHashtag({ hashtag: "#hardtag", difficulty: 95, volume: 200000 }),
      ]);

      const result = await manager.getHashtagRecommendations({
        content: "test content here",
        goals: "reach",
      });

      const avoidHashtags = result.avoid.map((a) => a.hashtag);
      expect(avoidHashtags).toContain("#hardtag");
    });

    it("includes user-specified avoid hashtags in avoid list", async () => {
      (mockClient.getTrendingHashtags as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await manager.getHashtagRecommendations({
        content: "test content here",
        goals: "niche",
        avoidHashtags: ["#banned"],
      });

      const avoidHashtags = result.avoid.map((a) => a.hashtag);
      expect(avoidHashtags).toContain("#banned");
    });
  });

  // =========================================================================
  // getCircuitBreakerStatus & clearCache & getMetricsRegistry
  // =========================================================================
  describe("getCircuitBreakerStatus", () => {
    it("delegates to circuitBreaker.getAllStatuses", () => {
      const result = manager.getCircuitBreakerStatus();

      expect(result).toEqual({ "tiktok-hashtag-manager": "CLOSED" });
    });
  });

  describe("clearCache", () => {
    it("does not throw when called", () => {
      expect(() => manager.clearCache()).not.toThrow();
    });
  });

  describe("getMetricsRegistry", () => {
    it("returns a registry object", () => {
      const registry = TikTokHashtagManager.getMetricsRegistry();

      assert.ok(registry !== null);
      assert.ok(registry !== undefined);
    });
  });
});
