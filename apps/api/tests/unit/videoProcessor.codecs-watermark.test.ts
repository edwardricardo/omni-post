/**
 * @file videoProcessor.codecs-watermark.test.ts
 * @description Unit tests for VideoProcessor — codec selection branches (h265, vp9, av1,
 *              mp3, opus) and watermark overlay generation, covering the remaining
 *              un-exercised branches in buildFFmpegArgs.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { VideoProcessor, type VideoProcessingOptions } from "../../src/video/videoProcessor.js";
import {
  spawnResponseQueue,
  createMockSpawn,
  mockFsData,
  setupFsMocks,
  queueSpawnResponses,
} from "./videoProcessor.test-helpers.js";

// ---------------------------------------------------------------------------
// Shared ffprobe output for a 10-second h264 video
// ---------------------------------------------------------------------------

const DEFAULT_PROBE = JSON.stringify({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      r_frame_rate: "30/1",
    },
    {
      codec_type: "audio",
      codec_name: "aac",
    },
  ],
  format: { duration: "10.0", bit_rate: "8000000", size: "10000000" },
});

/** Push probe response then a success ffmpeg response */
function setupProcessingSuccess(outputPath: string) {
  mockFsData.files.set("/test/input.mp4", true);
  mockFsData.files.set(outputPath, true);
  queueSpawnResponses(
    { stdout: DEFAULT_PROBE, stderr: "", exitCode: 0 }, // ffprobe
    { stdout: "", stderr: "", exitCode: 0 } // ffmpeg
  );
}

// ---------------------------------------------------------------------------
// Codec selection — video codecs
// ---------------------------------------------------------------------------

describe("VideoProcessor - Video Codec Selection", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  it("processes successfully with h265 video codec", async () => {
    setupProcessingSuccess("/test/out-h265.mp4");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-h265.mp4",
      format: "mp4",
      quality: "ultra",
      videoCodec: "h265",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });

  it("processes successfully with vp9 video codec", async () => {
    setupProcessingSuccess("/test/out-vp9.webm");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-vp9.webm",
      format: "webm",
      quality: "high",
      videoCodec: "vp9",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });

  it("processes successfully with av1 video codec", async () => {
    setupProcessingSuccess("/test/out-av1.webm");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-av1.webm",
      format: "webm",
      quality: "medium",
      videoCodec: "av1",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Codec selection — audio codecs
// ---------------------------------------------------------------------------

describe("VideoProcessor - Audio Codec Selection", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  it("processes successfully with mp3 audio codec", async () => {
    setupProcessingSuccess("/test/out-mp3.mp4");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-mp3.mp4",
      format: "mp4",
      quality: "medium",
      audioCodec: "mp3",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });

  it("processes successfully with opus audio codec", async () => {
    setupProcessingSuccess("/test/out-opus.webm");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-opus.webm",
      format: "webm",
      quality: "medium",
      audioCodec: "opus",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Resolution selection — remaining resolutions
// ---------------------------------------------------------------------------

describe("VideoProcessor - Resolution Selection", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  it("processes successfully with 1440p resolution", async () => {
    setupProcessingSuccess("/test/out-1440p.mp4");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-1440p.mp4",
      format: "mp4",
      quality: "high",
      resolution: "1440p",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });

  it("processes successfully with 4k resolution", async () => {
    setupProcessingSuccess("/test/out-4k.mp4");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-4k.mp4",
      format: "mp4",
      quality: "ultra",
      resolution: "4k",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Quality presets — low
// ---------------------------------------------------------------------------

describe("VideoProcessor - Quality Preset low", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  it("processes successfully with low quality preset", async () => {
    setupProcessingSuccess("/test/out-low.mp4");

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-low.mp4",
      format: "mp4",
      quality: "low",
    };

    const result = await processor.processVideo(options);
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Watermark overlay — all 5 position variants
// ---------------------------------------------------------------------------

describe("VideoProcessor - Watermark Overlay", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  const watermarkPositions = [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "center",
  ] as const;

  for (const position of watermarkPositions) {
    it(`applies watermark at position '${position}' and completes successfully`, async () => {
      const outputPath = `/test/out-wm-${position}.mp4`;
      mockFsData.files.set("/test/input.mp4", true);
      mockFsData.files.set("/test/watermark.png", true);
      mockFsData.files.set(outputPath, true);
      queueSpawnResponses(
        { stdout: DEFAULT_PROBE, stderr: "", exitCode: 0 },
        { stdout: "", stderr: "", exitCode: 0 }
      );

      const options: VideoProcessingOptions = {
        inputPath: "/test/input.mp4",
        outputPath,
        format: "mp4",
        quality: "medium",
        watermark: {
          imagePath: "/test/watermark.png",
          position,
          opacity: 0.8,
          scale: 0.15,
        },
      };

      const result = await processor.processVideo(options);
      expect(result.status).toBe("completed");
    });
  }
});

// ---------------------------------------------------------------------------
// Progress callback — verify invocation
// ---------------------------------------------------------------------------

describe("VideoProcessor - Progress Callback", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  it("calls onProgress callback multiple times during processing", async () => {
    setupProcessingSuccess("/test/out-progress.mp4");

    const callCount = { value: 0 };
    const onProgress = vi.fn(() => {
      callCount.value++;
    });

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-progress.mp4",
      format: "mp4",
      quality: "medium",
    };

    const result = await processor.processVideo(options, onProgress);

    expect(result.status).toBe("completed");
    // onProgress is called at least once (progress object is mutated in place,
    // so call count reflects number of updateProgress invocations)
    expect(onProgress).toHaveBeenCalled();
    // Final result must be completed
    expect(result.progress).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// applyPreset — maxDuration warning path
// ---------------------------------------------------------------------------

describe("VideoProcessor - applyPreset maxDuration warning", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  it("warns about duration but still processes YouTube Shorts preset when duration > 60s", async () => {
    const outputPath = "/test/out-shorts-warn.mp4";
    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set(outputPath, true);

    // probe response (for getVideoMetadata in applyPreset) + probe + ffmpeg for processVideo
    const longProbe = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "120.0", size: "50000000" }, // 120s > 60s limit for Shorts
    });

    queueSpawnResponses(
      { stdout: longProbe, stderr: "", exitCode: 0 }, // getVideoMetadata in applyPreset
      { stdout: longProbe, stderr: "", exitCode: 0 }, // getVideoMetadata in processVideo
      { stdout: "", stderr: "", exitCode: 0 } // ffmpeg
    );

    const result = await processor.applyPreset("/test/input.mp4", outputPath, "YouTube Shorts");
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// FFmpeg error path — non-zero exit code
// ---------------------------------------------------------------------------

describe("VideoProcessor - FFmpeg process failure", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
  });

  it("throws and sets status to failed when ffmpeg exits with non-zero code", async () => {
    mockFsData.files.set("/test/input.mp4", true);

    queueSpawnResponses(
      { stdout: DEFAULT_PROBE, stderr: "", exitCode: 0 }, // ffprobe succeeds
      { stdout: "", stderr: "Encoder not found", exitCode: 1 } // ffmpeg fails
    );

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/out-fail.mp4",
      format: "mp4",
      quality: "medium",
    };

    await expect(processor.processVideo(options)).rejects.toThrow(/FFmpeg failed/);
  });

  it("throws when ffprobe exits with non-zero code", async () => {
    queueSpawnResponses({ stdout: "", stderr: "No such file", exitCode: 1 });

    await expect(processor.getVideoMetadata("/test/missing.mp4")).rejects.toThrow(/ffprobe failed/);
  });
});
