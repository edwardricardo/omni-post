/**
 * @file YouTubeUpdateSemantics.test.ts
 * @description Pins what an UPDATE does with a falsy field, which is the one
 *              thing the `||` in those handlers is there for and the one thing
 *              no test covered.
 *
 *              A caller that sends `title: ""` means "I am not setting this",
 *              and the handler must fall through to the value already on the
 *              video. Swapping `||` for `??` — which reads like a modernisation
 *              and typechecks identically — forwards the empty string instead,
 *              and the YouTube Data API answers 400 on an empty required field.
 *              That swap was made and reverted in this package; without an
 *              assertion the next reader has nothing stopping them repeating it.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";

const { MockOAuth2Client, updateCalls, makeYoutube } = vi.hoisted(() => {
  class HoistedOAuth2Client {
    credentials: Record<string, unknown> = {};
    setCredentials(c: Record<string, unknown>): void {
      this.credentials = c;
    }
    async getAccessToken(): Promise<{ token: string }> {
      return { token: "at" };
    }
    // The SUT refreshes before every call, so the double answers it. Leaving it
    // out made all three tests fail on `refreshAccessToken is not a function`
    // and then on "Breaker is open" — the circuit breaker is a process
    // singleton, so the first double's gap poisons every test after it.
    async refreshAccessToken(): Promise<{ credentials: Record<string, unknown> }> {
      return { credentials: { access_token: "at", expiry_date: Date.now() + 3_600_000 } };
    }
  }

  const updateCalls: { last: Record<string, unknown> | null } = { last: null };

  const CURRENT = {
    id: "video-1",
    snippet: {
      title: "the title already there",
      description: "the description already there",
      tags: ["kept"],
      categoryId: "22",
    },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  };

  const build = (): unknown => ({
    videos: {
      list: async (): Promise<unknown> => ({ data: { items: [CURRENT] } }),
      update: async (opts: Record<string, unknown>): Promise<unknown> => {
        updateCalls.last = opts;
        return { data: CURRENT };
      },
    },
    search: { list: async (): Promise<unknown> => ({ data: { items: [] } }) },
    channels: { list: async (): Promise<unknown> => ({ data: { items: [] } }) },
    commentThreads: { list: async (): Promise<unknown> => ({ data: { items: [] } }) },
  });

  return { MockOAuth2Client: HoistedOAuth2Client, updateCalls, makeYoutube: build };
});

vi.mock("google-auth-library", () => ({ OAuth2Client: MockOAuth2Client }));
vi.mock("@googleapis/youtube", () => ({ youtube: () => makeYoutube(), youtube_v3: {} }));
vi.mock("@googleapis/youtubeanalytics", () => ({
  youtubeAnalytics: () => ({ reports: { query: vi.fn() } }),
  youtubeAnalytics_v2: {},
}));

import { YouTubeApiClient } from "../src/apiClient.js";
import type { YouTubeCredentials } from "../src/apiClient.js";

const CREDS: YouTubeCredentials = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "rt",
  accessToken: "at",
  channelId: "channel-1",
};

const sentSnippet = (): Record<string, unknown> => {
  const body = (updateCalls.last?.requestBody ?? {}) as Record<string, unknown>;
  return (body.snippet ?? {}) as Record<string, unknown>;
};

describe("updateVideo — what a falsy field means", () => {
  let client: YouTubeApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.last = null;
    client = new YouTubeApiClient(CREDS);
  });

  it("keeps the current title when the caller sends an empty string", async () => {
    await client.updateVideo("video-1", { title: "" });

    expect(sentSnippet().title).toBe("the title already there");
  });

  it("forwards an empty tags array, because [] is truthy and always was", async () => {
    // Written expecting the fallback to catch this, and it does not: `[]` is
    // TRUTHY in JavaScript, so `||` never protected an empty array and neither
    // would `??`. The review that prompted these tests named "empty string,
    // empty array" together; only the string is falsy. Pinned as it behaves,
    // not as it was assumed to: an explicit empty array reads as "clear the
    // tags", which is a legitimate thing for a caller to ask for.
    await client.updateVideo("video-1", { tags: [] });

    expect(sentSnippet().tags).toEqual([]);
  });

  it("sends a non-empty value the caller did provide", async () => {
    await client.updateVideo("video-1", { title: "a real new title" });

    expect(sentSnippet().title).toBe("a real new title");
  });
});
