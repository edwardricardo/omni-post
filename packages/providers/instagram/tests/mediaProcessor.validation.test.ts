/**
 * @file mediaProcessor.validation.test.ts
 * @description Tests for InstagramMediaProcessor -- validateVideo, error handling,
 *              resilience, and integration scenarios (Stories/Reels workflows).
 *
 * Framework: node:test + node:assert/strict
 * Mocking:   mock.module() for fluent-ffmpeg, external-apis, storage-s3, prom-client.
 */

import { describe, it, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createPassthroughCB, createMockFfmpegInstance } from "./mediaProcessor.test-helpers.js";

let InstagramMediaProcessor: any;
let ffprobeMockFn: ReturnType<typeof mock.fn>;

describe("InstagramMediaProcessor (validation)", { concurrency: 1 }, () => {
  let mediaProcessor: any;

  before(async () => {
    ffprobeMockFn = mock.fn((_url: string, cb: (err: any, data: any) => void) => {
      cb(null, {
        streams: [
          {
            codec_type: "video",
            width: 1080,
            height: 1920,
            r_frame_rate: "30/1",
          },
        ],
        format: {
          duration: "45.5",
          bit_rate: "2500000",
          format_name: "mp4,mov",
        },
      });
    });

    const cbPassthrough = createPassthroughCB();

    mock.module("@adapters/external-apis", {
      namedExports: {
        createExternalApiCircuitBreaker: () => cbPassthrough,
        resetExternalApiCircuitBreaker: async () => undefined,
      },
    });

    mock.module("@adapters/storage-s3", {
      namedExports: {
        createS3StorageAdapter: () => ({
          generateUploadSignature: async () => ({
            ok: true as const,
            value: {
              url: "https://s3.amazonaws.com/bucket/",
              fields: { key: "test-key" },
            },
          }),
        }),
      },
    });

    mock.module("prom-client", {
      defaultExport: {
        Registry: class {
          registerMetric() {}
          removeSingleMetric() {}
        },
        Counter: class {
          inc() {}
          labels() {
            return this;
          }
        },
        Histogram: class {
          observe() {}
          labels() {
            return this;
          }
          startTimer() {
            return () => 0;
          }
        },
        Gauge: class {
          set() {}
          inc() {}
          dec() {}
          labels() {
            return this;
          }
        },
      },
    });

    const ffmpegMock = Object.assign(
      mock.fn(() => createMockFfmpegInstance()),
      { ffprobe: ffprobeMockFn }
    );

    mock.module("fluent-ffmpeg", {
      defaultExport: ffmpegMock,
    });

    mock.module("fs", {
      namedExports: {
        promises: {
          readFile: async () => Buffer.from("fake-video-data"),
          unlink: async () => undefined,
        },
      },
      defaultExport: {
        promises: {
          readFile: async () => Buffer.from("fake-video-data"),
          unlink: async () => undefined,
        },
      },
    });

    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_S3_BUCKET = "test-bucket";

    const mod = await import("../src/mediaProcessor.js");
    InstagramMediaProcessor = mod.InstagramMediaProcessor;
  });

  beforeEach(() => {
    mediaProcessor = new InstagramMediaProcessor("https://test-storage.com");

    // Reset ffprobe to default metadata
    ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
      cb(null, {
        streams: [
          {
            codec_type: "video",
            width: 1080,
            height: 1920,
            r_frame_rate: "30/1",
          },
        ],
        format: {
          duration: "45.5",
          bit_rate: "2500000",
          format_name: "mp4,mov",
        },
      });
    });
  });

  after(() => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_S3_BUCKET;
  });

  // =========================================================================
  // validateVideo
  // =========================================================================

  describe("validateVideo", { concurrency: 1 }, () => {
    it("should validate video for STORIES", async () => {
      const result = await mediaProcessor.validateVideo(
        "https://example.com/story-video.mp4",
        "STORIES"
      );

      assert.ok(typeof result.valid === "boolean");
      assert.ok(Array.isArray(result.issues));
      assert.ok(Array.isArray(result.recommendations));
    });

    it("should detect duration issues for STORIES", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
          format: { duration: "120", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const result = await mediaProcessor.validateVideo(
        "https://example.com/long-story.mp4",
        "STORIES"
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.includes("Stories videos must be 60 seconds or less"));
      assert.ok(result.recommendations.includes("Consider splitting into multiple Story segments"));
    });

    it("should detect duration issues for REELS", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
          format: { duration: "120", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const result = await mediaProcessor.validateVideo(
        "https://example.com/long-reel.mp4",
        "REELS"
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.includes("Reels videos must be 90 seconds or less"));
      assert.ok(result.recommendations.includes("Trim video to 90 seconds or less"));
    });

    it("should detect short Reel issues", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
          format: { duration: "3", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const result = await mediaProcessor.validateVideo(
        "https://example.com/short-reel.mp4",
        "REELS"
      );

      assert.strictEqual(result.valid, false);
      assert.ok(
        result.issues.includes("Reels should be at least 5 seconds for optimal visibility")
      );
    });

    it("should validate FEED video duration", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
          format: { duration: "900", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const result = await mediaProcessor.validateVideo(
        "https://example.com/long-feed-video.mp4",
        "FEED"
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.includes("Feed videos should be under 10 minutes"));
    });

    it("should check aspect ratio for Stories and Reels", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1" }],
          format: { duration: "30", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const storiesResult = await mediaProcessor.validateVideo(
        "https://example.com/landscape.mp4",
        "STORIES"
      );
      const reelsResult = await mediaProcessor.validateVideo(
        "https://example.com/landscape.mp4",
        "REELS"
      );

      assert.ok(
        storiesResult.recommendations.includes(
          "Use 9:16 aspect ratio for optimal display in Stories/Reels"
        )
      );
      assert.ok(
        reelsResult.recommendations.includes(
          "Use 9:16 aspect ratio for optimal display in Stories/Reels"
        )
      );
    });

    it("should estimate file size and flag large files", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
          format: { duration: "60", bit_rate: "100000000", format_name: "mp4" },
        });
      });

      const result = await mediaProcessor.validateVideo(
        "https://example.com/high-bitrate.mp4",
        "FEED"
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.includes("Video file size may be too large"));
      assert.ok(result.recommendations.includes("Consider reducing bitrate or resolution"));
    });

    it("should pass validation for optimal videos", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
          format: { duration: "30", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const result = await mediaProcessor.validateVideo(
        "https://example.com/optimal.mp4",
        "STORIES"
      );

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.issues.length, 0);
    });
  });

  // =========================================================================
  // integration scenarios
  // =========================================================================

  describe("integration scenarios", { concurrency: 1 }, () => {
    it("should handle complete Stories workflow", async () => {
      // 1. Get metadata
      const metadata = await mediaProcessor.getVideoMetadata(
        "https://example.com/stories-video.mp4"
      );
      assert.ok(metadata.duration > 15); // 45.5s

      // 2. Validate for Stories
      const validation = await mediaProcessor.validateVideo(
        "https://example.com/stories-video.mp4",
        "STORIES"
      );
      assert.strictEqual(validation.valid, true); // 45.5s < 60s
    });

    it("should handle complete Reels workflow", async () => {
      // 1. Get metadata
      const metadata = await mediaProcessor.getVideoMetadata("https://example.com/reels-video.mp4");
      assert.ok(metadata.duration <= 90); // 45.5s

      // 2. Validate for Reels
      const validation = await mediaProcessor.validateVideo(
        "https://example.com/reels-video.mp4",
        "REELS"
      );
      assert.strictEqual(validation.valid, true);

      // 3. Optimize (should return original since already optimal)
      const optimized = await mediaProcessor.optimizeForReels(
        "https://example.com/reels-video.mp4"
      );
      assert.strictEqual(optimized, "https://example.com/reels-video.mp4");
    });
  });
});
