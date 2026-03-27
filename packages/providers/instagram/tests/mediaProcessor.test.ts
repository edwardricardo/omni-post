/**
 * @file mediaProcessor.test.ts
 * @description Tests for InstagramMediaProcessor -- getVideoMetadata,
 *              splitVideoForStories, optimizeForReels, createThumbnail,
 *              and metrics.
 * Framework: vitest + node:assert/strict
 *
 * Tests for validateVideo, error handling, and integration scenarios
 * live in mediaProcessor.validation.test.ts.
 *
 * Mocking: vi.mock() intercepts module-level dependencies
 * (node:child_process, @adapters/external-apis, @adapters/storage-s3, prom-client)
 * so that the processor can be instantiated without real Redis/FFmpeg/S3.
 */

import { describe, it, beforeAll, beforeEach, afterAll, vi } from "vitest";
import assert from "node:assert/strict";

// ── Hoist mock state initialization before vi.mock() factories run ──
const { execFileMockFn, probeDataRef } = vi.hoisted(() => {
  const probeDataRef: { current: any } = {
    current: {
      streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
      format: { duration: "45.5", bit_rate: "2500000", format_name: "mp4,mov" },
    },
  };

  const execFileMockFn = vi.fn(
    (
      cmd: string,
      _args: string[],
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      if (cmd === "ffprobe") {
        const data = probeDataRef.current;
        if (data instanceof Error) {
          callback(data, { stdout: "", stderr: data.message });
        } else {
          callback(null, { stdout: JSON.stringify(data), stderr: "" });
        }
      } else {
        // ffmpeg -- succeed
        callback(null, { stdout: "", stderr: "" });
      }
    }
  );

  return { execFileMockFn, probeDataRef };
});

// ── Hoist mock setup before module evaluation ──

vi.mock("@adapters/external-apis", () => ({
  createExternalApiCircuitBreaker: () => ({
    call: async (_svc: string, _op: string, fn: (...a: any[]) => Promise<any>) => fn(),
    getAllStatuses: () => ({}),
  }),
  resetExternalApiCircuitBreaker: async () => undefined,
}));

vi.mock("@adapters/storage-s3", () => ({
  createS3StorageAdapter: () => ({
    generateUploadSignature: async () => ({
      ok: true as const,
      value: {
        url: "https://s3.amazonaws.com/bucket/",
        fields: { key: "test-key" },
      },
    }),
  }),
}));

vi.mock("prom-client", () => ({
  default: {
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
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMockFn,
}));

vi.mock("fs", () => ({
  promises: {
    readFile: async () => Buffer.from("fake-video-data"),
    unlink: async () => undefined,
    writeFile: async () => undefined,
  },
  readFileSync: () => Buffer.from("fake-data"),
  existsSync: () => true,
  default: {
    promises: {
      readFile: async () => Buffer.from("fake-video-data"),
      unlink: async () => undefined,
      writeFile: async () => undefined,
    },
    readFileSync: () => Buffer.from("fake-data"),
    existsSync: () => true,
  },
}));

// Static import after mocks are registered (Vitest hoists vi.mock calls before imports)
import { InstagramMediaProcessor } from "../src/mediaProcessor.js";

describe("InstagramMediaProcessor", { concurrent: false }, () => {
  let mediaProcessor: any;

  beforeAll(() => {
    // Mock globalThis.fetch so S3 upload requests don't hit the network
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200, statusText: "OK" })
    );

    // Set required env vars
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_S3_BUCKET = "test-bucket";
  });

  beforeEach(() => {
    mediaProcessor = new InstagramMediaProcessor("https://test-storage.com");

    // Reset probe data to defaults for each test
    probeDataRef.current = {
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
    };

    // Reset the execFile mock implementation to default
    execFileMockFn.mockImplementation(
      (
        cmd: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        if (cmd === "ffprobe") {
          const data = probeDataRef.current;
          if (data instanceof Error) {
            callback(data, { stdout: "", stderr: data.message });
          } else {
            callback(null, { stdout: JSON.stringify(data), stderr: "" });
          }
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      }
    );
  });

  afterAll(() => {
    // Cleanup env vars
    delete process.env.AWS_REGION;
    delete process.env.AWS_S3_BUCKET;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // getVideoMetadata
  // =========================================================================

  describe("getVideoMetadata", { concurrent: false }, () => {
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
      execFileMockFn.mockImplementation(
        (
          cmd: string,
          _args: string[],
          callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
        ) => {
          if (cmd === "ffprobe") {
            callback(new Error("File not found"), { stdout: "", stderr: "File not found" });
          } else {
            callback(null, { stdout: "", stderr: "" });
          }
        }
      );

      await assert.rejects(
        async () => mediaProcessor.getVideoMetadata("https://example.com/non-existent-video.mp4"),
        (err: any) => {
          assert.ok(err.message.includes("File not found"));
          return true;
        }
      );
    });

    it("should handle videos without video stream", async () => {
      probeDataRef.current = {
        streams: [{ codec_type: "audio" }],
        format: { duration: "30.0", bit_rate: "128000" },
      };

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
        probeDataRef.current = {
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
        };

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

  describe("validateVideo", { concurrent: false }, () => {
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
      probeDataRef.current = {
        streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
        format: { duration: "120", bit_rate: "2500000", format_name: "mp4" },
      };

      const result = await mediaProcessor.validateVideo(
        "https://example.com/long-story.mp4",
        "STORIES"
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.includes("Stories videos must be 60 seconds or less"));
    });

    it("should detect duration issues for REELS", async () => {
      probeDataRef.current = {
        streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
        format: { duration: "120", bit_rate: "2500000", format_name: "mp4" },
      };

      const result = await mediaProcessor.validateVideo(
        "https://example.com/long-reel.mp4",
        "REELS"
      );

      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.includes("Reels videos must be 90 seconds or less"));
    });

    it("should pass validation for optimal videos", async () => {
      probeDataRef.current = {
        streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
        format: { duration: "30", bit_rate: "2500000", format_name: "mp4" },
      };

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

  describe("optimizeForReels", { concurrent: false }, () => {
    it("should return original URL if already optimized", async () => {
      // Default mock returns 1080x1920 45.5s -- already optimal aspect ratio
      const videoUrl = "https://example.com/optimal-reel.mp4";
      const optimizedUrl = await mediaProcessor.optimizeForReels(videoUrl);

      assert.strictEqual(optimizedUrl, videoUrl);
    });

    it("should optimize videos exceeding 90-second limit", async () => {
      probeDataRef.current = {
        streams: [{ codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1" }],
        format: { duration: "150", bit_rate: "2500000", format_name: "mp4" },
      };

      const videoUrl = "https://example.com/very-long-video.mp4";
      const optimizedUrl = await mediaProcessor.optimizeForReels(videoUrl);

      assert.notStrictEqual(optimizedUrl, videoUrl);
    });

    it("should optimize landscape aspect ratio", async () => {
      probeDataRef.current = {
        streams: [{ codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1" }],
        format: { duration: "30", bit_rate: "2500000", format_name: "mp4" },
      };

      const videoUrl = "https://example.com/landscape.mp4";
      const optimizedUrl = await mediaProcessor.optimizeForReels(videoUrl);

      assert.notStrictEqual(optimizedUrl, videoUrl);
    });
  });
});
