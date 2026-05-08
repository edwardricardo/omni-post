/**
 * @file contentAnalyticsClient.test.ts
 * @description Mutation-killing tests for TikTokContentAnalyticsClient.
 *              Covers all 4 API methods + 3 utility methods with deeply nested field mapping,
 *              default value verification, error handling, and optional field inclusion.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

const { mockCall, mockGetAllStatuses, mockClearCache } = vi.hoisted(() => ({
  mockCall: vi.fn((_svc: string, _op: string, fn: () => unknown) => fn()),
  mockGetAllStatuses: vi.fn(() => ({ analytics: "closed" })),
  mockClearCache: vi.fn(),
}));

vi.mock("@adapters/external-apis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/external-apis")>();
  return {
    ...actual,
    createExternalApiCircuitBreaker: vi.fn(() => ({
      call: mockCall,
      getAllStatuses: mockGetAllStatuses,
      clearCache: mockClearCache,
    })),
  };
});
vi.mock("@adapters/fallback-strategies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/fallback-strategies")>();
  return {
    ...actual,
    CommonFallbackStrategies: { METADATA_FALLBACK: {}, ANALYTICS_FALLBACK: {} },
  };
});
vi.mock("@providers/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@providers/shared")>();
  return {
    ...actual,
    ProviderError: { externalService: vi.fn((_p: string, m: string) => new Error(m)) },
  };
});
vi.mock("prom-client", () => {
  const R = vi.fn();
  R.prototype = {};
  return { Registry: R };
});
vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import axios from "axios";
import { TikTokContentAnalyticsClient } from "../src/contentAnalyticsClient.js";

function makeCreds() {
  return {
    clientKey: "ck",
    clientSecret: "cs",
    accessToken: "at",
    openId: "oid",
    analyticsApiKey: "analytics-key-789",
  };
}

function makeClient() {
  return new TikTokContentAnalyticsClient(makeCreds());
}

describe("TikTokContentAnalyticsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((_svc, _op, fn) => fn());
  });

  describe("getVideoAnalytics", () => {
    it("maps all fields correctly from full API response", async () => {
      const data = {
        video_id: "vid-001",
        title: "My Video",
        published_at: "2024-06-01T12:00:00Z",
        duration: 45,
        metrics: {
          views: 100000,
          unique_views: 80000,
          likes: 5000,
          shares: 1200,
          comments: 800,
          saves: 2000,
          profile_visits: 500,
          follows: 100,
          engagement_rate: 0.065,
          completion_rate: 0.72,
          drop_off_points: [{ timestamp: 5, percentage: 0.1 }],
          replay_rate: 0.15,
          forward_jumps: 300,
          backward_jumps: 150,
        },
        audience: {
          demographics: {
            age: { "18-24": 40 },
            gender: { male: 55 },
            location: { US: 60 },
          },
          behavior: {
            device_type: { mobile: 80 },
            watch_time: { short: 30 },
            engagement_time: { morning: 25 },
          },
          interests: [{ category: "Tech", affinity: 0.8 }],
        },
        traffic: {
          sources: { fyp: 70, search: 20 },
          hashtags: [{ hashtag: "#test", views: 5000 }],
          sounds: [{ soundId: "s1", views: 3000 }],
        },
        performance: {
          virality_score: 85,
          trending_potential: 70,
          algorithm_score: 90,
          quality_score: 75,
          content_score: 80,
        },
      };
      vi.mocked(axios.get).mockResolvedValue({ data: { data } });

      const result = await makeClient().getVideoAnalytics("vid-001", {
        includeDemographics: true,
        includeTraffic: true,
        includePerformance: true,
      });

      assert.strictEqual(result.videoId, "vid-001");
      assert.strictEqual(result.title, "My Video");
      assert.strictEqual(result.publishedAt, "2024-06-01T12:00:00Z");
      assert.strictEqual(result.duration, 45);
      assert.strictEqual(result.metrics.views, 100000);
      assert.strictEqual(result.metrics.uniqueViews, 80000);
      assert.strictEqual(result.metrics.likes, 5000);
      assert.strictEqual(result.metrics.shares, 1200);
      assert.strictEqual(result.metrics.comments, 800);
      assert.strictEqual(result.metrics.saves, 2000);
      assert.strictEqual(result.metrics.profileVisits, 500);
      assert.strictEqual(result.metrics.follows, 100);
      assert.strictEqual(result.metrics.engagementRate, 0.065);
      assert.strictEqual(result.metrics.completionRate, 0.72);
      assert.deepStrictEqual(result.metrics.dropOffPoints, [{ timestamp: 5, percentage: 0.1 }]);
      assert.strictEqual(result.metrics.replayRate, 0.15);
      assert.strictEqual(result.metrics.forwardJumps, 300);
      assert.strictEqual(result.metrics.backwardJumps, 150);
      assert.deepStrictEqual(result.audience.demographics.age, { "18-24": 40 });
      assert.deepStrictEqual(result.audience.demographics.gender, { male: 55 });
      assert.deepStrictEqual(result.audience.demographics.location, { US: 60 });
      assert.deepStrictEqual(result.audience.behavior.deviceType, { mobile: 80 });
      assert.deepStrictEqual(result.audience.behavior.watchTime, { short: 30 });
      assert.deepStrictEqual(result.audience.behavior.engagementTime, { morning: 25 });
      assert.deepStrictEqual(result.audience.interests, [{ category: "Tech", affinity: 0.8 }]);
      assert.deepStrictEqual(result.traffic.sources, { fyp: 70, search: 20 });
      assert.deepStrictEqual(result.traffic.hashtags, [{ hashtag: "#test", views: 5000 }]);
      assert.deepStrictEqual(result.traffic.sounds, [{ soundId: "s1", views: 3000 }]);
      assert.strictEqual(result.performance.viralityScore, 85);
      assert.strictEqual(result.performance.trendingPotential, 70);
      assert.strictEqual(result.performance.algorithmScore, 90);
      assert.strictEqual(result.performance.qualityScore, 75);
      assert.strictEqual(result.performance.contentScore, 80);
    });

    it("applies default values for all nested fields when missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { video_id: "v1", title: "t", published_at: "p", duration: 10 } },
      });

      const result = await makeClient().getVideoAnalytics("v1");

      assert.strictEqual(result.metrics.views, 0);
      assert.strictEqual(result.metrics.uniqueViews, 0);
      assert.strictEqual(result.metrics.likes, 0);
      assert.strictEqual(result.metrics.shares, 0);
      assert.strictEqual(result.metrics.comments, 0);
      assert.strictEqual(result.metrics.saves, 0);
      assert.strictEqual(result.metrics.profileVisits, 0);
      assert.strictEqual(result.metrics.follows, 0);
      assert.strictEqual(result.metrics.engagementRate, 0);
      assert.strictEqual(result.metrics.completionRate, 0);
      assert.deepStrictEqual(result.metrics.dropOffPoints, []);
      assert.strictEqual(result.metrics.replayRate, 0);
      assert.strictEqual(result.metrics.forwardJumps, 0);
      assert.strictEqual(result.metrics.backwardJumps, 0);
      assert.deepStrictEqual(result.audience.demographics.age, {});
      assert.deepStrictEqual(result.audience.demographics.gender, {});
      assert.deepStrictEqual(result.audience.demographics.location, {});
      assert.deepStrictEqual(result.audience.behavior.deviceType, {});
      assert.deepStrictEqual(result.audience.behavior.watchTime, {});
      assert.deepStrictEqual(result.audience.behavior.engagementTime, {});
      assert.deepStrictEqual(result.audience.interests, []);
      assert.deepStrictEqual(result.traffic.sources, {});
      assert.deepStrictEqual(result.traffic.hashtags, []);
      assert.deepStrictEqual(result.traffic.sounds, []);
      assert.strictEqual(result.performance.viralityScore, 0);
      assert.strictEqual(result.performance.trendingPotential, 0);
      assert.strictEqual(result.performance.algorithmScore, 0);
      assert.strictEqual(result.performance.qualityScore, 0);
      assert.strictEqual(result.performance.contentScore, 0);
    });

    it("includes audience field when includeDemographics is true", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { video_id: "v1" } },
      });

      await makeClient().getVideoAnalytics("v1", { includeDemographics: true });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.ok(params.fields.includes("audience"));
    });

    it("includes traffic field when includeTraffic is true", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { video_id: "v1" } },
      });

      await makeClient().getVideoAnalytics("v1", { includeTraffic: true });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.ok(params.fields.includes("traffic"));
    });

    it("includes performance field when includePerformance is true", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { video_id: "v1" } },
      });

      await makeClient().getVideoAnalytics("v1", { includePerformance: true });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.ok(params.fields.includes("performance"));
    });

    it("excludes optional fields when flags are false/absent", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { video_id: "v1" } },
      });

      await makeClient().getVideoAnalytics("v1");

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.ok(!params.fields.includes("audience"));
      assert.ok(!params.fields.includes("traffic"));
      assert.ok(!params.fields.includes("performance"));
      assert.ok(params.fields.includes("video_id"));
      assert.ok(params.fields.includes("metrics"));
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { error: { code: "NOT_FOUND", message: "Video not found" } },
      });

      await expect(makeClient().getVideoAnalytics("v1")).rejects.toThrow(
        "TikTok Analytics API error: NOT_FOUND - Video not found"
      );
    });

    it("sends correct URL with videoId and Authorization header", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { video_id: "vid-xyz" } },
      });

      await makeClient().getVideoAnalytics("vid-xyz");

      const url = vi.mocked(axios.get).mock.calls[0][0];
      assert.ok(url.includes("/videos/vid-xyz/analytics"));
      const headers = vi.mocked(axios.get).mock.calls[0][1]?.headers;
      assert.strictEqual(headers?.Authorization, "Bearer analytics-key-789");
    });
  });

  describe("getProfileAnalytics", () => {
    it("maps all deeply nested fields from full API response", async () => {
      const data = {
        profile_id: "p-001",
        username: "testuser",
        display_name: "Test User",
        metrics: {
          followers: { total: 50000, gained: 2000, lost: 500, net_growth: 1500, growth_rate: 0.03 },
          engagement: {
            total_likes: 100000,
            total_shares: 20000,
            total_comments: 15000,
            average_engagement_rate: 0.08,
            engagement_growth: 0.05,
          },
          content: {
            videos_posted: 30,
            total_views: 2000000,
            average_views: 66667,
            best_performing_video_id: "best-1",
            worst_performing_video_id: "worst-1",
          },
          reach: {
            impressions: 3000000,
            reach: 2500000,
            profile_views: 50000,
            unique_profile_views: 40000,
          },
        },
        audience: {
          demographics: {
            age: { "18-24": 30 },
            gender: { female: 60 },
            top_countries: [{ country: "US", percentage: 40 }],
            top_cities: [{ city: "NYC", percentage: 15 }],
          },
          activity: {
            active_hours: { "14": 200 },
            active_days: { monday: 150 },
            peak_activity_time: "14:00",
          },
          interests: [{ category: "Music", affinity: 0.9 }],
          following_behavior: {
            average_following: 500,
            engagement_frequency: 3.5,
            content_consumption: { video: 70 },
          },
        },
        trends: {
          popular_hashtags: [{ hashtag: "#dance", usage: 10, performance: 85 }],
          popular_sounds: [{ soundId: "s1", title: "Hit", usage: 5 }],
          content_categories: { dance: 40 },
          best_posting_times: [{ hour: 14, day: "monday", performance: 90 }],
        },
      };
      vi.mocked(axios.get).mockResolvedValue({ data: { data } });

      const result = await makeClient().getProfileAnalytics({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        includeAudience: true,
        includeTrends: true,
      });

      assert.strictEqual(result.profileId, "p-001");
      assert.strictEqual(result.username, "testuser");
      assert.strictEqual(result.displayName, "Test User");
      assert.strictEqual(result.period.startDate, "2024-01-01");
      assert.strictEqual(result.period.endDate, "2024-01-31");
      assert.strictEqual(result.metrics.followers.total, 50000);
      assert.strictEqual(result.metrics.followers.gained, 2000);
      assert.strictEqual(result.metrics.followers.lost, 500);
      assert.strictEqual(result.metrics.followers.netGrowth, 1500);
      assert.strictEqual(result.metrics.followers.growthRate, 0.03);
      assert.strictEqual(result.metrics.engagement.totalLikes, 100000);
      assert.strictEqual(result.metrics.engagement.totalShares, 20000);
      assert.strictEqual(result.metrics.engagement.totalComments, 15000);
      assert.strictEqual(result.metrics.engagement.averageEngagementRate, 0.08);
      assert.strictEqual(result.metrics.engagement.engagementGrowth, 0.05);
      assert.strictEqual(result.metrics.content.videosPosted, 30);
      assert.strictEqual(result.metrics.content.totalViews, 2000000);
      assert.strictEqual(result.metrics.content.averageViews, 66667);
      assert.strictEqual(result.metrics.content.bestPerformingVideoId, "best-1");
      assert.strictEqual(result.metrics.content.worstPerformingVideoId, "worst-1");
      assert.strictEqual(result.metrics.reach.impressions, 3000000);
      assert.strictEqual(result.metrics.reach.reach, 2500000);
      assert.strictEqual(result.metrics.reach.profileViews, 50000);
      assert.strictEqual(result.metrics.reach.uniqueProfileViews, 40000);
      assert.deepStrictEqual(result.audience.demographics.age, { "18-24": 30 });
      assert.deepStrictEqual(result.audience.demographics.gender, { female: 60 });
      assert.deepStrictEqual(result.audience.demographics.topCountries, [
        { country: "US", percentage: 40 },
      ]);
      assert.deepStrictEqual(result.audience.demographics.topCities, [
        { city: "NYC", percentage: 15 },
      ]);
      assert.deepStrictEqual(result.audience.activity.activeHours, { "14": 200 });
      assert.deepStrictEqual(result.audience.activity.activeDays, { monday: 150 });
      assert.strictEqual(result.audience.activity.peakActivityTime, "14:00");
      assert.deepStrictEqual(result.audience.interests, [{ category: "Music", affinity: 0.9 }]);
      assert.strictEqual(result.audience.followingBehavior.averageFollowing, 500);
      assert.strictEqual(result.audience.followingBehavior.engagementFrequency, 3.5);
      assert.deepStrictEqual(result.audience.followingBehavior.contentConsumption, { video: 70 });
      assert.deepStrictEqual(result.trends.popularHashtags, [
        { hashtag: "#dance", usage: 10, performance: 85 },
      ]);
      assert.deepStrictEqual(result.trends.popularSounds, [
        { soundId: "s1", title: "Hit", usage: 5 },
      ]);
      assert.deepStrictEqual(result.trends.contentCategories, { dance: 40 });
      assert.deepStrictEqual(result.trends.bestPostingTimes, [
        { hour: 14, day: "monday", performance: 90 },
      ]);
    });

    it("applies all default values when nested fields are missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { profile_id: "p1", username: "u", display_name: "d" } },
      });

      const result = await makeClient().getProfileAnalytics({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result.metrics.followers.total, 0);
      assert.strictEqual(result.metrics.followers.gained, 0);
      assert.strictEqual(result.metrics.followers.lost, 0);
      assert.strictEqual(result.metrics.followers.netGrowth, 0);
      assert.strictEqual(result.metrics.followers.growthRate, 0);
      assert.strictEqual(result.metrics.engagement.totalLikes, 0);
      assert.strictEqual(result.metrics.engagement.totalShares, 0);
      assert.strictEqual(result.metrics.engagement.totalComments, 0);
      assert.strictEqual(result.metrics.engagement.averageEngagementRate, 0);
      assert.strictEqual(result.metrics.engagement.engagementGrowth, 0);
      assert.strictEqual(result.metrics.content.videosPosted, 0);
      assert.strictEqual(result.metrics.content.totalViews, 0);
      assert.strictEqual(result.metrics.content.averageViews, 0);
      assert.strictEqual(result.metrics.content.bestPerformingVideoId, "");
      assert.strictEqual(result.metrics.content.worstPerformingVideoId, "");
      assert.strictEqual(result.metrics.reach.impressions, 0);
      assert.strictEqual(result.metrics.reach.reach, 0);
      assert.strictEqual(result.metrics.reach.profileViews, 0);
      assert.strictEqual(result.metrics.reach.uniqueProfileViews, 0);
      assert.deepStrictEqual(result.audience.demographics.age, {});
      assert.deepStrictEqual(result.audience.demographics.gender, {});
      assert.deepStrictEqual(result.audience.demographics.topCountries, []);
      assert.deepStrictEqual(result.audience.demographics.topCities, []);
      assert.deepStrictEqual(result.audience.activity.activeHours, {});
      assert.deepStrictEqual(result.audience.activity.activeDays, {});
      assert.strictEqual(result.audience.activity.peakActivityTime, "");
      assert.deepStrictEqual(result.audience.interests, []);
      assert.strictEqual(result.audience.followingBehavior.averageFollowing, 0);
      assert.strictEqual(result.audience.followingBehavior.engagementFrequency, 0);
      assert.deepStrictEqual(result.audience.followingBehavior.contentConsumption, {});
      assert.deepStrictEqual(result.trends.popularHashtags, []);
      assert.deepStrictEqual(result.trends.popularSounds, []);
      assert.deepStrictEqual(result.trends.contentCategories, {});
      assert.deepStrictEqual(result.trends.bestPostingTimes, []);
    });

    it("includes audience field when includeAudience is true", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { profile_id: "p1" } },
      });

      await makeClient().getProfileAnalytics({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        includeAudience: true,
      });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.ok(params.fields.includes("audience"));
    });

    it("includes trends field when includeTrends is true", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { profile_id: "p1" } },
      });

      await makeClient().getProfileAnalytics({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        includeTrends: true,
      });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.ok(params.fields.includes("trends"));
    });

    it("excludes optional fields when flags are absent", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { profile_id: "p1" } },
      });

      await makeClient().getProfileAnalytics({ startDate: "2024-01-01", endDate: "2024-01-31" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.ok(!params.fields.includes("audience"));
      assert.ok(!params.fields.includes("trends"));
      assert.ok(params.fields.includes("metrics"));
    });

    it("sets period from options startDate and endDate", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: { profile_id: "p1" } },
      });

      const result = await makeClient().getProfileAnalytics({
        startDate: "2024-06-01",
        endDate: "2024-06-30",
      });

      assert.strictEqual(result.period.startDate, "2024-06-01");
      assert.strictEqual(result.period.endDate, "2024-06-30");
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { error: { code: "INVALID_TOKEN", message: "Token expired" } },
      });

      await expect(
        makeClient().getProfileAnalytics({ startDate: "2024-01-01", endDate: "2024-01-31" })
      ).rejects.toThrow("TikTok Analytics API error: INVALID_TOKEN - Token expired");
    });
  });

  describe("getCompetitorAnalysis", () => {
    it("maps all fields correctly from full API response", async () => {
      const competitor = {
        competitor_id: "comp-001",
        username: "rival1",
        metrics: {
          followers: 200000,
          average_views: 50000,
          average_likes: 5000,
          average_shares: 1000,
          average_comments: 500,
          engagement_rate: 0.06,
          posting_frequency: 2.5,
        },
        content: {
          top_performing_videos: [
            { videoId: "v1", views: 100000, engagement: 0.1, hashtags: ["#fyp"] },
          ],
          content_categories: { dance: 40, comedy: 30 },
          average_video_duration: 25,
          common_hashtags: ["#trending"],
          common_sounds: ["s1"],
        },
        strategy: {
          posting_pattern: { frequency: "daily", best_times: ["14:00"], consistency: 0.85 },
          engagement: { response_rate: 0.7, response_time: 120, community_engagement: 0.6 },
          growth: { follower_growth_rate: 0.05, content_growth_rate: 0.03, trend_adoption: 0.8 },
        },
      };
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [competitor] } });

      const result = await makeClient().getCompetitorAnalysis(["rival1"], {
        includeStrategy: true,
      });

      assert.strictEqual(result[0].competitorId, "comp-001");
      assert.strictEqual(result[0].username, "rival1");
      assert.strictEqual(result[0].metrics.followers, 200000);
      assert.strictEqual(result[0].metrics.averageViews, 50000);
      assert.strictEqual(result[0].metrics.averageLikes, 5000);
      assert.strictEqual(result[0].metrics.averageShares, 1000);
      assert.strictEqual(result[0].metrics.averageComments, 500);
      assert.strictEqual(result[0].metrics.engagementRate, 0.06);
      assert.strictEqual(result[0].metrics.postingFrequency, 2.5);
      assert.deepStrictEqual(result[0].content.topPerformingVideos, [
        { videoId: "v1", views: 100000, engagement: 0.1, hashtags: ["#fyp"] },
      ]);
      assert.deepStrictEqual(result[0].content.contentCategories, { dance: 40, comedy: 30 });
      assert.strictEqual(result[0].content.averageVideoDuration, 25);
      assert.deepStrictEqual(result[0].content.commonHashtags, ["#trending"]);
      assert.deepStrictEqual(result[0].content.commonSounds, ["s1"]);
      assert.strictEqual(result[0].strategy.postingPattern.frequency, "daily");
      assert.deepStrictEqual(result[0].strategy.postingPattern.bestTimes, ["14:00"]);
      assert.strictEqual(result[0].strategy.postingPattern.consistency, 0.85);
      assert.strictEqual(result[0].strategy.engagement.responseRate, 0.7);
      assert.strictEqual(result[0].strategy.engagement.responseTime, 120);
      assert.strictEqual(result[0].strategy.engagement.communityEngagement, 0.6);
      assert.strictEqual(result[0].strategy.growth.followerGrowthRate, 0.05);
      assert.strictEqual(result[0].strategy.growth.contentGrowthRate, 0.03);
      assert.strictEqual(result[0].strategy.growth.trendAdoption, 0.8);
    });

    it("applies default values when nested fields are missing", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { data: [{ competitor_id: "c1", username: "u1" }] },
      });

      const result = await makeClient().getCompetitorAnalysis(["u1"]);

      assert.strictEqual(result[0].metrics.followers, 0);
      assert.strictEqual(result[0].metrics.averageViews, 0);
      assert.strictEqual(result[0].metrics.averageLikes, 0);
      assert.strictEqual(result[0].metrics.averageShares, 0);
      assert.strictEqual(result[0].metrics.averageComments, 0);
      assert.strictEqual(result[0].metrics.engagementRate, 0);
      assert.strictEqual(result[0].metrics.postingFrequency, 0);
      assert.deepStrictEqual(result[0].content.topPerformingVideos, []);
      assert.deepStrictEqual(result[0].content.contentCategories, {});
      assert.strictEqual(result[0].content.averageVideoDuration, 0);
      assert.deepStrictEqual(result[0].content.commonHashtags, []);
      assert.deepStrictEqual(result[0].content.commonSounds, []);
      assert.strictEqual(result[0].strategy.postingPattern.frequency, "unknown");
      assert.deepStrictEqual(result[0].strategy.postingPattern.bestTimes, []);
      assert.strictEqual(result[0].strategy.postingPattern.consistency, 0);
      assert.strictEqual(result[0].strategy.engagement.responseRate, 0);
      assert.strictEqual(result[0].strategy.engagement.responseTime, 0);
      assert.strictEqual(result[0].strategy.engagement.communityEngagement, 0);
      assert.strictEqual(result[0].strategy.growth.followerGrowthRate, 0);
      assert.strictEqual(result[0].strategy.growth.contentGrowthRate, 0);
      assert.strictEqual(result[0].strategy.growth.trendAdoption, 0);
    });

    it("sends correct default period and joins usernames", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getCompetitorAnalysis(["user1", "user2"]);

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.usernames, "user1,user2");
      assert.strictEqual(body.period, "30d");
    });

    it("sends custom period when provided", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getCompetitorAnalysis(["u1"], { period: "7d" });

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.period, "7d");
    });

    it("includes strategy field when includeStrategy is true", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getCompetitorAnalysis(["u1"], { includeStrategy: true });

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.ok(body.fields.includes("strategy"));
    });

    it("excludes strategy field when includeStrategy is absent", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getCompetitorAnalysis(["u1"]);

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.ok(!body.fields.includes("strategy"));
      assert.ok(body.fields.includes("metrics"));
      assert.ok(body.fields.includes("content"));
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { error: { code: "RATE_LIMIT", message: "Too many requests" } },
      });

      await expect(makeClient().getCompetitorAnalysis(["u1"])).rejects.toThrow(
        "TikTok Analytics API error: RATE_LIMIT - Too many requests"
      );
    });

    it("uses POST to competitors/analysis endpoint", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getCompetitorAnalysis(["u1"]);

      const url = vi.mocked(axios.post).mock.calls[0][0];
      assert.ok(url.includes("/competitors/analysis"));
    });
  });

  describe("getHashtagAnalytics", () => {
    it("maps all fields correctly from full API response", async () => {
      const hashtagData = {
        hashtag: "#fyp",
        metrics: {
          total_posts: 1000000,
          total_views: 50000000,
          average_views: 50000,
          engagement_rate: 0.07,
          growth: 15.5,
          difficulty: 0.6,
          trending_score: 92,
        },
        performance: {
          top_videos: [{ videoId: "v1", views: 500000, likes: 50000, authorId: "a1" }],
          average_performance: { views: 40000, likes: 4000, shares: 800, comments: 400 },
        },
        usage: {
          top_creators: [{ creatorId: "cr1", postsCount: 50, totalViews: 2000000 }],
          related_hashtags: [{ hashtag: "#viral", correlation: 0.85 }],
          seasonality: { summer: 0.4 },
          demographics: {
            age: { "18-24": 45 },
            gender: { female: 55 },
            location: { US: 50 },
          },
        },
        insights: {
          best_practices: ["Use in first comment"],
          optimal_timing: [{ hour: 18, day: "friday", performance: 95 }],
          content_recommendations: ["Short-form dance"],
          risk_factors: ["Oversaturation"],
        },
      };
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [hashtagData] } });

      const result = await makeClient().getHashtagAnalytics(["#fyp"], { includeInsights: true });

      assert.strictEqual(result[0].hashtag, "#fyp");
      assert.strictEqual(result[0].metrics.totalPosts, 1000000);
      assert.strictEqual(result[0].metrics.totalViews, 50000000);
      assert.strictEqual(result[0].metrics.averageViews, 50000);
      assert.strictEqual(result[0].metrics.engagementRate, 0.07);
      assert.strictEqual(result[0].metrics.growth, 15.5);
      assert.strictEqual(result[0].metrics.difficulty, 0.6);
      assert.strictEqual(result[0].metrics.trendingScore, 92);
      assert.deepStrictEqual(result[0].performance.topVideos, [
        { videoId: "v1", views: 500000, likes: 50000, authorId: "a1" },
      ]);
      assert.strictEqual(result[0].performance.averagePerformance.views, 40000);
      assert.strictEqual(result[0].performance.averagePerformance.likes, 4000);
      assert.strictEqual(result[0].performance.averagePerformance.shares, 800);
      assert.strictEqual(result[0].performance.averagePerformance.comments, 400);
      assert.deepStrictEqual(result[0].usage.topCreators, [
        { creatorId: "cr1", postsCount: 50, totalViews: 2000000 },
      ]);
      assert.deepStrictEqual(result[0].usage.relatedHashtags, [
        { hashtag: "#viral", correlation: 0.85 },
      ]);
      assert.deepStrictEqual(result[0].usage.seasonality, { summer: 0.4 });
      assert.deepStrictEqual(result[0].usage.demographics.age, { "18-24": 45 });
      assert.deepStrictEqual(result[0].usage.demographics.gender, { female: 55 });
      assert.deepStrictEqual(result[0].usage.demographics.location, { US: 50 });
      assert.deepStrictEqual(result[0].insights.bestPractices, ["Use in first comment"]);
      assert.deepStrictEqual(result[0].insights.optimalTiming, [
        { hour: 18, day: "friday", performance: 95 },
      ]);
      assert.deepStrictEqual(result[0].insights.contentRecommendations, ["Short-form dance"]);
      assert.deepStrictEqual(result[0].insights.riskFactors, ["Oversaturation"]);
    });

    it("applies default values when all nested fields are missing", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { data: [{ hashtag: "#empty" }] },
      });

      const result = await makeClient().getHashtagAnalytics(["#empty"]);

      assert.strictEqual(result[0].metrics.totalPosts, 0);
      assert.strictEqual(result[0].metrics.totalViews, 0);
      assert.strictEqual(result[0].metrics.averageViews, 0);
      assert.strictEqual(result[0].metrics.engagementRate, 0);
      assert.strictEqual(result[0].metrics.growth, 0);
      assert.strictEqual(result[0].metrics.difficulty, 0);
      assert.strictEqual(result[0].metrics.trendingScore, 0);
      assert.deepStrictEqual(result[0].performance.topVideos, []);
      assert.strictEqual(result[0].performance.averagePerformance.views, 0);
      assert.strictEqual(result[0].performance.averagePerformance.likes, 0);
      assert.strictEqual(result[0].performance.averagePerformance.shares, 0);
      assert.strictEqual(result[0].performance.averagePerformance.comments, 0);
      assert.deepStrictEqual(result[0].usage.topCreators, []);
      assert.deepStrictEqual(result[0].usage.relatedHashtags, []);
      assert.deepStrictEqual(result[0].usage.seasonality, {});
      assert.deepStrictEqual(result[0].usage.demographics.age, {});
      assert.deepStrictEqual(result[0].usage.demographics.gender, {});
      assert.deepStrictEqual(result[0].usage.demographics.location, {});
      assert.deepStrictEqual(result[0].insights.bestPractices, []);
      assert.deepStrictEqual(result[0].insights.optimalTiming, []);
      assert.deepStrictEqual(result[0].insights.contentRecommendations, []);
      assert.deepStrictEqual(result[0].insights.riskFactors, []);
    });

    it("sends correct default period and joins hashtags", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getHashtagAnalytics(["#a", "#b"]);

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.hashtags, "#a,#b");
      assert.strictEqual(body.period, "30d");
    });

    it("sends custom period when provided", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getHashtagAnalytics(["#x"], { period: "7d" });

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.strictEqual(body.period, "7d");
    });

    it("includes insights field when includeInsights is true", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getHashtagAnalytics(["#x"], { includeInsights: true });

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.ok(body.fields.includes("insights"));
    });

    it("excludes insights field when includeInsights is absent", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getHashtagAnalytics(["#x"]);

      const body = vi.mocked(axios.post).mock.calls[0][1];
      assert.ok(!body.fields.includes("insights"));
      assert.ok(body.fields.includes("hashtag"));
      assert.ok(body.fields.includes("metrics"));
      assert.ok(body.fields.includes("performance"));
      assert.ok(body.fields.includes("usage"));
    });

    it("throws ProviderError when response contains error", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { error: { code: "INVALID_HASHTAG", message: "Hashtag not found" } },
      });

      await expect(makeClient().getHashtagAnalytics(["#none"])).rejects.toThrow(
        "TikTok Analytics API error: INVALID_HASHTAG - Hashtag not found"
      );
    });

    it("uses POST to hashtags/analytics endpoint", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: { data: [] } });

      await makeClient().getHashtagAnalytics(["#tag"]);

      const url = vi.mocked(axios.post).mock.calls[0][0];
      assert.ok(url.includes("/hashtags/analytics"));
    });

    it("handles partial usage.demographics", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          data: [{ hashtag: "#partial", usage: { demographics: { age: { "25-34": 30 } } } }],
        },
      });

      const result = await makeClient().getHashtagAnalytics(["#partial"]);

      assert.deepStrictEqual(result[0].usage.demographics.age, { "25-34": 30 });
      assert.deepStrictEqual(result[0].usage.demographics.gender, {});
      assert.deepStrictEqual(result[0].usage.demographics.location, {});
    });

    it("handles partial performance.average_performance", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { data: [{ hashtag: "#p", performance: { average_performance: { views: 100 } } }] },
      });

      const result = await makeClient().getHashtagAnalytics(["#p"]);

      assert.strictEqual(result[0].performance.averagePerformance.views, 100);
      assert.strictEqual(result[0].performance.averagePerformance.likes, 0);
      assert.strictEqual(result[0].performance.averagePerformance.shares, 0);
      assert.strictEqual(result[0].performance.averagePerformance.comments, 0);
    });
  });

  describe("getCircuitBreakerStatus", () => {
    it("delegates to circuitBreaker.getAllStatuses", () => {
      const result = makeClient().getCircuitBreakerStatus();
      assert.deepStrictEqual(result, { analytics: "closed" });
      expect(mockGetAllStatuses).toHaveBeenCalledOnce();
    });
  });

  describe("getMetricsRegistry", () => {
    it("returns the global prom-client registry", () => {
      const reg = TikTokContentAnalyticsClient.getMetricsRegistry();
      assert.ok(reg);
    });
  });

  describe("clearCache", () => {
    it("delegates to circuitBreaker.clearCache with correct service name", () => {
      makeClient().clearCache();
      expect(mockClearCache).toHaveBeenCalledWith("tiktok-analytics-api");
    });
  });
});
