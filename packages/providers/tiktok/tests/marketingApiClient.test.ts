/**
 * @file marketingApiClient.test.ts
 * @description Mutation-killing tests for TikTokMarketingApiClient.
 *              Covers all 5 API methods + 3 utility methods with full field mapping,
 *              default values, error handling (code !== 0 pattern), and Access-Token header.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available in hoisted vi.mock factories
// ---------------------------------------------------------------------------

const { mockCall, mockGetAllStatuses, mockClearCache } = vi.hoisted(() => ({
  mockCall: vi.fn((_svc: string, _op: string, fn: () => unknown) => fn()),
  mockGetAllStatuses: vi.fn(() => ({ marketing: "closed" })),
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
import { TikTokMarketingApiClient } from "../src/marketingApiClient.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCreds() {
  return {
    clientKey: "ck",
    clientSecret: "cs",
    accessToken: "mkt-token-456",
    openId: "oid",
    advertiserAccountId: "adv-789",
  };
}

function makeClient() {
  return new TikTokMarketingApiClient(makeCreds());
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("TikTokMarketingApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((_svc, _op, fn) => fn());
  });

  describe("getAdAccount", () => {
    it("maps all 9 fields correctly from API response", async () => {
      const advertiser = {
        advertiser_id: "adv-001",
        advertiser_name: "Test Company",
        status: "STATUS_ENABLE",
        balance: 5000.5,
        currency: "EUR",
        timezone: "Europe/Berlin",
        industry: "Technology",
        language: "en",
        create_time: "2024-01-15T00:00:00Z",
      };
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [advertiser] } },
      });

      const result = await makeClient().getAdAccount();

      assert.strictEqual(result.advertiserId, "adv-001");
      assert.strictEqual(result.advertiserName, "Test Company");
      assert.strictEqual(result.status, "STATUS_ENABLE");
      assert.strictEqual(result.balance, 5000.5);
      assert.strictEqual(result.currency, "EUR");
      assert.strictEqual(result.timezone, "Europe/Berlin");
      assert.strictEqual(result.industry, "Technology");
      assert.strictEqual(result.language, "en");
      assert.strictEqual(result.createdTime, "2024-01-15T00:00:00Z");
    });

    it("applies default values for balance and currency", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [
              {
                advertiser_id: "a1",
                advertiser_name: "n",
                status: "s",
                timezone: "t",
                industry: "i",
                language: "l",
                create_time: "c",
              },
            ],
          },
        },
      });

      const result = await makeClient().getAdAccount();

      assert.strictEqual(result.balance, 0);
      assert.strictEqual(result.currency, "USD");
    });

    it("uses Access-Token header instead of Authorization Bearer", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [{ advertiser_id: "a1" }] } },
      });

      await makeClient().getAdAccount();

      const call = vi.mocked(axios.get).mock.calls[0];
      assert.strictEqual(call[1]?.headers?.["Access-Token"], "mkt-token-456");
      assert.strictEqual(call[1]?.headers?.Authorization, undefined);
    });

    it("throws ProviderError when code !== 0", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 40001, message: "Invalid access token" },
      });

      await expect(makeClient().getAdAccount()).rejects.toThrow(
        "TikTok Marketing API error: 40001 - Invalid access token"
      );
    });

    it("does not throw when code is exactly 0", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [{ advertiser_id: "ok" }] } },
      });

      const result = await makeClient().getAdAccount();
      assert.strictEqual(result.advertiserId, "ok");
    });

    it("sends advertiserAccountId in params", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [{ advertiser_id: "a" }] } },
      });

      await makeClient().getAdAccount();

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.advertiser_ids, JSON.stringify(["adv-789"]));
    });
  });

  describe("getCampaigns", () => {
    it("maps all 9 fields correctly from API response", async () => {
      const campaign = {
        campaign_id: "camp-001",
        campaign_name: "Summer Sale",
        objective_type: "CONVERSIONS",
        budget: 10000,
        status: "CAMPAIGN_STATUS_ENABLE",
        start_time: "2024-06-01",
        end_time: "2024-08-31",
        create_time: "2024-05-15",
        modify_time: "2024-05-20",
      };
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [campaign] } },
      });

      const result = await makeClient().getCampaigns();

      assert.strictEqual(result[0].campaignId, "camp-001");
      assert.strictEqual(result[0].campaignName, "Summer Sale");
      assert.strictEqual(result[0].objective, "CONVERSIONS");
      assert.strictEqual(result[0].budget, 10000);
      assert.strictEqual(result[0].status, "CAMPAIGN_STATUS_ENABLE");
      assert.strictEqual(result[0].startTime, "2024-06-01");
      assert.strictEqual(result[0].endTime, "2024-08-31");
      assert.strictEqual(result[0].createdTime, "2024-05-15");
      assert.strictEqual(result[0].modifiedTime, "2024-05-20");
    });

    it("applies default budget to 0 when missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [
              {
                campaign_id: "c1",
                campaign_name: "n",
                objective_type: "o",
                status: "s",
                start_time: "st",
                create_time: "ct",
                modify_time: "mt",
              },
            ],
          },
        },
      });

      const result = await makeClient().getCampaigns();
      assert.strictEqual(result[0].budget, 0);
    });

    it("does not include status or objective filters when not provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getCampaigns();

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.primary_status, undefined);
      assert.strictEqual(params.objective_type, undefined);
    });

    it("includes primary_status filter when status provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getCampaigns({ status: "ACTIVE" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.primary_status, "ACTIVE");
    });

    it("includes objective_type filter when objective provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getCampaigns({ objective: "TRAFFIC" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.objective_type, "TRAFFIC");
    });

    it("includes both filters when both provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getCampaigns({ status: "PAUSED", objective: "REACH" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.primary_status, "PAUSED");
      assert.strictEqual(params.objective_type, "REACH");
    });

    it("throws ProviderError when code !== 0", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 50001, message: "Server error" },
      });

      await expect(makeClient().getCampaigns()).rejects.toThrow(
        "TikTok Marketing API error: 50001 - Server error"
      );
    });

    it("sends advertiser_id and page_size in params", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getCampaigns();

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.advertiser_id, "adv-789");
      assert.strictEqual(params.page_size, 100);
    });
  });

  describe("getAdInsights", () => {
    it("maps all 18 fields with parseInt/parseFloat correctly", async () => {
      const metrics = {
        impressions: "500000",
        clicks: "12000",
        spend: "3500.75",
        conversions: "800",
        conversion_rate: "0.0667",
        cpc: "0.29",
        cpm: "7.00",
        ctr: "0.024",
        reach: "350000",
        frequency: "1.43",
        video_play_actions: "200000",
        video_views_p100: "0.45",
        video_watched_6s: "150000",
        profile_visits: "5000",
        follows: "1200",
        likes: "25000",
        shares: "3000",
        comments: "1500",
      };
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [{ metrics }] } },
      });

      const result = await makeClient().getAdInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result[0].impressions, 500000);
      assert.strictEqual(result[0].clicks, 12000);
      assert.strictEqual(result[0].spend, 3500.75);
      assert.strictEqual(result[0].conversions, 800);
      assert.strictEqual(result[0].conversionRate, 0.0667);
      assert.strictEqual(result[0].cpc, 0.29);
      assert.strictEqual(result[0].cpm, 7);
      assert.strictEqual(result[0].ctr, 0.024);
      assert.strictEqual(result[0].reach, 350000);
      assert.strictEqual(result[0].frequency, 1.43);
      assert.strictEqual(result[0].videoViews, 200000);
      assert.strictEqual(result[0].videoViewRate, 0.45);
      assert.strictEqual(result[0].videoWatchTime, 150000);
      assert.strictEqual(result[0].profileVisits, 5000);
      assert.strictEqual(result[0].follows, 1200);
      assert.strictEqual(result[0].likes, 25000);
      assert.strictEqual(result[0].shares, 3000);
      assert.strictEqual(result[0].comments, 1500);
    });

    it("applies default 0 for all fields when metrics are undefined/NaN", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [{ metrics: {} }] } },
      });

      const result = await makeClient().getAdInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result[0].impressions, 0);
      assert.strictEqual(result[0].clicks, 0);
      assert.strictEqual(result[0].spend, 0);
      assert.strictEqual(result[0].conversions, 0);
      assert.strictEqual(result[0].conversionRate, 0);
      assert.strictEqual(result[0].cpc, 0);
      assert.strictEqual(result[0].cpm, 0);
      assert.strictEqual(result[0].ctr, 0);
      assert.strictEqual(result[0].reach, 0);
      assert.strictEqual(result[0].frequency, 0);
      assert.strictEqual(result[0].videoViews, 0);
      assert.strictEqual(result[0].videoViewRate, 0);
      assert.strictEqual(result[0].videoWatchTime, 0);
      assert.strictEqual(result[0].profileVisits, 0);
      assert.strictEqual(result[0].follows, 0);
      assert.strictEqual(result[0].likes, 0);
      assert.strictEqual(result[0].shares, 0);
      assert.strictEqual(result[0].comments, 0);
    });

    it("does not include filters when campaignIds not provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getAdInsights({ startDate: "2024-01-01", endDate: "2024-01-31" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.filters, undefined);
    });

    it("includes campaign filter when campaignIds provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getAdInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        campaignIds: ["c1", "c2"],
      });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      const filters = JSON.parse(params.filters);
      assert.strictEqual(filters[0].field_name, "campaign_ids");
      assert.strictEqual(filters[0].filter_type, "IN");
      assert.deepStrictEqual(filters[0].filter_value, ["c1", "c2"]);
    });

    it("does not include filters when campaignIds is empty array", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getAdInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        campaignIds: [],
      });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.filters, undefined);
    });

    it("sends date range and default dimensions", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getAdInsights({ startDate: "2024-03-01", endDate: "2024-03-31" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.start_date, "2024-03-01");
      assert.strictEqual(params.end_date, "2024-03-31");
      assert.strictEqual(params.dimensions, JSON.stringify(["campaign_id"]));
      assert.strictEqual(params.page_size, 1000);
    });

    it("uses custom groupBy and metrics when provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getAdInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        groupBy: ["ad_id"],
        metrics: ["impressions", "clicks"],
      });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.dimensions, JSON.stringify(["ad_id"]));
      assert.strictEqual(params.metrics, JSON.stringify(["impressions", "clicks"]));
    });

    it("throws ProviderError when code !== 0", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 40100, message: "Unauthorized" },
      });

      await expect(
        makeClient().getAdInsights({ startDate: "2024-01-01", endDate: "2024-01-31" })
      ).rejects.toThrow("TikTok Marketing API error: 40100 - Unauthorized");
    });
  });

  describe("getAudienceInsights", () => {
    it("initializes default structure with empty arrays and zero values", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.deepStrictEqual(result.gender, { male: 0, female: 0, unknown: 0 });
      assert.deepStrictEqual(result.age, {});
      assert.deepStrictEqual(result.location, []);
      assert.deepStrictEqual(result.interests, []);
      assert.deepStrictEqual(result.devices, []);
      assert.deepStrictEqual(result.platforms, []);
    });

    it("processes gender dimension correctly", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [
              { dimensions: { gender: "male" }, metrics: { impressions: "5000" } },
              { dimensions: { gender: "female" }, metrics: { impressions: "7000" } },
              { dimensions: { gender: "unknown" }, metrics: { impressions: "1000" } },
            ],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result.gender.male, 5000);
      assert.strictEqual(result.gender.female, 7000);
      assert.strictEqual(result.gender.unknown, 1000);
    });

    it("processes age dimension correctly", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [
              { dimensions: { age: "18-24" }, metrics: { impressions: "3000" } },
              { dimensions: { age: "25-34" }, metrics: { impressions: "4500" } },
            ],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result.age["18-24"], 3000);
      assert.strictEqual(result.age["25-34"], 4500);
    });

    it("processes location dimension correctly", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [
              { dimensions: { location: { country: "US" } }, metrics: { impressions: "8000" } },
              { dimensions: { location: { country: "UK" } }, metrics: { impressions: "3000" } },
            ],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result.location.length, 2);
      assert.strictEqual(result.location[0].country, "US");
      assert.strictEqual(result.location[0].percentage, 8000);
      assert.strictEqual(result.location[1].country, "UK");
      assert.strictEqual(result.location[1].percentage, 3000);
    });

    it("skips location entry when location has no country", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [{ dimensions: { location: {} }, metrics: { impressions: "1000" } }],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });
      assert.strictEqual(result.location.length, 0);
    });

    it("processes interest_category dimension correctly", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [{ dimensions: { interest_category: "Tech" }, metrics: { impressions: "6000" } }],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result.interests.length, 1);
      assert.strictEqual(result.interests[0].category, "Tech");
      assert.strictEqual(result.interests[0].affinity, 6000);
    });

    it("processes ac_subtype dimension into devices", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [
              { dimensions: { ac_subtype: "mobile" }, metrics: { impressions: "9000" } },
              { dimensions: { ac_subtype: "desktop" }, metrics: { impressions: "2000" } },
            ],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result.devices.length, 2);
      assert.strictEqual(result.devices[0].deviceType, "mobile");
      assert.strictEqual(result.devices[0].percentage, 9000);
      assert.strictEqual(result.devices[1].deviceType, "desktop");
      assert.strictEqual(result.devices[1].percentage, 2000);
    });

    it("handles impressions as NaN gracefully (defaults to 0)", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [{ dimensions: { gender: "male" }, metrics: { impressions: "not-a-number" } }],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });
      assert.strictEqual(result.gender.male, 0);
    });

    it("includes campaign filter when campaignIds provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        campaignIds: ["c1"],
      });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      const filters = JSON.parse(params.filters);
      assert.strictEqual(filters[0].field_name, "campaign_ids");
    });

    it("does not include filters when campaignIds not provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getAudienceInsights({ startDate: "2024-01-01", endDate: "2024-01-31" });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      assert.strictEqual(params.filters, undefined);
    });

    it("throws ProviderError when code !== 0", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 40003, message: "Permission denied" },
      });

      await expect(
        makeClient().getAudienceInsights({ startDate: "2024-01-01", endDate: "2024-01-31" })
      ).rejects.toThrow("TikTok Marketing API error: 40003 - Permission denied");
    });

    it("processes mixed dimensions in a single response", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [
              { dimensions: { gender: "female" }, metrics: { impressions: "100" } },
              { dimensions: { age: "35-44" }, metrics: { impressions: "200" } },
              { dimensions: { interest_category: "Sports" }, metrics: { impressions: "300" } },
              { dimensions: { ac_subtype: "tablet" }, metrics: { impressions: "400" } },
              { dimensions: { location: { country: "DE" } }, metrics: { impressions: "500" } },
            ],
          },
        },
      });

      const result = await makeClient().getAudienceInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result.gender.female, 100);
      assert.strictEqual(result.age["35-44"], 200);
      assert.strictEqual(result.interests[0].category, "Sports");
      assert.strictEqual(result.interests[0].affinity, 300);
      assert.strictEqual(result.devices[0].deviceType, "tablet");
      assert.strictEqual(result.devices[0].percentage, 400);
      assert.strictEqual(result.location[0].country, "DE");
      assert.strictEqual(result.location[0].percentage, 500);
    });
  });

  describe("getCreativeInsights", () => {
    it("maps all 10 fields correctly from API response", async () => {
      const creative = {
        dimensions: {
          ad_id: "ad-001",
          ad_name: "Summer Ad",
          ad_format: "single_image",
          thumbnail_url: "https://example.com/thumb.jpg",
          video_url: "https://example.com/video.mp4",
        },
        metrics: {
          impressions: "100000",
          clicks: "5000",
          spend: "1200.50",
          ctr: "0.05",
          engagement_rate: "0.08",
          video_views_p100: "0.35",
        },
      };
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [creative] } },
      });

      const result = await makeClient().getCreativeInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result[0].creativeId, "ad-001");
      assert.strictEqual(result[0].creativeName, "Summer Ad");
      assert.strictEqual(result[0].format, "single_image");
      assert.strictEqual(result[0].impressions, 100000);
      assert.strictEqual(result[0].clicks, 5000);
      assert.strictEqual(result[0].spend, 1200.5);
      assert.strictEqual(result[0].ctr, 0.05);
      assert.strictEqual(result[0].engagementRate, 0.08);
      assert.strictEqual(result[0].videoCompletionRate, 0.35);
      assert.strictEqual(result[0].thumbnailUrl, "https://example.com/thumb.jpg");
      assert.strictEqual(result[0].videoUrl, "https://example.com/video.mp4");
    });

    it("uses fallback creative name when ad_name is missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [{ dimensions: { ad_id: "ad-555" }, metrics: {} }],
          },
        },
      });

      const result = await makeClient().getCreativeInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });
      assert.strictEqual(result[0].creativeName, "Creative ad-555");
    });

    it("uses fallback format 'video' when ad_format is missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [{ dimensions: { ad_id: "ad-1" }, metrics: {} }],
          },
        },
      });

      const result = await makeClient().getCreativeInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });
      assert.strictEqual(result[0].format, "video");
    });

    it("applies default 0 for all numeric fields when metrics are missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: {
            list: [{ dimensions: { ad_id: "ad-x" }, metrics: {} }],
          },
        },
      });

      const result = await makeClient().getCreativeInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });

      assert.strictEqual(result[0].impressions, 0);
      assert.strictEqual(result[0].clicks, 0);
      assert.strictEqual(result[0].spend, 0);
      assert.strictEqual(result[0].ctr, 0);
      assert.strictEqual(result[0].engagementRate, 0);
      assert.strictEqual(result[0].videoCompletionRate, 0);
    });

    it("includes campaign filter when campaignIds provided", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 0, data: { list: [] } },
      });

      await makeClient().getCreativeInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        campaignIds: ["c1", "c2"],
      });

      const params = vi.mocked(axios.get).mock.calls[0][1]?.params;
      const filters = JSON.parse(params.filters);
      assert.deepStrictEqual(filters[0].filter_value, ["c1", "c2"]);
    });

    it("throws ProviderError when code !== 0", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { code: 40002, message: "Rate limited" },
      });

      await expect(
        makeClient().getCreativeInsights({ startDate: "2024-01-01", endDate: "2024-01-31" })
      ).rejects.toThrow("TikTok Marketing API error: 40002 - Rate limited");
    });

    it("preserves optional thumbnailUrl and videoUrl as undefined when missing", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          code: 0,
          data: { list: [{ dimensions: { ad_id: "ad-1" }, metrics: {} }] },
        },
      });

      const result = await makeClient().getCreativeInsights({
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      });
      assert.strictEqual(result[0].thumbnailUrl, undefined);
      assert.strictEqual(result[0].videoUrl, undefined);
    });
  });

  describe("getCircuitBreakerStatus", () => {
    it("delegates to circuitBreaker.getAllStatuses", () => {
      const result = makeClient().getCircuitBreakerStatus();
      assert.deepStrictEqual(result, { marketing: "closed" });
      expect(mockGetAllStatuses).toHaveBeenCalledOnce();
    });
  });

  describe("getMetricsRegistry", () => {
    it("returns the global prom-client registry", () => {
      const reg = TikTokMarketingApiClient.getMetricsRegistry();
      assert.ok(reg);
    });
  });

  describe("clearCache", () => {
    it("delegates to circuitBreaker.clearCache with correct service name", () => {
      makeClient().clearCache();
      expect(mockClearCache).toHaveBeenCalledWith("tiktok-marketing-api");
    });
  });
});
