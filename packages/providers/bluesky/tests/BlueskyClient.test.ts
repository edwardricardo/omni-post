/**
 * @file BlueskyClient.test.ts
 * @description Mutation-killing tests for BlueskyClient — covers login, publishText,
 * publishWithImages, image dimension detection, and all validation boundaries.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockLogin = vi.fn();
const mockPost = vi.fn();
const mockUploadBlob = vi.fn();
const mockDetectFacets = vi.fn();

vi.mock("@atproto/api", () => {
  class FakeCredentialSession {
    session: Record<string, string> | undefined = undefined;
    constructor(_url: URL) {}
    async login(opts: { identifier: string; password: string }) {
      const result = await mockLogin(opts);
      if (result?.session) {
        this.session = result.session;
      }
    }
  }

  class FakeAtpAgent {
    constructor(_session: unknown) {}
    post = mockPost;
    uploadBlob = mockUploadBlob;
  }

  class FakeRichText {
    text: string;
    facets: Array<Record<string, unknown>> | undefined = undefined;
    constructor(opts: { text: string }) {
      this.text = opts.text;
    }
    async detectFacets(_agent: unknown) {
      const result = await mockDetectFacets(this.text);
      if (result?.facets) {
        this.facets = result.facets;
      }
    }
  }

  return {
    AtpAgent: FakeAtpAgent,
    CredentialSession: FakeCredentialSession,
    RichText: FakeRichText,
  };
});

vi.mock("image-size", () => ({
  imageSize: vi.fn(),
}));

import { BlueskyClient } from "../src/BlueskyClient.js";
import { imageSize } from "image-size";

const mockedImageSize = vi.mocked(imageSize);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(
  identifier = "test.bsky.social",
  appPassword = "xxxx-xxxx-xxxx-xxxx"
): BlueskyClient {
  return new BlueskyClient({ identifier, appPassword });
}

function setupLoginSuccess() {
  mockLogin.mockResolvedValue({
    session: {
      accessJwt: "jwt-access-123",
      refreshJwt: "jwt-refresh-456",
      did: "did:plc:abc123",
      handle: "test.bsky.social",
    },
  });
}

function setupLoginFailure() {
  mockLogin.mockRejectedValue(new Error("Invalid credentials"));
}

function setupLoginNoSession() {
  mockLogin.mockResolvedValue({ session: undefined });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("BlueskyClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectFacets.mockResolvedValue({});
  });

  // =========================================================================
  // login()
  // =========================================================================

  describe("login", () => {
    it("returns session fields on successful login", async () => {
      const client = makeClient();
      setupLoginSuccess();

      const result = await client.login();
      assert.ok(result.ok, "Login should succeed");
      assert.equal(result.value.accessJwt, "jwt-access-123");
      assert.equal(result.value.refreshJwt, "jwt-refresh-456");
      assert.equal(result.value.did, "did:plc:abc123");
      assert.equal(result.value.handle, "test.bsky.social");
    });

    it("passes correct identifier and password to session.login", async () => {
      const client = makeClient("alice.bsky.social", "fixture-login-pw");
      setupLoginSuccess();

      await client.login();
      expect(mockLogin).toHaveBeenCalledWith({
        identifier: "alice.bsky.social",
        password: "fixture-login-pw",
      });
    });

    it("returns AUTH error when login throws", async () => {
      const client = makeClient();
      setupLoginFailure();

      const result = await client.login();
      assert.ok(!result.ok, "Login should fail");
      assert.equal(result.error, "AUTH");
    });

    it("returns AUTH error when session is undefined after login", async () => {
      const client = makeClient();
      setupLoginNoSession();

      const result = await client.login();
      assert.ok(!result.ok, "Login should fail when session is null");
      assert.equal(result.error, "AUTH");
    });
  });

  // =========================================================================
  // publishText()
  // =========================================================================

  describe("publishText", () => {
    it("returns VALIDATION error for text > 300 chars", async () => {
      const client = makeClient();
      const result = await client.publishText("a".repeat(301));
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("returns VALIDATION error for exactly 301 chars", async () => {
      const client = makeClient();
      const result = await client.publishText("b".repeat(301));
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("accepts exactly 300 chars", async () => {
      const client = makeClient();
      mockPost.mockResolvedValue({ uri: "at://did:plc:x/app.bsky.feed.post/abc", cid: "cid-abc" });

      const result = await client.publishText("c".repeat(300));
      assert.ok(result.ok, "300 chars should be accepted");
    });

    it("accepts empty string", async () => {
      const client = makeClient();
      mockPost.mockResolvedValue({
        uri: "at://did:plc:x/app.bsky.feed.post/empty",
        cid: "cid-empty",
      });

      const result = await client.publishText("");
      assert.ok(result.ok, "Empty text should be accepted");
    });

    it("returns uri and cid on successful publish", async () => {
      const client = makeClient();
      mockPost.mockResolvedValue({
        uri: "at://did:plc:abc/app.bsky.feed.post/3kpost1",
        cid: "bafyreib123",
      });

      const result = await client.publishText("Hello Bluesky!");
      assert.ok(result.ok);
      assert.equal(result.value.uri, "at://did:plc:abc/app.bsky.feed.post/3kpost1");
      assert.equal(result.value.cid, "bafyreib123");
    });

    it("calls detectFacets with the agent before posting", async () => {
      const client = makeClient();
      mockPost.mockResolvedValue({ uri: "at://x", cid: "cid-1" });

      await client.publishText("Check https://example.com");
      expect(mockDetectFacets).toHaveBeenCalledWith("Check https://example.com");
    });

    it("includes facets in post when detected", async () => {
      const client = makeClient();
      const fakeFacets = [
        { index: { byteStart: 6, byteEnd: 25 }, features: [{ uri: "https://example.com" }] },
      ];
      mockDetectFacets.mockResolvedValue({ facets: fakeFacets });
      mockPost.mockResolvedValue({ uri: "at://x", cid: "cid-2" });

      await client.publishText("Check https://example.com");

      expect(mockPost).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Check https://example.com",
          facets: fakeFacets,
          createdAt: expect.any(String),
        })
      );
    });

    it("omits facets from post when none detected", async () => {
      const client = makeClient();
      mockDetectFacets.mockResolvedValue({});
      mockPost.mockResolvedValue({ uri: "at://x", cid: "cid-3" });

      await client.publishText("No links here");

      const postCall = mockPost.mock.calls[0]?.[0];
      assert.ok(postCall, "post should have been called");
      assert.equal(Object.prototype.hasOwnProperty.call(postCall, "facets"), false);
    });

    it("includes createdAt as ISO string", async () => {
      const client = makeClient();
      mockPost.mockResolvedValue({ uri: "at://x", cid: "cid-4" });

      await client.publishText("Hello");

      const postCall = mockPost.mock.calls[0]?.[0];
      assert.ok(postCall?.createdAt, "createdAt should be present");
      // Verify it's a valid ISO date string
      const parsed = new Date(postCall.createdAt);
      assert.ok(!isNaN(parsed.getTime()), "createdAt should be a valid date");
    });

    it("returns PUBLISH error when agent.post throws", async () => {
      const client = makeClient();
      mockPost.mockRejectedValue(new Error("Network error"));

      const result = await client.publishText("Hello");
      assert.ok(!result.ok);
      assert.equal(result.error, "PUBLISH");
    });
  });

  // =========================================================================
  // publishWithImages()
  // =========================================================================

  describe("publishWithImages", () => {
    const smallBuffer = new Uint8Array(100);
    const altTexts = ["Alt text 1"];

    beforeEach(() => {
      mockedImageSize.mockReturnValue({ width: 800, height: 600 } as ReturnType<typeof imageSize>);
      mockUploadBlob.mockResolvedValue({ data: { blob: { ref: "blob-ref-1" } } });
      mockPost.mockResolvedValue({
        uri: "at://did:plc:abc/app.bsky.feed.post/img1",
        cid: "bafyimg1",
      });
    });

    it("returns VALIDATION for text > 300 chars", async () => {
      const client = makeClient();
      const result = await client.publishWithImages("x".repeat(301), [smallBuffer], altTexts);
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("accepts text of exactly 300 chars", async () => {
      const client = makeClient();
      const result = await client.publishWithImages("y".repeat(300), [smallBuffer], altTexts);
      assert.ok(result.ok, "300 chars should be accepted with images");
    });

    it("returns VALIDATION for > 4 images", async () => {
      const client = makeClient();
      const buffers = Array.from({ length: 5 }, () => new Uint8Array(50));
      const alts = Array.from({ length: 5 }, (_, i) => `alt ${i}`);

      const result = await client.publishWithImages("test", buffers, alts);
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("accepts exactly 4 images", async () => {
      const client = makeClient();
      const buffers = Array.from({ length: 4 }, () => new Uint8Array(50));
      const alts = Array.from({ length: 4 }, (_, i) => `alt ${i}`);

      const result = await client.publishWithImages("test", buffers, alts);
      assert.ok(result.ok, "4 images should be accepted");
    });

    it("returns VALIDATION when any image exceeds 1,000,000 bytes", async () => {
      const client = makeClient();
      const largeBuffer = new Uint8Array(1_000_001);
      const result = await client.publishWithImages("test", [largeBuffer], ["alt"]);
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("accepts image of exactly 1,000,000 bytes", async () => {
      const client = makeClient();
      const exactBuffer = new Uint8Array(1_000_000);
      const result = await client.publishWithImages("test", [exactBuffer], ["alt"]);
      assert.ok(result.ok, "Exactly 1MB should be accepted");
    });

    it("returns uri and cid on success", async () => {
      const client = makeClient();
      const result = await client.publishWithImages("Hello images", [smallBuffer], altTexts);
      assert.ok(result.ok);
      assert.equal(result.value.uri, "at://did:plc:abc/app.bsky.feed.post/img1");
      assert.equal(result.value.cid, "bafyimg1");
    });

    it("uploads each image blob with image/jpeg encoding", async () => {
      const client = makeClient();
      const buf1 = new Uint8Array(10);
      const buf2 = new Uint8Array(20);

      await client.publishWithImages("two imgs", [buf1, buf2], ["a", "b"]);

      expect(mockUploadBlob).toHaveBeenCalledTimes(2);
      expect(mockUploadBlob).toHaveBeenCalledWith(buf1, { encoding: "image/jpeg" });
      expect(mockUploadBlob).toHaveBeenCalledWith(buf2, { encoding: "image/jpeg" });
    });

    it("includes aspectRatio when image dimensions are detected", async () => {
      const client = makeClient();
      mockedImageSize.mockReturnValue({ width: 1920, height: 1080 } as ReturnType<
        typeof imageSize
      >);

      await client.publishWithImages("with ratio", [smallBuffer], ["alt"]);

      const postCall = mockPost.mock.calls[0]?.[0];
      assert.ok(postCall, "post should be called");
      const images = postCall.embed?.images;
      assert.ok(Array.isArray(images));
      assert.equal(images[0].aspectRatio.width, 1920);
      assert.equal(images[0].aspectRatio.height, 1080);
    });

    it("omits aspectRatio when image dimensions cannot be determined", async () => {
      const client = makeClient();
      mockedImageSize.mockReturnValue({
        width: undefined,
        height: undefined,
      } as unknown as ReturnType<typeof imageSize>);

      await client.publishWithImages("no dims", [smallBuffer], ["alt"]);

      const postCall = mockPost.mock.calls[0]?.[0];
      const images = postCall?.embed?.images;
      assert.ok(Array.isArray(images));
      assert.equal(Object.prototype.hasOwnProperty.call(images[0], "aspectRatio"), false);
    });

    it("omits aspectRatio when imageSize throws", async () => {
      const client = makeClient();
      mockedImageSize.mockImplementation(() => {
        throw new Error("Unknown format");
      });

      await client.publishWithImages("err dims", [smallBuffer], ["alt"]);

      const postCall = mockPost.mock.calls[0]?.[0];
      const images = postCall?.embed?.images;
      assert.ok(Array.isArray(images));
      assert.equal(Object.prototype.hasOwnProperty.call(images[0], "aspectRatio"), false);
    });

    it("uses correct alt text per image, defaults to empty string", async () => {
      const client = makeClient();
      const buf1 = new Uint8Array(10);
      const buf2 = new Uint8Array(10);

      await client.publishWithImages("alts", [buf1, buf2], ["First alt"]);

      const postCall = mockPost.mock.calls[0]?.[0];
      const images = postCall?.embed?.images;
      assert.ok(Array.isArray(images));
      assert.equal(images[0].alt, "First alt");
      assert.equal(images[1].alt, ""); // No alt provided for second image
    });

    it("sets embed.$type to app.bsky.embed.images", async () => {
      const client = makeClient();
      await client.publishWithImages("embed type", [smallBuffer], ["alt"]);

      const postCall = mockPost.mock.calls[0]?.[0];
      assert.equal(postCall?.embed?.$type, "app.bsky.embed.images");
    });

    it("detects facets in text when publishing with images", async () => {
      const client = makeClient();
      const fakeFacets = [{ index: { byteStart: 0, byteEnd: 5 } }];
      mockDetectFacets.mockResolvedValue({ facets: fakeFacets });

      await client.publishWithImages("link https://x.com", [smallBuffer], ["alt"]);

      expect(mockDetectFacets).toHaveBeenCalledWith("link https://x.com");
      const postCall = mockPost.mock.calls[0]?.[0];
      assert.deepEqual(postCall?.facets, fakeFacets);
    });

    it("returns PUBLISH error when uploadBlob throws", async () => {
      const client = makeClient();
      mockUploadBlob.mockRejectedValue(new Error("Upload failed"));

      const result = await client.publishWithImages("fail upload", [smallBuffer], ["alt"]);
      assert.ok(!result.ok);
      assert.equal(result.error, "PUBLISH");
    });

    it("returns PUBLISH error when agent.post throws", async () => {
      const client = makeClient();
      mockPost.mockRejectedValue(new Error("Post failed"));

      const result = await client.publishWithImages("fail post", [smallBuffer], ["alt"]);
      assert.ok(!result.ok);
      assert.equal(result.error, "PUBLISH");
    });

    it("stores blob reference from upload in the images array", async () => {
      const client = makeClient();
      mockUploadBlob.mockResolvedValue({ data: { blob: { ref: "custom-blob-ref" } } });

      await client.publishWithImages("blob ref", [smallBuffer], ["alt"]);

      const postCall = mockPost.mock.calls[0]?.[0];
      const images = postCall?.embed?.images;
      assert.ok(Array.isArray(images));
      assert.deepEqual(images[0].image, { ref: "custom-blob-ref" });
    });
  });
});
