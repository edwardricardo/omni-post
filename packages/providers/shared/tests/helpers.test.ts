/**
 * @file helpers.test.ts
 * @description Unit tests for the stateless composition helpers used by every
 *              concrete provider adapter — credential validation, media upload
 *              with exponential-backoff retry, error mapping to PublishError,
 *              API response field validation, content limit enforcement, and
 *              UI preview generation.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CanonicalPost, RenderedContent, Result } from "@shared/types";
import { ok } from "@shared/types";
import type { ProviderLimits } from "@ports/core";
import {
  validateCredentialStructure,
  uploadMediaWithRetry,
  uploadMediaBatch,
  mapErrorToPublishError,
  validateApiResponse,
  validateContentForLimits,
  generateProviderPreview,
} from "../src/helpers.js";
import type { MediaUploadResult } from "../src/providerTypes.js";

// ─── Test fixtures ──────────────────────────────────────────────────────────

const makeUploadResult = (overrides: Partial<MediaUploadResult> = {}): MediaUploadResult => ({
  id: "media-001",
  url: "https://cdn.example.com/media-001.jpg",
  type: "image",
  ...overrides,
});

const makeCanonicalPost = (overrides: Partial<CanonicalPost> = {}): CanonicalPost => ({
  id: "post-001",
  projectId: "project-001",
  locale: "en",
  body: "Hello world",
  ...overrides,
});

const makeLimits = (overrides: Partial<ProviderLimits> = {}): ProviderLimits => ({
  maxChars: 280,
  maxMediaPerPost: 4,
  allowedMedia: ["image", "video", "gif"],
  ...overrides,
});

// ─── validateCredentialStructure ────────────────────────────────────────────

describe("validateCredentialStructure", () => {
  interface Creds extends Record<string, unknown> {
    apiKey: string;
    apiSecret: string;
  }

  it("returns ok with the credentials when every required field is non-empty", () => {
    const creds: Creds = { apiKey: "k", apiSecret: "s" };
    const result = validateCredentialStructure<Creds>(creds, ["apiKey", "apiSecret"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(creds);
    }
  });

  it("returns AUTH_INVALID when credentials is null", () => {
    const result = validateCredentialStructure(null, ["apiKey"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("AUTH_INVALID");
  });

  it("returns AUTH_INVALID when credentials is not an object (string)", () => {
    const result = validateCredentialStructure("not-an-object", ["apiKey"]);
    expect(result.ok).toBe(false);
  });

  it("returns AUTH_INVALID when a required field is missing", () => {
    const result = validateCredentialStructure<Creds>({ apiKey: "k" }, ["apiKey", "apiSecret"]);
    expect(result.ok).toBe(false);
  });

  it("returns AUTH_INVALID when a required field is the empty string (falsy)", () => {
    const result = validateCredentialStructure<Creds>({ apiKey: "k", apiSecret: "" }, [
      "apiKey",
      "apiSecret",
    ]);
    expect(result.ok).toBe(false);
  });

  it("logs a warn including providerId when provided", () => {
    const logger = { warn: vi.fn() } as unknown as Parameters<
      typeof validateCredentialStructure
    >[2];
    validateCredentialStructure({ apiKey: "k" }, ["apiKey", "apiSecret"], logger, "youtube");
    const warnSpy = (logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn;
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("apiSecret"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("youtube"));
  });
});

// ─── uploadMediaWithRetry ───────────────────────────────────────────────────

describe("uploadMediaWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns ok on the first attempt when the upload succeeds immediately", async () => {
    const uploadFn = vi.fn().mockResolvedValue(makeUploadResult());
    const promise = uploadMediaWithRetry("https://example.com/m.jpg", uploadFn, { maxRetries: 3 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential backoff and eventually succeeds", async () => {
    const uploadFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValue(makeUploadResult({ id: "third-try" }));

    const promise = uploadMediaWithRetry("https://example.com/m.jpg", uploadFn, { maxRetries: 3 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("third-try");
    expect(uploadFn).toHaveBeenCalledTimes(3);
  });

  it("returns MEDIA_UPLOAD_FAILED after exhausting all retries", async () => {
    const uploadFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const promise = uploadMediaWithRetry("https://example.com/m.jpg", uploadFn, { maxRetries: 2 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MEDIA_UPLOAD_FAILED");
    expect(uploadFn).toHaveBeenCalledTimes(2);
  });

  it("defaults maxRetries to 3 when options are omitted", async () => {
    const uploadFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const promise = uploadMediaWithRetry("https://example.com/m.jpg", uploadFn);
    await vi.runAllTimersAsync();
    await promise;
    expect(uploadFn).toHaveBeenCalledTimes(3);
  });

  it("normalises non-Error rejections into Error before logging", async () => {
    const uploadFn = vi.fn().mockRejectedValue("string-rejection");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const promise = uploadMediaWithRetry(
      "https://example.com/m.jpg",
      uploadFn,
      { maxRetries: 1 },
      logger as unknown as Parameters<typeof uploadMediaWithRetry>[3]
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("string-rejection"));
  });
});

// ─── uploadMediaBatch ───────────────────────────────────────────────────────

describe("uploadMediaBatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns ok with one result per URL when all uploads succeed", async () => {
    const uploadFn = vi
      .fn()
      .mockResolvedValueOnce(makeUploadResult({ id: "a" }))
      .mockResolvedValueOnce(makeUploadResult({ id: "b" }));
    const promise = uploadMediaBatch(
      ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      uploadFn
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.id)).toEqual(["a", "b"]);
    }
  });

  it("returns MEDIA_UPLOAD_FAILED if any single upload fails after retries", async () => {
    const uploadFn = vi
      .fn()
      .mockResolvedValueOnce(makeUploadResult({ id: "a" }))
      .mockRejectedValue(new Error("permanent"));
    const promise = uploadMediaBatch(
      ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      uploadFn,
      { maxRetries: 1 }
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("returns ok with empty array when given no URLs", async () => {
    const uploadFn = vi.fn();
    const result = await uploadMediaBatch([], uploadFn);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
    expect(uploadFn).not.toHaveBeenCalled();
  });
});

// ─── mapErrorToPublishError ─────────────────────────────────────────────────

describe("mapErrorToPublishError", () => {
  it("maps non-Error values to NETWORK", () => {
    expect(mapErrorToPublishError("string")).toBe("NETWORK");
    expect(mapErrorToPublishError(null)).toBe("NETWORK");
    expect(mapErrorToPublishError(undefined)).toBe("NETWORK");
    expect(mapErrorToPublishError(42)).toBe("NETWORK");
  });

  it("maps HTTP 429 to RATE_LIMIT", () => {
    const e = Object.assign(new Error("rate limited"), { status: 429 });
    expect(mapErrorToPublishError(e)).toBe("RATE_LIMIT");
  });

  it("maps code RATE_LIMIT_EXCEEDED to RATE_LIMIT regardless of status", () => {
    const e = Object.assign(new Error("rate limited"), { code: "RATE_LIMIT_EXCEEDED" });
    expect(mapErrorToPublishError(e)).toBe("RATE_LIMIT");
  });

  it("maps HTTP 401 and 403 to AUTH", () => {
    const e401 = Object.assign(new Error("unauth"), { status: 401 });
    const e403 = Object.assign(new Error("forbid"), { status: 403 });
    expect(mapErrorToPublishError(e401)).toBe("AUTH");
    expect(mapErrorToPublishError(e403)).toBe("AUTH");
  });

  it("maps other 4xx (e.g. 422) to VALIDATION", () => {
    const e = Object.assign(new Error("unprocessable"), { status: 422 });
    expect(mapErrorToPublishError(e)).toBe("VALIDATION");
  });

  it("maps 5xx to NETWORK", () => {
    const e500 = Object.assign(new Error("server"), { status: 500 });
    const e503 = Object.assign(new Error("unavail"), { status: 503 });
    expect(mapErrorToPublishError(e500)).toBe("NETWORK");
    expect(mapErrorToPublishError(e503)).toBe("NETWORK");
  });

  it("falls through to NETWORK when status is missing", () => {
    expect(mapErrorToPublishError(new Error("bare"))).toBe("NETWORK");
  });

  // ── §2F Slice 1: statusCode + provider error code classification ───────────
  it("maps statusCode 401/403 to AUTH (AppError/ProviderError use statusCode, not status)", () => {
    const e401 = Object.assign(new Error("unauth"), { statusCode: 401 });
    const e403 = Object.assign(new Error("forbid"), { statusCode: 403 });
    expect(mapErrorToPublishError(e401)).toBe("AUTH");
    expect(mapErrorToPublishError(e403)).toBe("AUTH");
  });

  it("maps statusCode 429 to RATE_LIMIT", () => {
    const e = Object.assign(new Error("too many"), { statusCode: 429 });
    expect(mapErrorToPublishError(e)).toBe("RATE_LIMIT");
  });

  it("maps other 4xx statusCode (e.g. 422) to VALIDATION", () => {
    const e = Object.assign(new Error("unprocessable"), { statusCode: 422 });
    expect(mapErrorToPublishError(e)).toBe("VALIDATION");
  });

  it("maps 5xx statusCode (e.g. ProviderError.externalService 502) to NETWORK", () => {
    const e = Object.assign(new Error("ext service"), { statusCode: 502 });
    expect(mapErrorToPublishError(e)).toBe("NETWORK");
  });

  it("maps the AUTH_INVALID_CREDENTIALS provider error code to AUTH even when statusCode is 502", () => {
    // ProviderError.externalService hard-codes 502 but a definitive auth code
    // can still be attached; the code wins so the failure is classified AUTH.
    const e = Object.assign(new Error("token revoked"), {
      statusCode: 502,
      code: "AUTH_INVALID_CREDENTIALS",
    });
    expect(mapErrorToPublishError(e)).toBe("AUTH");
  });

  it("maps a 403 quotaExceeded reason to RATE_LIMIT (NOT AUTH — quota is transient)", () => {
    // YouTube returns HTTP 403 for BOTH auth failures and quota exhaustion.
    // Quota is a transient throttle; classifying it as AUTH falsely trips reauth.
    const e = Object.assign(new Error("quota"), {
      status: 403,
      errors: [{ reason: "quotaExceeded" }],
    });
    expect(mapErrorToPublishError(e)).toBe("RATE_LIMIT");
  });

  it("maps a 403 rateLimitExceeded reason to RATE_LIMIT", () => {
    const e = Object.assign(new Error("rate"), {
      status: 403,
      errors: [{ reason: "rateLimitExceeded" }],
    });
    expect(mapErrorToPublishError(e)).toBe("RATE_LIMIT");
  });

  // REAL Gaxios shape (gaxios 7 / googleapis-common 8 / googleapis 173): a quota
  // 403 surfaces with `status` at the top level but the reason NESTED under
  // `response.data.error.errors[].reason` — there is NO top-level `errors[]`.
  // The naive top-level-only extractor finds nothing, falls through to 403->AUTH,
  // and falsely trips reauth on a transient throttle. The mapper MUST read the
  // nested googleapis location too.
  it("maps a real Gaxios 403 quota (nested response.data.error.errors) to RATE_LIMIT", () => {
    const e = Object.assign(new Error("exceeded your quota"), {
      status: 403,
      response: {
        status: 403,
        data: {
          error: {
            code: 403,
            errors: [{ reason: "quotaExceeded", domain: "youtube.quota" }],
            status: "PERMISSION_DENIED",
          },
        },
      },
    });
    expect(mapErrorToPublishError(e)).toBe("RATE_LIMIT");
  });

  it("still maps a 403 authError reason to AUTH", () => {
    const e = Object.assign(new Error("auth"), {
      status: 403,
      errors: [{ reason: "authError" }],
    });
    expect(mapErrorToPublishError(e)).toBe("AUTH");
  });
});

// ─── validateApiResponse ────────────────────────────────────────────────────

describe("validateApiResponse", () => {
  interface Resp {
    id: string;
    name: string;
  }

  it("returns ok and casts when every required field is present", () => {
    const res = validateApiResponse<Resp>({ id: "1", name: "x", extra: "ignored" }, ["id", "name"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.id).toBe("1");
      expect(res.value.name).toBe("x");
    }
  });

  it("returns INVALID_RESPONSE when response is null", () => {
    const res = validateApiResponse(null, ["id"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("INVALID_RESPONSE");
  });

  it("returns INVALID_RESPONSE when response is a primitive", () => {
    expect(validateApiResponse("string", ["id"]).ok).toBe(false);
    expect(validateApiResponse(42, ["id"]).ok).toBe(false);
  });

  it("returns INVALID_RESPONSE when a required field is absent", () => {
    const res = validateApiResponse({ id: "1" }, ["id", "name"]);
    expect(res.ok).toBe(false);
  });

  it("logs a warn naming the missing field", () => {
    const logger = { warn: vi.fn() };
    validateApiResponse(
      { id: "1" },
      ["id", "name"],
      logger as unknown as Parameters<typeof validateApiResponse>[2]
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("name"));
  });
});

// ─── validateContentForLimits ───────────────────────────────────────────────

describe("validateContentForLimits", () => {
  it("returns valid=true for content within all limits", async () => {
    const post = makeCanonicalPost({ body: "short", media: [] });
    const result = await validateContentForLimits(post, makeLimits(), { threading: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags a character overflow with a truncate suggestion", async () => {
    const post = makeCanonicalPost({ body: "x".repeat(300) });
    const result = await validateContentForLimits(post, makeLimits({ maxChars: 280 }), {
      threading: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("text");
    expect(result.suggestions.find((s) => s.action === "truncate")).toBeDefined();
  });

  it("adds a thread suggestion when overflow occurs and threading is supported", async () => {
    const post = makeCanonicalPost({ body: "x".repeat(300) });
    const result = await validateContentForLimits(post, makeLimits({ maxChars: 280 }), {
      threading: true,
    });
    expect(result.suggestions.find((s) => s.action === "thread")).toBeDefined();
  });

  it("flags too many media items relative to maxMediaPerPost", async () => {
    const post = makeCanonicalPost({
      body: "ok",
      media: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        type: "image" as const,
        url: `https://example.com/m${i}.jpg`,
      })),
    });
    const result = await validateContentForLimits(post, makeLimits({ maxMediaPerPost: 4 }), {
      threading: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.find((e) => e.field === "media")).toBeDefined();
  });

  it("flags an unsupported media type", async () => {
    const post = makeCanonicalPost({
      body: "ok",
      media: [{ id: "m1", type: "video" as const, url: "https://example.com/m.mp4" }],
    });
    const result = await validateContentForLimits(post, makeLimits({ allowedMedia: ["image"] }), {
      threading: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'video'"))).toBe(true);
  });
});

// ─── generateProviderPreview ────────────────────────────────────────────────

describe("generateProviderPreview", () => {
  it("renders a single-post preview within character limits", async () => {
    const post = makeCanonicalPost({ body: "hi" });
    const renderResult: Result<RenderedContent, unknown> = ok({
      type: "single",
      content: { body: "hi", text: "hi" },
    });
    const preview = await generateProviderPreview(
      post,
      "x",
      makeLimits({ maxChars: 280 }),
      renderResult
    );
    expect(preview.content.text).toBe("hi");
    expect(preview.content.truncated).toBe(false);
    expect(preview.constraints.charactersUsed).toBe(2);
    expect(preview.constraints.charactersRemaining).toBe(278);
    expect(preview.warnings).toEqual([]);
  });

  it("marks truncated and adds a warning when text exceeds maxChars", async () => {
    const longText = "x".repeat(300);
    const post = makeCanonicalPost({ body: longText });
    const renderResult: Result<RenderedContent, unknown> = ok({
      type: "single",
      content: { body: longText, text: longText },
    });
    const preview = await generateProviderPreview(
      post,
      "x",
      makeLimits({ maxChars: 280 }),
      renderResult
    );
    expect(preview.content.truncated).toBe(true);
    expect(preview.constraints.charactersRemaining).toBe(0);
    expect(preview.warnings).toEqual(["Content exceeds character limit"]);
  });

  it("includes media metadata when canonical has media", async () => {
    const post = makeCanonicalPost({
      body: "hi",
      media: [{ id: "m1", type: "image" as const, url: "https://example.com/m.jpg" }],
    });
    const renderResult: Result<RenderedContent, unknown> = ok({
      type: "single",
      content: { body: "hi", text: "hi" },
    });
    const preview = await generateProviderPreview(post, "x", makeLimits(), renderResult);
    expect(preview.content.media).toEqual([
      { type: "image", url: "https://example.com/m.jpg", optimized: false },
    ]);
    expect(preview.constraints.mediaCount).toBe(1);
  });

  it("includes threading info for thread-type render results", async () => {
    const post = makeCanonicalPost({ body: "long content" });
    const renderResult: Result<RenderedContent, unknown> = ok({
      type: "thread",
      content: {
        strategy: "natural-break",
        tweets: [
          { sequence: 1, text: "part 1", estimatedChars: 6 },
          { sequence: 2, text: "part 2", estimatedChars: 6 },
        ],
        totalChars: 12,
        estimatedReach: 0,
        needsThreading: true,
      },
    });
    const preview = await generateProviderPreview(post, "x", makeLimits(), renderResult);
    expect(preview.threading?.threadCount).toBe(2);
    expect(preview.threading?.posts).toEqual(["part 1", "part 2"]);
    expect(preview.content.text).toBe("part 1");
  });

  it("returns empty text and zero counts when render fails", async () => {
    const post = makeCanonicalPost({ body: "hi" });
    const renderResult: Result<RenderedContent, unknown> = { ok: false, error: "RENDER_FAIL" };
    const preview = await generateProviderPreview(
      post,
      "x",
      makeLimits({ maxChars: 280 }),
      renderResult
    );
    expect(preview.content.text).toBe("");
    expect(preview.constraints.charactersUsed).toBe(0);
    expect(preview.constraints.charactersRemaining).toBe(280);
  });
});
