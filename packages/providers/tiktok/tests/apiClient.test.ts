/**
 * @file apiClient.test.ts
 * @description Mutation-killing tests for TikTokApiClient — API methods
 *              (validateCredentials, uploadVideo, getUserVideos, publishPhotoPost,
 *              refreshToken) and circuit breaker utilities.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks
const { mockCbInstance } = vi.hoisted(() => {
  const cb = {
    call: vi.fn(),
    getAllStatuses: vi.fn(() => ({ status: "closed" })),
    clearCache: vi.fn(),
    forceOpen: vi.fn(() => true),
    forceClose: vi.fn(() => true),
  };
  return { mockCbInstance: cb };
});

vi.mock("@adapters/external-apis", () => ({
  createExternalApiCircuitBreaker: vi.fn(() => mockCbInstance),
}));
vi.mock("@adapters/fallback-strategies", () => ({
  CommonFallbackStrategies: { METADATA_FALLBACK: {}, ANALYTICS_FALLBACK: {} },
}));
vi.mock("@providers/shared", () => ({
  ProviderError: {
    externalService: vi.fn((p: string, m: string) => new Error(`${p}: ${m}`)),
    unauthorized: vi.fn((p: string, m: string) => new Error(`${p}: ${m}`)),
    notFound: vi.fn((p: string, m: string) => new Error(`${p}: ${m}`)),
  },
}));
vi.mock("prom-client", () => ({ Registry: class R {} }));
vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn(), put: vi.fn() } }));
vi.mock("@observability/logger", () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock("form-data", () => ({
  default: class MockFormData {
    append() {}
    getHeaders() {
      return { "content-type": "multipart/form-data" };
    }
  },
}));

import { TikTokApiClient } from "../src/apiClient.js";
import axios from "axios";

// Helpers
const makeCreds = () => ({
  clientKey: "ck-test",
  clientSecret: "cs-test",
  accessToken: "at-test-123",
  openId: "oid-test-456",
});

const makeUserResp = (ov: Record<string, unknown> = {}) => ({
  data: {
    data: {
      user: {
        open_id: "oid-test-456",
        union_id: "uid-test-789",
        avatar_url: "https://example.com/avatar.jpg",
        display_name: "Test User",
        follower_count: 1000,
        following_count: 200,
        likes_count: 5000,
        video_count: 50,
        profile_deep_link: "https://tiktok.com/@testuser",
        ...ov,
      },
    },
  },
});

/** Setup all 4 steps of the upload flow */
function setupUpload(opts?: { publishId?: string; uploadUrl?: string }) {
  vi.mocked(axios.post).mockResolvedValueOnce({
    data: {
      data: {
        publish_id: opts?.publishId ?? "p1",
        upload_url: opts?.uploadUrl ?? "https://cdn.tiktok.com/u",
      },
    },
  });
  vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: Buffer.from("x") });
  vi.mocked(axios.put).mockResolvedValueOnce({ status: 200 });
  vi.mocked(axios.post).mockResolvedValueOnce({
    data: { data: { share_id: "s1", share_url: "", unique_id: "" } },
  });
}

const makeVideoListResp = (ov: Record<string, unknown> = {}) => ({
  data: {
    data: {
      videos: [
        {
          id: "vid-1",
          title: "Cool Video",
          video_description: "A desc",
          embed_link: "https://tiktok.com/embed/1",
          cover_image_url: "https://img.com/c1.jpg",
          share_url: "https://tiktok.com/share/1",
          create_time: 1700000000,
          like_count: 100,
          comment_count: 20,
          share_count: 10,
          view_count: 5000,
        },
      ],
      cursor: 20,
      has_more: true,
      ...ov,
    },
  },
});

