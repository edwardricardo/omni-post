/**
 * @file researchApiClient.test.ts
 * @description Mutation-killing tests for TikTokResearchApiClient.
 *              Covers all 6 API methods + 3 utility methods with full field mapping,
 *              default value verification, error handling, and parameter defaults.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available in hoisted vi.mock factories
// ---------------------------------------------------------------------------

const { mockCall, mockGetAllStatuses, mockClearCache } = vi.hoisted(() => ({
  mockCall: vi.fn((_svc: string, _op: string, fn: () => unknown) => fn()),
  mockGetAllStatuses: vi.fn(() => ({ op1: "closed" })),
  mockClearCache: vi.fn(),
}));

vi.mock("@adapters/external-apis", () => ({
  createExternalApiCircuitBreaker: vi.fn(() => ({
    call: mockCall,
    getAllStatuses: mockGetAllStatuses,
    clearCache: mockClearCache,
  })),
}));
vi.mock("@adapters/fallback-strategies", () => ({
  CommonFallbackStrategies: { METADATA_FALLBACK: {}, ANALYTICS_FALLBACK: {} },
}));
vi.mock("@providers/shared", () => ({
  ProviderError: { externalService: vi.fn((_p: string, m: string) => new Error(m)) },
}));
vi.mock("prom-client", () => {
  const R = vi.fn();
  R.prototype = {};
  return { Registry: R };
});
vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import axios from "axios";
import { TikTokResearchApiClient } from "../src/researchApiClient.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCreds() {
  return {
    clientKey: "ck",
    clientSecret: "cs",
    accessToken: "at",
    openId: "oid",
    researchApiKey: "research-key-123",
  };
}

function makeClient() {
  return new TikTokResearchApiClient(makeCreds());
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("TikTokResearchApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((_svc, _op, fn) => fn());
  });

  // =========================================================================
  // getTrendingHashtags
  // =========================================================================

  describe("getTrendingHashtags", () => {
    it("maps all fields correctly from full API response", async () => {
      const apiData = [
        {
          hashtag: "#dance",
          volume: 50000,
          growth: 12.5,
          difficulty: 7,
          engagement: 8.3,
          category: "entertainment",
          related_hashtags: ["#music", "#viral"],
          trending_score: 95,
        },
      ];
      vi.mocked(axios.get).mockResolvedValue({ data: { data: apiData } });

      const result = await makeClient().getTrendingHashtags({
        region: "UK",
        category: "music",
        timeframe: "1d",
        limit: 10,
      });

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].hashtag, "#dance");
      assert.strictEqual(result[0].volume, 50000);
      assert.strictEqual(result[0].growth, 12.5);
      assert.strictEqual(result[0].difficulty, 7);
      assert.strictEqual(result[0].engagement, 8.3);
      assert.strictEqual(result[0].category, "entertainment");
      assert.deepStrictEqual(result[0].relatedHashtags, ["#music", "#viral"]);
      assert.strictEqual(result[0].trendingScore, 95);
    });

    it("applies default values when API fields are missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ hashtag: "#minimal" }] } });

      const result = await makeClient().getTrendingHashtags();

      assert.strictEqual(result[0].volume, 0);
      assert.strictEqual(result[0].growth, 0);
      assert.strictEqual(result[0].difficulty, 0);
      assert.strictEqual(result[0].engagement, 0);
      assert.strictEqual(result[0].category, "general");
      assert.deepStrictEqual(result[0].relatedHashtags, []);
      assert.strictEqual(result[0].trendingScore, 0);
    });

    it("sends correct default params when no options provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingHashtags();

      const call = vi.mocked(axios.get).mock.calls[0];
      assert.ok(call);
      expect(call[1]?.params).toMatchObject({
        region: "US",
        category: "all",
        timeframe: "7d",
        limit: 50,
      });
    });

    it("sends custom params when options provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingHashtags({
        region: "JP",
        category: "sports",
        timeframe: "30d",
        limit: 5,
      });

      const call = vi.mocked(axios.get).mock.calls[0];
      expect(call[1]?.params).toMatchObject({
        region: "JP",
        category: "sports",
        timeframe: "30d",
        limit: 5,
      });
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      });

      await expect(makeClient().getTrendingHashtags()).rejects.toThrow(
        "TikTok Research API error: RATE_LIMITED - Too many requests"
      );
    });

    it("sends Authorization header with researchApiKey", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingHashtags();

      const call = vi.mocked(axios.get).mock.calls[0];
      assert.strictEqual(call[1]?.headers?.Authorization, "Bearer research-key-123");
    });
  });

  // =========================================================================
  // getTrendingVideos
  // =========================================================================

  describe("getTrendingVideos", () => {
    it("maps all fields correctly from full API response", async () => {
      const apiData = [
        {
          video_id: "v123",
          author_id: "a456",
          author_name: "Creator1",
          description: "Cool video",
          hashtags: ["#fun"],
          music_id: "m789",
          music_title: "Hit Song",
          duration: 30,
          view_count: 1000000,
          like_count: 50000,
          share_count: 10000,
          comment_count: 2000,
          create_time: "2024-01-01T00:00:00Z",
          viral_score: 88,
          trending_reason: ["algorithm", "hashtag"],
        },
      ];
      vi.mocked(axios.get).mockResolvedValue({ data: { data: apiData } });

      const result = await makeClient().getTrendingVideos();

      assert.strictEqual(result[0].videoId, "v123");
      assert.strictEqual(result[0].authorId, "a456");
      assert.strictEqual(result[0].authorName, "Creator1");
      assert.strictEqual(result[0].description, "Cool video");
      assert.deepStrictEqual(result[0].hashtags, ["#fun"]);
      assert.strictEqual(result[0].musicId, "m789");
      assert.strictEqual(result[0].musicTitle, "Hit Song");
      assert.strictEqual(result[0].duration, 30);
      assert.strictEqual(result[0].viewCount, 1000000);
      assert.strictEqual(result[0].likeCount, 50000);
      assert.strictEqual(result[0].shareCount, 10000);
      assert.strictEqual(result[0].commentCount, 2000);
      assert.strictEqual(result[0].createTime, "2024-01-01T00:00:00Z");
      assert.strictEqual(result[0].viralScore, 88);
      assert.deepStrictEqual(result[0].trendingReason, ["algorithm", "hashtag"]);
    });

    it("applies default values when API fields are missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          data: [
            {
              video_id: "v1",
              author_id: "a1",
              author_name: "x",
              description: "d",
              create_time: "t",
            },
          ],
        },
      });

      const result = await makeClient().getTrendingVideos();

      assert.deepStrictEqual(result[0].hashtags, []);
      assert.strictEqual(result[0].duration, 0);
      assert.strictEqual(result[0].viewCount, 0);
      assert.strictEqual(result[0].likeCount, 0);
      assert.strictEqual(result[0].shareCount, 0);
      assert.strictEqual(result[0].commentCount, 0);
      assert.strictEqual(result[0].viralScore, 0);
      assert.deepStrictEqual(result[0].trendingReason, []);
    });

    it("sends correct default params", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingVideos();

      const call = vi.mocked(axios.get).mock.calls[0];
      expect(call[1]?.params).toMatchObject({
        region: "US",
        category: "all",
        timeframe: "7d",
        min_views: 100000,
        limit: 100,
      });
    });

    it("passes custom minViews and limit", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingVideos({ minViews: 500000, limit: 20 });

      const call = vi.mocked(axios.get).mock.calls[0];
      expect(call[1]?.params).toMatchObject({ min_views: 500000, limit: 20 });
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { error: { code: "AUTH_FAIL", message: "Invalid token" } },
      });

      await expect(makeClient().getTrendingVideos()).rejects.toThrow(
        "TikTok Research API error: AUTH_FAIL - Invalid token"
      );
    });

    it("preserves optional musicId and musicTitle when present", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          data: [
            {
              video_id: "v1",
              author_id: "a1",
              author_name: "n",
              description: "d",
              create_time: "t",
              music_id: "m1",
              music_title: "Song",
            },
          ],
        },
      });

      const result = await makeClient().getTrendingVideos();
      assert.strictEqual(result[0].musicId, "m1");
      assert.strictEqual(result[0].musicTitle, "Song");
    });
  });

  // =========================================================================
  // getTrendingSounds
  // =========================================================================

  describe("getTrendingSounds", () => {
    it("maps all fields correctly from full API response", async () => {
      const apiData = [
        {
          sound_id: "s123",
          title: "Popular Beat",
          author: "DJ Test",
          duration: 60,
          usage_count: 100000,
          growth: 25.5,
          category: "pop",
          mood: "happy",
          tempo: "fast",
          is_original: true,
          is_copyright_free: true,
          preview_url: "https://example.com/preview.mp3",
        },
      ];
      vi.mocked(axios.get).mockResolvedValue({ data: { data: apiData } });

      const result = await makeClient().getTrendingSounds();

      assert.strictEqual(result[0].soundId, "s123");
      assert.strictEqual(result[0].title, "Popular Beat");
      assert.strictEqual(result[0].author, "DJ Test");
      assert.strictEqual(result[0].duration, 60);
      assert.strictEqual(result[0].usageCount, 100000);
      assert.strictEqual(result[0].growth, 25.5);
      assert.strictEqual(result[0].category, "pop");
      assert.strictEqual(result[0].mood, "happy");
      assert.strictEqual(result[0].tempo, "fast");
      assert.strictEqual(result[0].isOriginal, true);
      assert.strictEqual(result[0].isCopyrightFree, true);
      assert.strictEqual(result[0].previewUrl, "https://example.com/preview.mp3");
    });

    it("applies default values when API fields are missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          data: [{ sound_id: "s1", title: "t", author: "a", category: "c", mood: "m", tempo: "t" }],
        },
      });

      const result = await makeClient().getTrendingSounds();

      assert.strictEqual(result[0].duration, 0);
      assert.strictEqual(result[0].usageCount, 0);
      assert.strictEqual(result[0].growth, 0);
      assert.strictEqual(result[0].isOriginal, false);
      assert.strictEqual(result[0].isCopyrightFree, false);
    });

    it("sends correct default params without optional filters", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingSounds();

      const call = vi.mocked(axios.get).mock.calls[0];
      const params = call[1]?.params;
      expect(params).toMatchObject({ region: "US", category: "all", limit: 50 });
      assert.strictEqual(params.mood, undefined);
      assert.strictEqual(params.tempo, undefined);
      assert.strictEqual(params.copyright_free, undefined);
    });

    it("includes mood param when provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingSounds({ mood: "chill" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.mood, "chill");
    });

    it("includes tempo param when provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingSounds({ tempo: "slow" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.tempo, "slow");
    });

    it("includes copyright_free param when copyrightFree is explicitly set", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } });

      await makeClient().getTrendingSounds({ copyrightFree: false });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.copyright_free, false);
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { error: { code: "SERVER_ERR", message: "Internal error" } },
      });

      await expect(makeClient().getTrendingSounds()).rejects.toThrow(
        "TikTok Research API error: SERVER_ERR - Internal error"
      );
    });
  });

  // =========================================================================
  // getKeywordTrends
  // =========================================================================

  describe("getKeywordTrends", () => {
    it("maps all fields correctly from full API response", async () => {
      const apiData = [
        {
          keyword: "cooking",
          volume: 80000,
          competition: 0.65,
          trend: "rising",
          related_keywords: ["recipe", "food"],
          category_scores: { food: 0.9, lifestyle: 0.4 },
          demographic_breakdown: {
            age: { "18-24": 40, "25-34": 35 },
            gender: { male: 45, female: 55 },
            location: { US: 60, UK: 20 },
          },
        },
      ];
      vi.mocked(axios.post).mockResolvedValue({ data: { data: apiData } });

      const result = await makeClient().getKeywordTrends(["cooking"]);

      assert.strictEqual(result[0].keyword, "cooking");
      assert.strictEqual(result[0].volume, 80000);
      assert.strictEqual(result[0].competition, 0.65);
      assert.strictEqual(result[0].trend, "rising");
      assert.deepStrictEqual(result[0].relatedKeywords, ["recipe", "food"]);
      assert.deepStrictEqual(result[0].categoryScores, { food: 0.9, lifestyle: 0.4 });
      assert.deepStrictEqual(result[0].demographicBreakdown.age, { "18-24": 40, "25-34": 35 });
      assert.deepStrictEqual(result[0].demographicBreakdown.gender, { male: 45, female: 55 });
      assert.deepStrictEqual(result[0].demographicBreakdown.location, { US: 60, UK: 20 });
    });

    it("applies default values when API fields are missing", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [{ keyword: "test" }] } });

      const result = await makeClient().getKeywordTrends(["test"]);

      assert.strictEqual(result[0].volume, 0);
      assert.strictEqual(result[0].competition, 0);
      assert.strictEqual(result[0].trend, "stable");
      assert.deepStrictEqual(result[0].relatedKeywords, []);
      assert.deepStrictEqual(result[0].categoryScores, {});
      assert.deepStrictEqual(result[0].demographicBreakdown.age, {});
      assert.deepStrictEqual(result[0].demographicBreakdown.gender, {});
      assert.deepStrictEqual(result[0].demographicBreakdown.location, {});
    });

    it("handles partial demographic_breakdown", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { data: [{ keyword: "x", demographic_breakdown: { age: { "18-24": 50 } } }] },
      });

      const result = await makeClient().getKeywordTrends(["x"]);

      assert.deepStrictEqual(result[0].demographicBreakdown.age, { "18-24": 50 });
      assert.deepStrictEqual(result[0].demographicBreakdown.gender, {});
      assert.deepStrictEqual(result[0].demographicBreakdown.location, {});
    });

    it("sends correct default params", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getKeywordTrends(["a", "b"]);

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.keywords, "a,b");
      assert.strictEqual(body.region, "US");
      assert.strictEqual(body.timeframe, "30d");
    });

    it("sends custom region and timeframe", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getKeywordTrends(["kw"], { region: "DE", timeframe: "90d" });

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.region, "DE");
      assert.strictEqual(body.timeframe, "90d");
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { error: { code: "QUOTA", message: "Quota exceeded" } },
      });

      await expect(makeClient().getKeywordTrends(["test"])).rejects.toThrow(
        "TikTok Research API error: QUOTA - Quota exceeded"
      );
    });

    it("uses POST method to keywords/trends endpoint", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getKeywordTrends(["word"]);

      const url = vi.mocked(axios.post).mock.calls[0][0];
      assert.ok(url.includes("/keywords/trends"));
    });
  });

  // =========================================================================
  // getContentGaps
  // =========================================================================

  describe("getContentGaps", () => {
    it("maps all fields correctly from full API response", async () => {
      const apiData = [
        {
          topic: "DIY crafts",
          opportunity: 85,
          difficulty: 30,
          suggested_hashtags: ["#diy", "#crafts"],
          suggested_formats: ["tutorial", "timelapse"],
          target_audience: ["teens", "young-adults"],
          competitor_analysis: {
            top_creators: ["creator1", "creator2"],
            average_engagement: 7.2,
            content_frequency: 3.5,
          },
        },
      ];
      vi.mocked(axios.post).mockResolvedValue({ data: { data: apiData } });

      const result = await makeClient().getContentGaps({ category: "diy" });

      assert.strictEqual(result[0].topic, "DIY crafts");
      assert.strictEqual(result[0].opportunity, 85);
      assert.strictEqual(result[0].difficulty, 30);
      assert.deepStrictEqual(result[0].suggestedHashtags, ["#diy", "#crafts"]);
      assert.deepStrictEqual(result[0].suggestedFormats, ["tutorial", "timelapse"]);
      assert.deepStrictEqual(result[0].targetAudience, ["teens", "young-adults"]);
      assert.deepStrictEqual(result[0].competitorAnalysis.topCreators, ["creator1", "creator2"]);
      assert.strictEqual(result[0].competitorAnalysis.averageEngagement, 7.2);
      assert.strictEqual(result[0].competitorAnalysis.contentFrequency, 3.5);
    });

    it("applies default values when API fields are missing", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [{ topic: "t" }] } });

      const result = await makeClient().getContentGaps();

      assert.strictEqual(result[0].opportunity, 0);
      assert.strictEqual(result[0].difficulty, 0);
      assert.deepStrictEqual(result[0].suggestedHashtags, []);
      assert.deepStrictEqual(result[0].suggestedFormats, []);
      assert.deepStrictEqual(result[0].targetAudience, []);
      assert.deepStrictEqual(result[0].competitorAnalysis.topCreators, []);
      assert.strictEqual(result[0].competitorAnalysis.averageEngagement, 0);
      assert.strictEqual(result[0].competitorAnalysis.contentFrequency, 0);
    });

    it("handles partial competitor_analysis", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { data: [{ topic: "t", competitor_analysis: { top_creators: ["c1"] } }] },
      });

      const result = await makeClient().getContentGaps();

      assert.deepStrictEqual(result[0].competitorAnalysis.topCreators, ["c1"]);
      assert.strictEqual(result[0].competitorAnalysis.averageEngagement, 0);
      assert.strictEqual(result[0].competitorAnalysis.contentFrequency, 0);
    });

    it("sends correct default params", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getContentGaps();

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.category, "all");
      assert.strictEqual(body.region, "US");
      assert.strictEqual(body.audience_size, "medium");
    });

    it("joins competitorIds with comma", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getContentGaps({ competitorIds: ["id1", "id2"] });

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.competitor_ids, "id1,id2");
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { error: { code: "FORBIDDEN", message: "Access denied" } },
      });

      await expect(makeClient().getContentGaps()).rejects.toThrow(
        "TikTok Research API error: FORBIDDEN - Access denied"
      );
    });
  });

  // =========================================================================
  // getViralContentAnalysis
  // =========================================================================

  describe("getViralContentAnalysis", () => {
    it("maps all fields correctly from full API response", async () => {
      const apiData = [
        {
          content_id: "c123",
          type: "sound",
          title: "Viral Thing",
          description: "A viral description",
          creator: "someone",
          viral_metrics: {
            viral_coefficient: 2.5,
            growth_rate: 15.3,
            peak_engagement: 95000,
            sustainability_score: 0.8,
          },
          characteristics: {
            hooks: ["surprise", "humor"],
            format: "duet",
            duration: 15,
            music_genre: "pop",
            visual_style: ["bright", "fast-paced"],
          },
          replication_guide: {
            key_elements: ["hook first 3s"],
            timing: "morning",
            hashtags: ["#fyp"],
            suggested_variations: ["remix"],
          },
        },
      ];
      vi.mocked(axios.post).mockResolvedValue({ data: { data: apiData } });

      const result = await makeClient().getViralContentAnalysis();

      assert.strictEqual(result[0].contentId, "c123");
      assert.strictEqual(result[0].type, "sound");
      assert.strictEqual(result[0].title, "Viral Thing");
      assert.strictEqual(result[0].description, "A viral description");
      assert.strictEqual(result[0].creator, "someone");
      assert.strictEqual(result[0].viralMetrics.viralCoefficient, 2.5);
      assert.strictEqual(result[0].viralMetrics.growthRate, 15.3);
      assert.strictEqual(result[0].viralMetrics.peakEngagement, 95000);
      assert.strictEqual(result[0].viralMetrics.sustainabilityScore, 0.8);
      assert.deepStrictEqual(result[0].characteristics.hooks, ["surprise", "humor"]);
      assert.strictEqual(result[0].characteristics.format, "duet");
      assert.strictEqual(result[0].characteristics.duration, 15);
      assert.strictEqual(result[0].characteristics.musicGenre, "pop");
      assert.deepStrictEqual(result[0].characteristics.visualStyle, ["bright", "fast-paced"]);
      assert.deepStrictEqual(result[0].replicationGuide.keyElements, ["hook first 3s"]);
      assert.strictEqual(result[0].replicationGuide.timing, "morning");
      assert.deepStrictEqual(result[0].replicationGuide.hashtags, ["#fyp"]);
      assert.deepStrictEqual(result[0].replicationGuide.suggestedVariations, ["remix"]);
    });

    it("applies default values when all nested fields are missing", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { data: [{ content_id: "c1", type: "video", title: "T" }] },
      });

      const result = await makeClient().getViralContentAnalysis();

      // viralMetrics defaults
      assert.strictEqual(result[0].viralMetrics.viralCoefficient, 0);
      assert.strictEqual(result[0].viralMetrics.growthRate, 0);
      assert.strictEqual(result[0].viralMetrics.peakEngagement, 0);
      assert.strictEqual(result[0].viralMetrics.sustainabilityScore, 0);
      // characteristics defaults
      assert.deepStrictEqual(result[0].characteristics.hooks, []);
      assert.strictEqual(result[0].characteristics.format, "video");
      assert.deepStrictEqual(result[0].characteristics.visualStyle, []);
      // replicationGuide defaults
      assert.deepStrictEqual(result[0].replicationGuide.keyElements, []);
      assert.strictEqual(result[0].replicationGuide.timing, "anytime");
      assert.deepStrictEqual(result[0].replicationGuide.hashtags, []);
      assert.deepStrictEqual(result[0].replicationGuide.suggestedVariations, []);
    });

    it("preserves optional description and creator when present", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          data: [
            { content_id: "c1", type: "video", title: "T", description: "desc", creator: "me" },
          ],
        },
      });

      const result = await makeClient().getViralContentAnalysis();
      assert.strictEqual(result[0].description, "desc");
      assert.strictEqual(result[0].creator, "me");
    });

    it("preserves optional duration and musicGenre in characteristics", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          data: [
            {
              content_id: "c1",
              type: "video",
              title: "T",
              characteristics: { duration: 45, music_genre: "rock" },
            },
          ],
        },
      });

      const result = await makeClient().getViralContentAnalysis();
      assert.strictEqual(result[0].characteristics.duration, 45);
      assert.strictEqual(result[0].characteristics.musicGenre, "rock");
    });

    it("sends correct default params", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getViralContentAnalysis();

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.timeframe, "30d");
      assert.strictEqual(body.category, "all");
      assert.strictEqual(body.min_viral_score, 70);
    });

    it("joins contentIds and passes custom options", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getViralContentAnalysis({
        contentIds: ["c1", "c2"],
        timeframe: "7d",
        category: "comedy",
        minViralScore: 90,
      });

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.content_ids, "c1,c2");
      assert.strictEqual(body.timeframe, "7d");
      assert.strictEqual(body.category, "comedy");
      assert.strictEqual(body.min_viral_score, 90);
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { error: { code: "TIMEOUT", message: "Request timed out" } },
      });

      await expect(makeClient().getViralContentAnalysis()).rejects.toThrow(
        "TikTok Research API error: TIMEOUT - Request timed out"
      );
    });
  });

  // =========================================================================
  // Utility methods
  // =========================================================================

  describe("getCircuitBreakerStatus", () => {
    it("delegates to circuitBreaker.getAllStatuses", () => {
      const result = makeClient().getCircuitBreakerStatus();
      assert.deepStrictEqual(result, { op1: "closed" });
      expect(mockGetAllStatuses).toHaveBeenCalledOnce();
    });
  });

  describe("getMetricsRegistry", () => {
    it("returns the global prom-client registry", () => {
      const reg = TikTokResearchApiClient.getMetricsRegistry();
      assert.ok(reg);
    });
  });

  describe("clearCache", () => {
    it("delegates to circuitBreaker.clearCache with correct service name", () => {
      makeClient().clearCache();
      expect(mockClearCache).toHaveBeenCalledWith("tiktok-research-api");
    });
  });
});
