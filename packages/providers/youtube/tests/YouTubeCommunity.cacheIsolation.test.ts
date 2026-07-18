/**
 * @file YouTubeCommunity.cacheIsolation.test.ts
 * @description Regression anchor proving the YouTube COMMUNITY submodule
 *              (`communityFeatures.ts` `get-video-comments`) folds the per-tenant secret
 *              `this.refreshToken` into its `cacheEnabled` discriminant. Two grants differing
 *              ONLY in refreshToken must not collide on one L1 cache key; dropping refreshToken
 *              makes this test RED (the apiClient anchor only covers `getVideoDetails`, keyed
 *              on `this.credentials`). Uses the real process-singleton breaker; googleapis +
 *              google-auth-library mocked, routed by the OAuth refresh token. Tier 0: no
 *              external services needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

// Doubles are defined via vi.hoisted so the hoisted vi.mock factories below can reference
// them (vi.mock is lifted above ordinary top-level declarations).
const { MockOAuth2Client, makeYoutube, commentThreadsListCalls } = vi.hoisted(() => {
  interface MockCreds {
    refresh_token?: string;
    access_token?: string;
  }

  // Shared counter for the underlying `commentThreads.list` network round-trips, so the
  // anchor can prove same-grant repeats hit L1 cache while a distinct-refreshToken grant
  // must miss and fetch its own.
  const commentThreadsListCalls = { count: 0 };

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
    commentThreads: {
      list: async (): Promise<unknown> => {
        commentThreadsListCalls.count++;
        const tenant = auth.creds.refresh_token ?? "none";
        return {
          data: {
            items: [
              {
                id: `ct-${tenant}`,
                snippet: {
                  totalReplyCount: 0,
                  topLevelComment: {
                    snippet: {
                      textDisplay: `comment-${tenant}`,
                      textOriginal: `comment-${tenant}`,
                      authorDisplayName: `author-${tenant}`,
                    },
                  },
                },
              },
            ],
          },
        };
      },
    },
  });

  return {
    MockOAuth2Client: HoistedOAuth2Client,
    makeYoutube: build,
    commentThreadsListCalls,
  };
});

vi.mock("google-auth-library", () => ({ OAuth2Client: MockOAuth2Client }));

vi.mock("googleapis", () => ({
  google: {
    youtube: ({ auth }: { auth: InstanceType<typeof MockOAuth2Client> }) => makeYoutube(auth),
  },
  youtube_v3: {},
}));

import { YouTubeCommunityService } from "../src/communityFeatures.js";

// Two grants that differ ONLY in the SECRET refreshToken. channelId is PUBLIC (and here
// deliberately identical), so the refreshToken segment is the ONLY thing preventing a
// cross-tenant L1 cache collision — exactly the submodule discriminant this test anchors.
const SHARED_CHANNEL = "channel-shared";
const CREDS_A = {
  clientId: "app-client",
  clientSecret: "app-secret",
  refreshToken: "rt-A",
  accessToken: "at-A",
  channelId: SHARED_CHANNEL,
};
const CREDS_B = {
  clientId: "app-client",
  clientSecret: "app-secret",
  refreshToken: "rt-B",
  accessToken: "at-B",
  channelId: SHARED_CHANNEL,
};

describe("YouTubeCommunityService.getVideoComments — submodule refreshToken discriminant anchor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never serves grant A's cached comments to grant B when they differ only by refreshToken", async () => {
    // Fresh videoId + reset counter: the process-singleton breaker's L1 cache persists
    // across tests, so use a videoId no other test read to guarantee the first call misses.
    commentThreadsListCalls.count = 0;
    const videoId = "vidCommunityAnchor1";

    const a1 = await new YouTubeCommunityService(CREDS_A).getVideoComments(videoId);
    // Same grant + video again MUST be an L1 cache hit (network not re-hit) — this proves
    // the discriminant actually keys AND hits the cache, so the count===2 below is a
    // meaningful isolation signal rather than an always-miss artefact.
    const a2 = await new YouTubeCommunityService(CREDS_A).getVideoComments(videoId);

    // Grant B: identical channelId + videoId + params, differing ONLY in refreshToken.
    const b1 = await new YouTubeCommunityService(CREDS_B).getVideoComments(videoId);

    assert.strictEqual(a1[0]?.content, "comment-rt-A", "grant A reads its own comments");
    assert.strictEqual(a2[0]?.content, "comment-rt-A", "grant A repeat read is served from cache");
    assert.strictEqual(
      b1[0]?.content,
      "comment-rt-B",
      "grant B must read its OWN comments, never grant A's cached/closure-bound payload"
    );
    // If `this.refreshToken` were dropped from the submodule discriminant, grants A and B
    // collapse to one cache key: B is served A's cached comments, the network is hit ONCE,
    // and this FAILS.
    assert.strictEqual(
      commentThreadsListCalls.count,
      2,
      "grant A miss + grant B miss = exactly two network reads (refreshToken keeps keys distinct)"
    );
  });
});
