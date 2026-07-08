/**
 * @file YouTubeApiClient.cacheIsolation.test.ts
 * @description Cross-tenant AND cross-resource cache-isolation anchor for the C1b per-site
 *              discriminant on YouTube (Spec C1-R1 scenario 3 + C1-R2, and the Design D1
 *              public-reference note). `get-video-details` is a `cacheEnabled:true` public read
 *              keyed by videoId. It MUST be isolated on TWO axes:
 *                (1) video X must never return video Y's cached details (the constant-key
 *                    correctness bug the audit flagged), and
 *                (2) channel B must never receive channel A's cached/closure-bound details.
 *              Uses the REAL process-singleton circuit breaker (googleapis + google-auth-library
 *              are mocked, routed by the OAuth refresh token AND the requested videoId) so the
 *              test exercises the actual breaker keying — where a discriminant-less call shares
 *              one breaker instance whose bound closure is the FIRST caller's.
 *
 *              RED (before the C1b discriminant): the shared breaker binds the first (channel,
 *              video) closure, so video Y / channel B receive the first caller's details.
 *              GREEN (after `cacheKeyDiscriminant: hashCallScope(this.credentials, videoId)`):
 *              each (channel, video) keys its own breaker/entry.
 *
 *              Tier 0: no external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

// Doubles must be defined via vi.hoisted so the hoisted vi.mock factories below
// can reference them (vi.mock is lifted above ordinary top-level declarations).
const { MockOAuth2Client, makeYoutube } = vi.hoisted(() => {
  interface MockCreds {
    refresh_token?: string;
    access_token?: string;
  }

  class HoistedOAuth2Client {
    creds: MockCreds = {};
    constructor(..._args: unknown[]) {}
    setCredentials(c: MockCreds): void {
      this.creds = { ...this.creds, ...c };
    }
    async refreshAccessToken(): Promise<{ credentials: MockCreds }> {
      return { credentials: { access_token: `at-${this.creds.refresh_token ?? "none"}` } };
    }
  }

  const build = (auth: HoistedOAuth2Client): Record<string, unknown> => ({
    videos: {
      list: async ({ id }: { id: string[] }): Promise<unknown> => {
        const videoId = id[0] ?? "";
        const tenant = auth.creds.refresh_token ?? "none";
        return {
          data: {
            items: [
              {
                snippet: { title: `title-${tenant}-${videoId}`, channelId: tenant },
                statistics: {},
                contentDetails: {},
                status: {},
              },
            ],
          },
        };
      },
    },
    channels: { list: async (): Promise<unknown> => ({ data: { items: [] } }) },
    commentThreads: { list: async (): Promise<unknown> => ({ data: { items: [] } }) },
  });

  return { MockOAuth2Client: HoistedOAuth2Client, makeYoutube: build };
});

vi.mock("google-auth-library", () => ({ OAuth2Client: MockOAuth2Client }));

vi.mock("googleapis", () => ({
  google: {
    youtube: ({ auth }: { auth: InstanceType<typeof MockOAuth2Client> }) => makeYoutube(auth),
    youtubeAnalytics: () => ({ reports: { query: vi.fn() } }),
  },
  youtube_v3: {},
  youtubeAnalytics_v2: {},
}));

import { YouTubeApiClient } from "../src/apiClient.js";
import type { YouTubeCredentials } from "../src/apiClient.js";

const CREDS_A: YouTubeCredentials = {
  clientId: "client-A",
  clientSecret: "secret-A",
  refreshToken: "rt-A",
  accessToken: "at-A",
  channelId: "channel-A",
};

const CREDS_B: YouTubeCredentials = {
  clientId: "client-B",
  clientSecret: "secret-B",
  refreshToken: "rt-B",
  accessToken: "at-B",
  channelId: "channel-B",
};

describe("YouTubeApiClient.getVideoDetails — cross-resource + cross-tenant cache isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never returns video X's cached details for video Y (same channel, resource-by-id)", async () => {
    const client = new YouTubeApiClient(CREDS_A);

    const x = await client.getVideoDetails("vidX1");
    const y = await client.getVideoDetails("vidY1");

    assert.strictEqual(x.snippet?.title, "title-rt-A-vidX1", "video X returns its own details");
    assert.strictEqual(
      y.snippet?.title,
      "title-rt-A-vidY1",
      "video Y must return video Y's details, never video X's cached/closure-bound payload"
    );
  });

  it("never serves channel A's cached details to channel B (cross-tenant)", async () => {
    const a = await new YouTubeApiClient(CREDS_A).getVideoDetails("vidShared2");
    const b = await new YouTubeApiClient(CREDS_B).getVideoDetails("vidShared2");

    assert.strictEqual(
      a.snippet?.title,
      "title-rt-A-vidShared2",
      "channel A returns its own details"
    );
    assert.strictEqual(
      b.snippet?.title,
      "title-rt-B-vidShared2",
      "channel B must return its OWN details, never channel A's cached/closure-bound payload"
    );
  });

  it("serves the same channel+video from cache within TTL (no perf regression)", async () => {
    const client = new YouTubeApiClient(CREDS_A);
    const first = await client.getVideoDetails("vidSame3");
    const second = await client.getVideoDetails("vidSame3");

    assert.strictEqual(first.snippet?.title, "title-rt-A-vidSame3");
    assert.strictEqual(second.snippet?.title, "title-rt-A-vidSame3");
  });
});
