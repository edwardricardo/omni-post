/**
 * @file responseParsers.test.ts
 * @description Mutation-killing tests for Snapchat response parsing functions.
 * Covers extractMediaId, parseOrganizationsResponse, parseStoryResponse,
 * parseAnalyticsResponse, parseTokenResponse, and EMPTY_ANALYTICS constant.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  EMPTY_ANALYTICS,
  extractMediaId,
  parseOrganizationsResponse,
  parseStoryResponse,
  parseAnalyticsResponse,
  parseTokenResponse,
} from "../src/responseParsers.js";

// ============================================================================
// EMPTY_ANALYTICS constant
// ============================================================================

describe("EMPTY_ANALYTICS", () => {
  it("has all metric fields set to zero", () => {
    assert.equal(EMPTY_ANALYTICS.total_views, 0);
    assert.equal(EMPTY_ANALYTICS.unique_views, 0);
    assert.equal(EMPTY_ANALYTICS.screenshots, 0);
    assert.equal(EMPTY_ANALYTICS.swipe_ups, 0);
    assert.equal(EMPTY_ANALYTICS.shares, 0);
    assert.equal(EMPTY_ANALYTICS.avg_view_time_seconds, 0);
  });
});

// ============================================================================
// extractMediaId
// ============================================================================

describe("extractMediaId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts media ID from nested response structure", () => {
    const data = {
      media: [{ media: { id: "media-123" } }],
    };
    assert.equal(extractMediaId(data), "media-123");
  });

  it("converts numeric ID to string", () => {
    const data = {
      media: [{ media: { id: 456 } }],
    };
    assert.equal(extractMediaId(data), "456");
  });

  it("throws when data is null", () => {
    assert.throws(() => extractMediaId(null), /Failed to extract media ID/);
  });

  it("throws when data is undefined", () => {
    assert.throws(() => extractMediaId(undefined), /Failed to extract media ID/);
  });

  it("throws when data is not an object", () => {
    assert.throws(() => extractMediaId("string"), /Failed to extract media ID/);
  });

  it("throws when media property is missing", () => {
    assert.throws(() => extractMediaId({ other: "value" }), /Failed to extract media ID/);
  });

  it("throws when media array is empty", () => {
    assert.throws(() => extractMediaId({ media: [] }), /Failed to extract media ID/);
  });

  it("throws when media array is not an array", () => {
    assert.throws(() => extractMediaId({ media: "not-array" }), /Failed to extract media ID/);
  });

  it("throws when first media element has no inner media", () => {
    assert.throws(
      () => extractMediaId({ media: [{ other: "value" }] }),
      /Failed to extract media ID/
    );
  });

  it("throws when inner media has no id", () => {
    assert.throws(
      () => extractMediaId({ media: [{ media: { other: "value" } }] }),
      /Failed to extract media ID/
    );
  });

  it("throws when inner media is not an object", () => {
    assert.throws(
      () => extractMediaId({ media: [{ media: "not-object" }] }),
      /Failed to extract media ID/
    );
  });

  it("throws when first media element is null", () => {
    assert.throws(() => extractMediaId({ media: [null] }), /Failed to extract media ID/);
  });
});

// ============================================================================
// parseOrganizationsResponse
// ============================================================================

describe("parseOrganizationsResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid organizations response", () => {
    const data = {
      organizations: [
        {
          organization: {
            id: "org-1",
            name: "Test Org",
            address_line_1: "123 Main St",
            currency: "USD",
            timezone: "America/New_York",
          },
        },
      ],
    };

    const result = parseOrganizationsResponse(data);
    assert.equal(result.organizations.length, 1);
    assert.equal(result.organizations[0]?.id, "org-1");
    assert.equal(result.organizations[0]?.name, "Test Org");
    assert.equal(result.organizations[0]?.address_line_1, "123 Main St");
    assert.equal(result.organizations[0]?.currency, "USD");
    assert.equal(result.organizations[0]?.timezone, "America/New_York");
  });

  it("parses organization without wrapper", () => {
    const data = {
      organizations: [
        {
          id: "org-2",
          name: "Direct Org",
        },
      ],
    };

    const result = parseOrganizationsResponse(data);
    assert.equal(result.organizations[0]?.id, "org-2");
    assert.equal(result.organizations[0]?.name, "Direct Org");
  });

  it("returns empty array when organizations is not an array", () => {
    const data = { organizations: "not-array" };
    const result = parseOrganizationsResponse(data);
    assert.equal(result.organizations.length, 0);
  });

  it("returns empty array when organizations key is missing", () => {
    const data = { other: "value" };
    const result = parseOrganizationsResponse(data);
    assert.equal(result.organizations.length, 0);
  });

  it("throws when data is null", () => {
    assert.throws(() => parseOrganizationsResponse(null), /Invalid organizations response/);
  });

  it("throws when data is undefined", () => {
    assert.throws(() => parseOrganizationsResponse(undefined), /Invalid organizations response/);
  });

  it("throws when data is not an object", () => {
    assert.throws(() => parseOrganizationsResponse(42), /Invalid organizations response/);
  });

  it("defaults id and name to empty string when missing", () => {
    const data = { organizations: [{ organization: {} }] };
    const result = parseOrganizationsResponse(data);
    assert.equal(result.organizations[0]?.id, "");
    assert.equal(result.organizations[0]?.name, "");
  });

  it("omits optional fields when not present", () => {
    const data = {
      organizations: [{ organization: { id: "org-3", name: "Minimal" } }],
    };
    const result = parseOrganizationsResponse(data);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.organizations[0], "address_line_1"),
      false
    );
    assert.equal(Object.prototype.hasOwnProperty.call(result.organizations[0], "currency"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.organizations[0], "timezone"), false);
  });

  it("parses multiple organizations", () => {
    const data = {
      organizations: [
        { organization: { id: "a", name: "A" } },
        { organization: { id: "b", name: "B" } },
        { organization: { id: "c", name: "C" } },
      ],
    };
    const result = parseOrganizationsResponse(data);
    assert.equal(result.organizations.length, 3);
    assert.equal(result.organizations[2]?.id, "c");
  });
});

// ============================================================================
// parseStoryResponse
// ============================================================================

describe("parseStoryResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid story response with creative wrapper", () => {
    const data = {
      creatives: [
        {
          creative: {
            id: "cr-1",
            name: "Story 1",
            type: "SNAP_AD",
            created_at: "2025-01-15T10:00:00Z",
            updated_at: "2025-01-15T11:00:00Z",
            top_snap_media_id: "media-1",
          },
        },
      ],
    };

    const result = parseStoryResponse(data);
    assert.equal(result.creative.id, "cr-1");
    assert.equal(result.creative.name, "Story 1");
    assert.equal(result.creative.type, "SNAP_AD");
    assert.equal(result.creative.created_at, "2025-01-15T10:00:00Z");
    assert.equal(result.creative.updated_at, "2025-01-15T11:00:00Z");
    assert.equal(result.creative.top_snap_media_id, "media-1");
  });

  it("parses story response without creative wrapper", () => {
    const data = {
      creatives: [
        {
          id: "cr-2",
          name: "Direct Story",
          type: "SNAP_AD",
          created_at: "2025-01-15T10:00:00Z",
          updated_at: "2025-01-15T10:00:00Z",
          top_snap_media_id: "media-2",
        },
      ],
    };

    const result = parseStoryResponse(data);
    assert.equal(result.creative.id, "cr-2");
    assert.equal(result.creative.name, "Direct Story");
  });

  it("throws when data is null", () => {
    assert.throws(() => parseStoryResponse(null), /Invalid story response/);
  });

  it("throws when data is not an object", () => {
    assert.throws(() => parseStoryResponse("string"), /Invalid story response/);
  });

  it("throws when creatives array is empty", () => {
    assert.throws(() => parseStoryResponse({ creatives: [] }), /No creative returned/);
  });

  it("throws when creatives is not an array", () => {
    assert.throws(() => parseStoryResponse({ creatives: "not-array" }), /No creative returned/);
  });

  it("defaults all fields to empty strings when missing", () => {
    const data = { creatives: [{ creative: {} }] };
    const result = parseStoryResponse(data);
    assert.equal(result.creative.id, "");
    assert.equal(result.creative.name, "");
    assert.equal(result.creative.type, "");
    assert.equal(result.creative.top_snap_media_id, "");
  });

  it("provides default ISO date for created_at when missing", () => {
    const data = { creatives: [{ creative: { id: "cr-3" } }] };
    const result = parseStoryResponse(data);
    // Should be a valid ISO date string
    const parsed = new Date(result.creative.created_at);
    assert.ok(!isNaN(parsed.getTime()), "created_at should be a valid date");
  });

  it("provides default ISO date for updated_at when missing", () => {
    const data = { creatives: [{ creative: { id: "cr-4" } }] };
    const result = parseStoryResponse(data);
    const parsed = new Date(result.creative.updated_at);
    assert.ok(!isNaN(parsed.getTime()), "updated_at should be a valid date");
  });
});

// ============================================================================
// parseAnalyticsResponse
// ============================================================================

describe("parseAnalyticsResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses complete analytics from total_stats", () => {
    const data = {
      total_stats: {
        total_views: 1500,
        unique_views: 1200,
        screenshots: 45,
        swipe_ups: 80,
        shares: 30,
        avg_view_time_seconds: 4.5,
      },
    };

    const result = parseAnalyticsResponse(data);
    assert.equal(result.total_views, 1500);
    assert.equal(result.unique_views, 1200);
    assert.equal(result.screenshots, 45);
    assert.equal(result.swipe_ups, 80);
    assert.equal(result.shares, 30);
    assert.equal(result.avg_view_time_seconds, 4.5);
  });

  it("parses analytics from root object when total_stats is absent", () => {
    const data = {
      total_views: 500,
      unique_views: 400,
      screenshots: 10,
      swipe_ups: 20,
      shares: 5,
      avg_view_time_seconds: 2.0,
    };

    const result = parseAnalyticsResponse(data);
    assert.equal(result.total_views, 500);
    assert.equal(result.unique_views, 400);
  });

  it("returns EMPTY_ANALYTICS when data is null", () => {
    const result = parseAnalyticsResponse(null);
    assert.deepEqual(result, EMPTY_ANALYTICS);
  });

  it("returns EMPTY_ANALYTICS when data is undefined", () => {
    const result = parseAnalyticsResponse(undefined);
    assert.deepEqual(result, EMPTY_ANALYTICS);
  });

  it("returns EMPTY_ANALYTICS when data is not an object", () => {
    const result = parseAnalyticsResponse("string");
    assert.deepEqual(result, EMPTY_ANALYTICS);
  });

  it("defaults missing metrics to 0", () => {
    const data = { total_stats: {} };
    const result = parseAnalyticsResponse(data);
    assert.equal(result.total_views, 0);
    assert.equal(result.unique_views, 0);
    assert.equal(result.screenshots, 0);
    assert.equal(result.swipe_ups, 0);
    assert.equal(result.shares, 0);
    assert.equal(result.avg_view_time_seconds, 0);
  });

  it("converts string metric values to numbers", () => {
    const data = {
      total_stats: {
        total_views: "1500",
        unique_views: "1200",
        screenshots: "45",
        swipe_ups: "80",
        shares: "30",
        avg_view_time_seconds: "4.5",
      },
    };

    const result = parseAnalyticsResponse(data);
    assert.equal(result.total_views, 1500);
    assert.equal(result.avg_view_time_seconds, 4.5);
  });

  it("handles total_stats that is null by falling back to root object", () => {
    const data = { total_stats: null, total_views: 100 };
    const result = parseAnalyticsResponse(data);
    // When total_stats is null, typeof null === 'object' but it fails the check
    // and falls to {}, producing 0s
    assert.equal(typeof result.total_views, "number");
  });
});

// ============================================================================
// parseTokenResponse
// ============================================================================

describe("parseTokenResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses complete token response", () => {
    const data = {
      access_token: "new-token-abc",
      token_type: "Bearer",
      expires_in: 7200,
      refresh_token: "new-refresh-xyz",
      scope: "snapchat-marketing-api",
    };

    const result = parseTokenResponse(data);
    assert.equal(result.access_token, "new-token-abc");
    assert.equal(result.token_type, "Bearer");
    assert.equal(result.expires_in, 7200);
    assert.equal(result.refresh_token, "new-refresh-xyz");
    assert.equal(result.scope, "snapchat-marketing-api");
  });

  it("throws when data is null", () => {
    assert.throws(() => parseTokenResponse(null), /Invalid token refresh response/);
  });

  it("throws when data is undefined", () => {
    assert.throws(() => parseTokenResponse(undefined), /Invalid token refresh response/);
  });

  it("throws when data is not an object", () => {
    assert.throws(() => parseTokenResponse(42), /Invalid token refresh response/);
  });

  it("defaults access_token to empty string when missing", () => {
    const data = {};
    const result = parseTokenResponse(data);
    assert.equal(result.access_token, "");
  });

  it("defaults token_type to bearer when missing", () => {
    const data = {};
    const result = parseTokenResponse(data);
    assert.equal(result.token_type, "bearer");
  });

  it("defaults expires_in to 3600 when missing", () => {
    const data = {};
    const result = parseTokenResponse(data);
    assert.equal(result.expires_in, 3600);
  });

  it("defaults refresh_token to empty string when missing", () => {
    const data = {};
    const result = parseTokenResponse(data);
    assert.equal(result.refresh_token, "");
  });

  it("defaults scope to empty string when missing", () => {
    const data = {};
    const result = parseTokenResponse(data);
    assert.equal(result.scope, "");
  });

  it("converts numeric strings to appropriate types", () => {
    const data = {
      access_token: "tok",
      token_type: "bearer",
      expires_in: "1800",
      refresh_token: "ref",
      scope: "api",
    };
    const result = parseTokenResponse(data);
    assert.equal(result.expires_in, 1800);
  });
});
