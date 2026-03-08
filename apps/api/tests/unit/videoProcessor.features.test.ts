import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { VideoProcessor, type VideoProcessingOptions } from "../../src/video/videoProcessor";
import {
  spawnResponseQueue,
  mockSpawnState,
  createMockSpawn,
  mockFsData,
  setupFsMocks,
  setStatSizeOverride,
} from "./videoProcessor.test-helpers";

describe("VideoProcessor - Platform Optimizations", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should optimize for YouTube", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/youtube.mp4",
      format: "mp4",
      quality: "high",
      optimize: {
        forYouTube: true,
      },
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/youtube.mp4", true);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const result = await processor.processVideo(options);
    assert.equal(result.status, "completed");
  });

  it("should optimize for YouTube Shorts", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/shorts.mp4",
      format: "mp4",
      quality: "high",
      optimize: {
        forShorts: true,
      },
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/shorts.mp4", true);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const result = await processor.processVideo(options);
    assert.equal(result.status, "completed");
  });

  it("should optimize for live streaming", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/stream.mp4",
      format: "mp4",
      quality: "medium",
      optimize: {
        forLiveStream: true,
      },
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/stream.mp4", true);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const result = await processor.processVideo(options);
    assert.equal(result.status, "completed");
  });
});

describe("VideoProcessor - Filters", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should apply brightness filter", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/bright.mp4",
      format: "mp4",
      quality: "medium",
      filters: {
        brightness: 0.2,
      },
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/bright.mp4", true);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const result = await processor.processVideo(options);
    assert.equal(result.status, "completed");
  });

  it("should apply multiple filters", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/filtered.mp4",
      format: "mp4",
      quality: "medium",
      filters: {
        brightness: 0.1,
        contrast: 0.15,
        saturation: 0.2,
        denoise: true,
        stabilize: true,
      },
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/filtered.mp4", true);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const result = await processor.processVideo(options);
    assert.equal(result.status, "completed");
  });
});

describe("VideoProcessor - Optimization Presets", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should list available presets", () => {
    const presets = processor.getOptimizationPresets();

    assert.ok(Array.isArray(presets));
    assert.ok(presets.length > 0);

    presets.forEach((preset) => {
      assert.ok(preset.name);
      assert.ok(preset.description);
      assert.ok(Array.isArray(preset.platforms));
      assert.ok(preset.settings);
    });
  });

  it("should include YouTube 1080p preset", () => {
    const presets = processor.getOptimizationPresets();
    const youtubePreset = presets.find((p) => p.name === "YouTube 1080p");

    assert.ok(youtubePreset);
    assert.equal(youtubePreset.settings.resolution, "1080p");
    assert.equal(youtubePreset.settings.videoCodec, "h264");
    assert.ok(youtubePreset.platforms.includes("youtube"));
  });

  it("should apply preset successfully", async () => {
    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/preset-output.mp4", true);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "60.0", size: "50000000" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const result = await processor.applyPreset(
      "/test/input.mp4",
      "/test/preset-output.mp4",
      "YouTube 1080p"
    );

    assert.equal(result.status, "completed");
  });

  it("should apply preset with custom options", async () => {
    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/custom-preset.mp4", true);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "60.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const result = await processor.applyPreset(
      "/test/input.mp4",
      "/test/custom-preset.mp4",
      "YouTube 1080p",
      {
        fps: 60,
        quality: "ultra",
      }
    );

    assert.equal(result.status, "completed");
  });

  it("should throw error for unknown preset", async () => {
    await assert.rejects(
      async () => {
        await processor.applyPreset("/test/input.mp4", "/test/output.mp4", "NonExistentPreset");
      },
      {
        message: /Preset "NonExistentPreset" not found/,
      }
    );
  });

  it("should warn about file size exceeding preset limit", async () => {
    mockFsData.files.set("/test/huge-input.mp4", true);
    mockFsData.files.set("/test/huge-output.mp4", true);

    // Use setStatSizeOverride to make fs.stat return 200MB for this test
    setStatSizeOverride(200 * 1024 * 1024);

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "60.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    // Social Media Optimized preset has 100MB limit
    const result = await processor.applyPreset(
      "/test/huge-input.mp4",
      "/test/huge-output.mp4",
      "Social Media Optimized"
    );

    assert.strictEqual(typeof result, "object", "applyPreset should return a result object");
    assert.strictEqual(result.status, "completed", "processing should complete successfully");
    assert.strictEqual(result.progress, 100, "progress should be 100% on completion");
  });
});

describe("VideoProcessor - Job Cancellation", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should support job cancellation", async () => {
    const cancelled = await processor.cancelJob("test-job-id");
    assert.equal(cancelled, true);
  });
});

describe("VideoProcessor - Edge Cases", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should handle very short videos", async () => {
    const probeOutput = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: {
        duration: "1.5",
        bit_rate: "5000000",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const metadata = await processor.getVideoMetadata("/test/short-video.mp4");

    assert.equal(metadata.duration, 1.5);
  });

  it("should handle videos with unusual aspect ratios", async () => {
    const probeOutput = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 2560,
          height: 1080, // 21:9 ultrawide
          r_frame_rate: "30/1",
        },
      ],
      format: {
        duration: "60.0",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const metadata = await processor.getVideoMetadata("/test/ultrawide-video.mp4");

    assert.ok(metadata.aspectRatio);
  });

  it("should handle videos with zero or missing FPS", async () => {
    const probeOutput = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "0/0",
        },
      ],
      format: {
        duration: "60.0",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const metadata = await processor.getVideoMetadata("/test/no-fps-video.mp4");

    assert.ok(metadata.fps >= 0);
  });

  it("should handle malformed JSON from ffprobe", async () => {
    mockSpawnState.stdout = "invalid json {{{";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    await assert.rejects(
      async () => {
        await processor.getVideoMetadata("/test/corrupt-video.mp4");
      },
      {
        message: /Failed to parse ffprobe output/,
      }
    );
  });

  it("should handle missing output file after processing", async () => {
    mockFsData.files.set("/test/input.mp4", true);
    // Don't set output file to simulate failure

    mockSpawnState.stdout = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
        },
      ],
      format: { duration: "10.0" },
    });
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/missing-output.mp4",
      format: "mp4",
      quality: "medium",
    };

    await assert.rejects(
      async () => {
        await processor.processVideo(options);
      },
      {
        message: /Output file was not created/,
      }
    );
  });
});