describe("TikTokApiClient", () => {
  let client: TikTokApiClient;
  beforeEach(() => {
    vi.clearAllMocks();
    mockCbInstance.call.mockImplementation((_s: string, _o: string, fn: () => unknown) => fn());
    mockCbInstance.getAllStatuses.mockReturnValue({ status: "closed" });
    mockCbInstance.forceOpen.mockReturnValue(true);
    mockCbInstance.forceClose.mockReturnValue(true);
    client = new TikTokApiClient(makeCreds());
  });

  // validateCredentials
  describe("validateCredentials", () => {
    it("returns fully mapped user info on success", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp());
      expect(await client.validateCredentials()).toEqual({
        openId: "oid-test-456",
        unionId: "uid-test-789",
        avatarUrl: "https://example.com/avatar.jpg",
        displayName: "Test User",
        followerCount: 1000,
        followingCount: 200,
        likesCount: 5000,
        videoCount: 50,
        profileDeepLink: "https://tiktok.com/@testuser",
      });
    });
    it("sends correct URL, body, and headers", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp());
      await client.validateCredentials();
      expect(axios.post).toHaveBeenCalledWith(
        "https://open.tiktokapis.com/v2/user/info/",
        expect.objectContaining({
          open_id: "oid-test-456",
          fields: expect.arrayContaining([
            "open_id",
            "display_name",
            "follower_count",
            "union_id",
            "avatar_url",
            "following_count",
            "likes_count",
            "video_count",
            "profile_deep_link",
          ]),
        }),
        expect.objectContaining({
          headers: { Authorization: "Bearer at-test-123", "Content-Type": "application/json" },
        })
      );
    });
    it("defaults followerCount to 0 when falsy", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp({ follower_count: 0 }));
      expect((await client.validateCredentials()).followerCount).toBe(0);
    });
    it("defaults followingCount to 0 when null", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp({ following_count: null }));
      expect((await client.validateCredentials()).followingCount).toBe(0);
    });
    it("defaults likesCount to 0 when undefined", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp({ likes_count: undefined }));
      expect((await client.validateCredentials()).likesCount).toBe(0);
    });
    it("defaults videoCount to 0 when null", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp({ video_count: null }));
      expect((await client.validateCredentials()).videoCount).toBe(0);
    });
    it("throws on API error response", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { error: { code: "invalid_token", message: "Token expired" } },
      });
      await expect(client.validateCredentials()).rejects.toThrow(
        "TikTok API error: invalid_token - Token expired"
      );
    });
    it("passes correct circuit breaker options", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp());
      await client.validateCredentials();
      expect(mockCbInstance.call).toHaveBeenCalledWith(
        "tiktok-api",
        "validate-credentials",
        expect.any(Function),
        [],
        expect.objectContaining({
          timeout: 15000,
          errorThresholdPercentage: 60,
          resetTimeout: 60000,
          maxRetries: 3,
          baseDelay: 2000,
          maxDelay: 30000,
          jitterEnabled: true,
          cacheEnabled: true,
          cacheTtl: 300000,
          fallbackEnabled: true,
        })
      );
    });
  });

  // getUserInfo
  describe("getUserInfo", () => {
    it("delegates to validateCredentials", async () => {
      vi.mocked(axios.post).mockResolvedValue(makeUserResp());
      const r = await client.getUserInfo();
      expect(r.openId).toBe("oid-test-456");
      expect(r.displayName).toBe("Test User");
    });
  });

  // uploadVideo
  describe("uploadVideo", () => {
    const makeReq = () => ({
      description: "My cool TikTok video about something",
      videoUrl: "https://storage.example.com/video.mp4",
      privacy: "public" as const,
      disableDuet: true,
      disableComment: false,
      disableStitch: true,
    });

    it("completes 4-step upload and returns mapped response", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { data: { publish_id: "pub-123", upload_url: "https://cdn.tiktok.com/xyz" } },
      });
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: Buffer.from("v") });
      vi.mocked(axios.put).mockResolvedValueOnce({ status: 200 });
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          data: {
            share_id: "share-abc",
            share_url: "https://tiktok.com/@u/v/1",
            unique_id: "unique-xyz",
          },
        },
      });
      expect(await client.uploadVideo(makeReq())).toEqual({
        shareId: "share-abc",
        shareUrl: "https://tiktok.com/@u/v/1",
        uniqueId: "unique-xyz",
      });
    });
    it("truncates description to 150 chars for title", async () => {
      setupUpload();
      await client.uploadVideo({ ...makeReq(), description: "A".repeat(200) });
      const pi = (vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>)
        .post_info as Record<string, unknown>;
      expect((pi.title as string).length).toBe(150);
    });
    it("defaults disableDuet/Comment/Stitch to false when not set", async () => {
      setupUpload();
      await client.uploadVideo({
        description: "test",
        videoUrl: "https://ex.com/v.mp4",
        privacy: "public",
      });
      const pi = (vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>)
        .post_info as Record<string, unknown>;
      expect(pi.disable_duet).toBe(false);
      expect(pi.disable_comment).toBe(false);
      expect(pi.disable_stitch).toBe(false);
    });
    it("sets privacy to uppercase and video_cover_timestamp_ms to 1000", async () => {
      setupUpload();
      await client.uploadVideo(makeReq());
      const pi = (vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>)
        .post_info as Record<string, unknown>;
      expect(pi.privacy_level).toBe("PUBLIC");
      expect(pi.video_cover_timestamp_ms).toBe(1000);
    });
    it("sends source_info with FILE_UPLOAD, 10MB chunks", async () => {
      setupUpload();
      await client.uploadVideo(makeReq());
      const si = (vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>)
        .source_info as Record<string, unknown>;
      expect(si).toEqual({
        source: "FILE_UPLOAD",
        video_size: 0,
        chunk_size: 10485760,
        total_chunk_count: 1,
      });
    });
    it("throws on init step error", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { error: { code: "spam", message: "Spam" } },
      });
      await expect(client.uploadVideo(makeReq())).rejects.toThrow("TikTok init error: spam - Spam");
    });
    it("throws when video fetch returns non-200", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { data: { publish_id: "p1", upload_url: "https://cdn.tiktok.com/u" } },
      });
      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 404,
        statusText: "Not Found",
        data: null,
      });
      await expect(client.uploadVideo(makeReq())).rejects.toThrow(
        "Failed to fetch video: 404 Not Found"
      );
    });
    it("throws when CDN upload returns non-200", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { data: { publish_id: "p1", upload_url: "https://cdn.tiktok.com/u" } },
      });
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: Buffer.from("x") });
      vi.mocked(axios.put).mockResolvedValueOnce({ status: 500 });
      await expect(client.uploadVideo(makeReq())).rejects.toThrow("Video upload failed: 500");
    });
    it("throws on publish step error", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { data: { publish_id: "p1", upload_url: "https://cdn.tiktok.com/u" } },
      });
      vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: Buffer.from("x") });
      vi.mocked(axios.put).mockResolvedValueOnce({ status: 200 });
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { error: { code: "fail", message: "Cannot publish" } },
      });
      await expect(client.uploadVideo(makeReq())).rejects.toThrow(
        "TikTok publish error: fail - Cannot publish"
      );
    });
    it("passes correct CB options for upload", async () => {
      setupUpload();
      await client.uploadVideo(makeReq());
      expect(mockCbInstance.call).toHaveBeenCalledWith(
        "tiktok-api",
        "upload-video",
        expect.any(Function),
        [],
        expect.objectContaining({
          timeout: 360000,
          errorThresholdPercentage: 70,
          resetTimeout: 120000,
          maxRetries: 2,
          baseDelay: 5000,
          maxDelay: 30000,
          jitterEnabled: true,
          cacheEnabled: false,
          fallbackEnabled: false,
        })
      );
    });
    it("uses upload URL from init for PUT and sends publish_id in publish step", async () => {
      const url = "https://cdn.tiktok.com/upload/abc";
      setupUpload({ publishId: "pub-999", uploadUrl: url });
      await client.uploadVideo(makeReq());
      expect(axios.put).toHaveBeenCalledWith(
        url,
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ "Content-Type": "video/mp4" }),
          timeout: 300000,
        })
      );
      expect((vi.mocked(axios.post).mock.calls[1]?.[1] as Record<string, unknown>).post_id).toBe(
        "pub-999"
      );
    });
    it("fetches video with stream responseType and 60s timeout", async () => {
      setupUpload();
      await client.uploadVideo(makeReq());
      expect(axios.get).toHaveBeenCalledWith("https://storage.example.com/video.mp4", {
        responseType: "stream",
        timeout: 60000,
      });
    });
    it("sends Authorization header in init and publish steps", async () => {
      setupUpload();
      await client.uploadVideo(makeReq());
      for (const idx of [0, 1]) {
        const h = (vi.mocked(axios.post).mock.calls[idx]?.[2] as Record<string, unknown>)
          .headers as Record<string, string>;
        expect(h.Authorization).toBe("Bearer at-test-123");
        expect(h["Content-Type"]).toBe("application/json");
      }
    });
  });

  // getUserVideos
  describe("getUserVideos", () => {
    it("returns mapped video list", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeVideoListResp());
      const r = await client.getUserVideos();
      expect(r.videos).toHaveLength(1);
      expect(r.videos[0]).toEqual({
        id: "vid-1",
        title: "Cool Video",
        videoUrl: "https://tiktok.com/embed/1",
        coverImageUrl: "https://img.com/c1.jpg",
        shareUrl: "https://tiktok.com/share/1",
        createTime: 1700000000,
        likeCount: 100,
        commentCount: 20,
        shareCount: 10,
        viewCount: 5000,
      });
      expect(r.cursor).toBe(20);
      expect(r.hasMore).toBe(true);
    });
    it("falls back title to video_description when title is falsy", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(
        makeVideoListResp({
          videos: [
            {
              id: "v",
              title: "",
              video_description: "Fallback",
              embed_link: "",
              cover_image_url: "",
              share_url: "",
              create_time: 0,
              like_count: 0,
              comment_count: 0,
              share_count: 0,
              view_count: 0,
            },
          ],
        })
      );
      expect((await client.getUserVideos()).videos[0]?.title).toBe("Fallback");
    });
    it("uses empty string when both title and description are falsy", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(
        makeVideoListResp({
          videos: [
            {
              id: "v",
              title: "",
              video_description: "",
              embed_link: "",
              cover_image_url: "",
              share_url: "",
              create_time: 0,
              like_count: 0,
              comment_count: 0,
              share_count: 0,
              view_count: 0,
            },
          ],
        })
      );
      expect((await client.getUserVideos()).videos[0]?.title).toBe("");
    });
    it("defaults all count fields and videoUrl to 0/empty when falsy", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(
        makeVideoListResp({
          videos: [
            {
              id: "v",
              title: "T",
              video_description: "",
              cover_image_url: "",
              share_url: "",
              create_time: 0,
              like_count: null,
              comment_count: null,
              share_count: null,
              view_count: null,
            },
          ],
        })
      );
      const v = (await client.getUserVideos()).videos[0];
      expect(v?.likeCount).toBe(0);
      expect(v?.commentCount).toBe(0);
      expect(v?.shareCount).toBe(0);
      expect(v?.viewCount).toBe(0);
      expect(v?.videoUrl).toBe("");
    });
    it("defaults cursor to 0 and hasMore to false when falsy", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeVideoListResp({ cursor: 0, has_more: null }));
      const r = await client.getUserVideos();
      expect(r.cursor).toBe(0);
      expect(r.hasMore).toBe(false);
    });
    it("returns empty videos when videos is undefined", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { data: { cursor: 0, has_more: false } },
      });
      expect((await client.getUserVideos()).videos).toEqual([]);
    });
    it("passes default cursor 0 and caps maxCount at 20", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeVideoListResp());
      await client.getUserVideos(0, 50);
      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body.cursor).toBe(0);
      expect(body.max_count).toBe(20);
    });
    it("passes custom cursor and maxCount values", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeVideoListResp());
      await client.getUserVideos(100, 10);
      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body.cursor).toBe(100);
      expect(body.max_count).toBe(10);
    });
    it("sends all expected fields in request body", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeVideoListResp());
      await client.getUserVideos();
      const fields = (vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>)
        .fields as string[];
      for (const f of [
        "id",
        "title",
        "video_description",
        "duration",
        "cover_image_url",
        "share_url",
        "create_time",
        "like_count",
        "comment_count",
        "share_count",
        "view_count",
      ])
        expect(fields).toContain(f);
    });
    it("throws on error response", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { error: { code: "rate_limit", message: "Too many" } },
      });
      await expect(client.getUserVideos()).rejects.toThrow(
        "TikTok video list error: rate_limit - Too many"
      );
    });
    it("passes correct CB options with fallback", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(makeVideoListResp());
      await client.getUserVideos();
      expect(mockCbInstance.call).toHaveBeenCalledWith(
        "tiktok-api",
        "get-user-videos",
        expect.any(Function),
        [],
        expect.objectContaining({
          timeout: 15000,
          errorThresholdPercentage: 60,
          maxRetries: 3,
          cacheEnabled: true,
          cacheTtl: 300000,
          fallbackEnabled: true,
          fallback: expect.any(Function),
        })
      );
    });
  });

  // publishPhotoPost
  describe("publishPhotoPost", () => {
    const makeParams = () => ({
      description: "Check photos",
      imageUrls: ["https://img.com/1.jpg", "https://img.com/2.jpg"],
      privacy: "PUBLIC_TO_EVERYONE" as const,
      disableComment: true,
    });

    it("returns mapped response on success", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { data: { publish_id: "photo-123" } } });
      expect(await client.publishPhotoPost(makeParams())).toEqual({
        shareId: "photo-123",
        shareUrl: "",
        uniqueId: "photo-123",
      });
    });
    it("sends correct payload to content init endpoint", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { data: { publish_id: "p1" } } });
      await client.publishPhotoPost(makeParams());
      expect(axios.post).toHaveBeenCalledWith(
        "https://open.tiktokapis.com/v2/post/publish/content/init/",
        expect.objectContaining({
          post_info: expect.objectContaining({
            title: "Check photos",
            description: "Check photos",
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_comment: true,
          }),
          source_info: expect.objectContaining({
            source: "PULL_FROM_URL",
            photo_cover_index: 0,
            photo_images: ["https://img.com/1.jpg", "https://img.com/2.jpg"],
          }),
          media_type: "PHOTO",
        }),
        expect.any(Object)
      );
    });
    it("truncates description to 150 chars for title, keeps full description", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { data: { publish_id: "p1" } } });
      const desc = "B".repeat(200);
      await client.publishPhotoPost({ ...makeParams(), description: desc });
      const pi = (vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>)
        .post_info as Record<string, unknown>;
      expect((pi.title as string).length).toBe(150);
      expect(pi.description).toBe(desc);
    });
    it("defaults disableComment to false when not provided", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { data: { publish_id: "p1" } } });
      await client.publishPhotoPost({
        description: "t",
        imageUrls: ["https://i.com/1.jpg"],
        privacy: "SELF_ONLY",
      });
      expect(
        (
          (vi.mocked(axios.post).mock.calls[0]?.[1] as Record<string, unknown>).post_info as Record<
            string,
            unknown
          >
        ).disable_comment
      ).toBe(false);
    });
    it("throws on error response", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { error: { code: "bad", message: "Bad" } },
      });
      await expect(client.publishPhotoPost(makeParams())).rejects.toThrow(
        "TikTok photo post error: bad - Bad"
      );
    });
    it("passes correct CB options", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { data: { publish_id: "p1" } } });
      await client.publishPhotoPost(makeParams());
      expect(mockCbInstance.call).toHaveBeenCalledWith(
        "tiktok-api",
        "publish-photo-post",
        expect.any(Function),
        [],
        expect.objectContaining({
          timeout: 60000,
          errorThresholdPercentage: 70,
          resetTimeout: 120000,
          maxRetries: 2,
          baseDelay: 3000,
          cacheEnabled: false,
          fallbackEnabled: false,
        })
      );
    });
  });

  // refreshToken
  describe("refreshToken", () => {
    it("returns new token and sends correct OAuth payload", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { data: { access_token: "new-at-999" } },
      });
      expect(await client.refreshToken()).toBe("new-at-999");
      expect(axios.post).toHaveBeenCalledWith("https://open.tiktokapis.com/v2/oauth/token/", {
        client_key: "ck-test",
        client_secret: "cs-test",
        grant_type: "refresh_token",
        refresh_token: "at-test-123",
      });
    });
    it("throws unauthorized error on error response", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { error: { code: "invalid_grant", message: "Expired" } },
      });
      await expect(client.refreshToken()).rejects.toThrow(
        "TikTok token refresh error: invalid_grant - Expired"
      );
    });
    it("does not use circuit breaker", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { data: { access_token: "new" } } });
      await client.refreshToken();
      expect(
        mockCbInstance.call.mock.calls.filter((c: unknown[]) => c[1] === "refresh-token")
      ).toHaveLength(0);
    });
    it("updates credentials for subsequent calls", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { data: { access_token: "refreshed-xyz" } },
      });
      await client.refreshToken();
      vi.mocked(axios.post).mockResolvedValueOnce(makeUserResp());
      await client.validateCredentials();
      expect(
        (
          (vi.mocked(axios.post).mock.calls[1]?.[2] as Record<string, unknown>).headers as Record<
            string,
            string
          >
        ).Authorization
      ).toBe("Bearer refreshed-xyz");
    });
  });

  // Circuit breaker utilities
  describe("circuit breaker utilities", () => {
    it("getAllStatuses delegates", () => {
      expect(client.getCircuitBreakerStatus()).toEqual({ status: "closed" });
    });
    it("getMetricsRegistry returns registry", () => {
      expect(TikTokApiClient.getMetricsRegistry()).toBeDefined();
    });
    it("clearCache delegates with tiktok-api", () => {
      client.clearCache();
      expect(mockCbInstance.clearCache).toHaveBeenCalledWith("tiktok-api");
    });
    it("forceOpen delegates and returns true", () => {
      expect(client.forceCircuitBreakerOpen("op")).toBe(true);
      expect(mockCbInstance.forceOpen).toHaveBeenCalledWith("tiktok-api", "op");
    });
    it("forceClose delegates and returns true", () => {
      expect(client.forceCircuitBreakerClose("op")).toBe(true);
      expect(mockCbInstance.forceClose).toHaveBeenCalledWith("tiktok-api", "op");
    });
  });
});
