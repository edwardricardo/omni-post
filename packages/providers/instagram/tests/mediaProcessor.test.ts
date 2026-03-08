/**
 * @file mediaProcessor.test.ts
 * @description Tests for InstagramMediaProcessor -- getVideoMetadata,
 *              splitVideoForStories, optimizeForReels, createThumbnail,
 *              and metrics.
 * Framework: node:test + node:assert/strict
 *
 * Tests for validateVideo, error handling, and integration scenarios
 * live in mediaProcessor.validation.test.ts.
 *
 * Mocking: mock.module() intercepts module-level dependencies
 * (fluent-ffmpeg, @adapters/external-apis, @adapters/storage-s3, prom-client)
 * so that the processor can be instantiated without real Redis/FFmpeg/S3.
 */

import { describe, it, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createPassthroughCB, createMockFfmpegInstance } from "./mediaProcessor.test-helpers.js";

let InstagramMediaProcessor: any;

// Shared mock state so that per-test overrides in beforeEach work
let ffprobeMockFn: ReturnType<typeof mock.fn>;
let ffmpegMockFn: ReturnType<typeof mock.fn>;
let _uploadMockFn: ReturnType<typeof mock.fn>;

describe("InstagramMediaProcessor", { concurrency: 1 }, () => {
  let mediaProcessor: any;

  before(async () => {
    // ── Prepare mock functions ──
    ffprobeMockFn = mock.fn((url: string, cb: (err: any, data: any) => void) => {
      if (url.includes("non-existent")) {
        cb(new Error("File not found"), null);
        return;
      }
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

    ffmpegMockFn = mock.fn(() => createMockFfmpegInstance());

    _uploadMockFn = mock.fn(
      async (_filePath: string, filename: string) => `https://s3.amazonaws.com/bucket/${filename}`
    );

    // ── Mock modules ──
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

    // Mock fluent-ffmpeg: the source does `import ffmpeg from "fluent-ffmpeg"`
    // and then calls `ffmpeg.ffprobe(url, cb)` and `ffmpeg(url)` as a constructor.
    const mockFfmpeg = Object.assign(ffmpegMockFn, {
      ffprobe: ffprobeMockFn,
    });

    mock.module("fluent-ffmpeg", {
      defaultExport: mockFfmpeg,
      namedExports: {
        // Type imports used by the source:
        // FfmpegCommand, FfprobeData -- these are type-only so no runtime export needed
      },
    });

    // Mock fs operations used internally for file read/write/unlink
    // The source uses `fs.promises.readFile`, `fs.promises.unlink`
    mock.module("fs", {
      namedExports: {
        promises: {
          readFile: async () => Buffer.from("fake-video-data"),
          unlink: async () => undefined,
          writeFile: async () => undefined,
        },
        readFileSync: () => Buffer.from("fake-data"),
        existsSync: () => true,
      },
      defaultExport: {
        promises: {
          readFile: async () => Buffer.from("fake-video-data"),
          unlink: async () => undefined,
          writeFile: async () => undefined,
        },
        readFileSync: () => Buffer.from("fake-data"),
        existsSync: () => true,
      },
    });

    // Mock globalThis.fetch so S3 upload requests don't hit the network
    mock.method(globalThis, "fetch", async () => {
      return new Response("OK", { status: 200, statusText: "OK" });
    });

    // Set required env vars
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_S3_BUCKET = "test-bucket";

    // Dynamic import after mocks
    const mod = await import("../src/mediaProcessor.js");
    InstagramMediaProcessor = mod.InstagramMediaProcessor;
  });

  beforeEach(() => {
    mediaProcessor = new InstagramMediaProcessor("https://test-storage.com");

    // Reset mock implementations to defaults for each test
    ffprobeMockFn.mock.mockImplementation((url: string, cb: (err: any, data: any) => void) => {
      if (url.includes("non-existent")) {
        cb(new Error("File not found"), null);
        return;
      }
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

    ffmpegMockFn.mock.mockImplementation(() => createMockFfmpegInstance());
  });

  after(() => {
    // Cleanup env vars
    delete process.env.AWS_REGION;
    delete process.env.AWS_S3_BUCKET;
  });

  // =========================================================================
  // getVideoMetadata
  // =========================================================================

  describe("getVideoMetadata", { concurrency: 1 }, () => {
    it("should return video metadata for valid video URL", async () => {
      const result = await mediaProcessor.getVideoMetadata("https://example.com/test-video.mp4");

      assert.strictEqual(result.duration, 45.5);
      assert.strictEqual(result.width, 1080);
      assert.strictEqual(result.height, 1920);
      assert.strictEqual(result.format, "mp4");
      assert.strictEqual(result.bitrate, 2500000);
      assert.strictEqual(result.frameRate, 30);
    });

    it("should handle FFprobe errors gracefully", async () => {
      await assert.rejects(
        async () => mediaProcessor.getVideoMetadata("https://example.com/non-existent-video.mp4"),
        (err: any) => {
          assert.ok(err.message.includes("File not found"));
          return true;
        }
      );
    });

    it("should handle videos without video stream", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "audio" }],
          format: { duration: "30.0", bit_rate: "128000" },
        });
      });

      await assert.rejects(
        async () => mediaProcessor.getVideoMetadata("https://example.com/audio-only.mp3"),
        (err: any) => {
          assert.ok(err.message.includes("No video stream found"));
          return true;
        }
      );
    });

    it("should parse frame rates correctly", async () => {
      const testCases = [
        { frameRate: "30/1", expected: 30 },
        { frameRate: "24000/1001", expected: 23.976023976023978 },
        { frameRate: "25/1", expected: 25 },
        { frameRate: "0/1", expected: 0 },
        { frameRate: "60", expected: 60 },
        { frameRate: "invalid", expected: 0 },
      ];

      for (const testCase of testCases) {
        ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
          cb(null, {
            streams: [
              {
                codec_type: "video",
                width: 1080,
                height: 1920,
                r_frame_rate: testCase.frameRate,
              },
            ],
            format: {
              duration: "30.0",
              bit_rate: "2500000",
              format_name: "mp4",
            },
          });
        });

        const result = await mediaProcessor.getVideoMetadata("https://example.com/test.mp4");
        const diff = Math.abs(result.frameRate - testCase.expected);
        assert.ok(
          diff < 0.00001,
          `Expected frameRate ~${testCase.expected} for "${testCase.frameRate}", got ${result.frameRate}`
        );
      }
    });
  });

  // =========================================================================
  // validateVideo
  // =========================================================================

  describe("validateVideo", { concurrency: 1 }, () => {
    it("should validate video for STORIES content type", async () => {
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
    });

    it("should pass validation for optimal videos", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
          format: { duration: "30", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const result = await mediaProcessor.validateVideo(
        "https://example.com/optimal-video.mp4",
        "STORIES"
      );

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.issues.length, 0);
    });
  });

  // =========================================================================
  // optimizeForReels
  // =========================================================================

  describe("optimizeForReels", { concurrency: 1 }, () => {
    it("should return original URL if already optimized", async () => {
      // Default mock returns 1080x1920 45.5s -- already optimal aspect ratio
      const videoUrl = "https://example.com/optimal-reel.mp4";
      const optimizedUrl = await mediaProcessor.optimizeForReels(videoUrl);

      assert.strictEqual(optimizedUrl, videoUrl);
    });

    it("should optimize videos exceeding 90-second limit", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1" }],
          format: { duration: "150", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const videoUrl = "https://example.com/very-long-video.mp4";
      const optimizedUrl = await mediaProcessor.optimizeForReels(videoUrl);

      assert.notStrictEqual(optimizedUrl, videoUrl);
    });

    it("should optimize landscape aspect ratio", async () => {
      ffprobeMockFn.mock.mockImplementation((_url: string, cb: (err: any, data: any) => void) => {
        cb(null, {
          streams: [{ codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1" }],
          format: { duration: "30", bit_rate: "2500000", format_name: "mp4" },
        });
      });

      const videoUrl = "https://example.com/landscape.mp4";
      const optimizedUrl = await mediaProcessor.optimizeForReels(videoUrl);

      assert.notStrictEqual(optimizedUrl, videoUrl);
    });
  });
});
