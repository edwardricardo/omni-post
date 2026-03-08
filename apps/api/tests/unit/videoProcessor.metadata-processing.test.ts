import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  VideoProcessor,
  type VideoProcessingOptions,
  type ProcessingProgress,
} from "../../src/video/videoProcessor";
import {
  spawnResponseQueue,
  mockSpawnState,
  queueSpawnResponses,
  createMockSpawn,
  mockFsData,
  setupFsMocks,
  setStatSizeOverride,
} from "./videoProcessor.test-helpers";

describe("VideoProcessor - Metadata Extraction", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    // Initialise queue with a default empty response so setters work
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should extract video metadata successfully", async () => {
    const probeOutput = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
          color_space: "bt709",
        },
        {
          codec_type: "audio",
          codec_name: "aac",
        },
      ],
      format: {
        duration: "120.5",
        bit_rate: "5000000",
        size: "75000000",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const metadata = await processor.getVideoMetadata("/test/video.mp4");

    assert.equal(metadata.duration, 120.5);
    assert.equal(metadata.width, 1920);
    assert.equal(metadata.height, 1080);
    assert.equal(metadata.fps, 30);
    assert.equal(metadata.bitrate, 5000000);
    assert.equal(metadata.codec, "h264");
    assert.equal(metadata.audioCodec, "aac");
    assert.equal(metadata.fileSize, 75000000);
    assert.equal(metadata.aspectRatio, "16:9");
    assert.equal(metadata.hasAudio, true);
    assert.equal(metadata.hasVideo, true);
    assert.ok(metadata.colorSpace);
  });

  it("should handle video without audio stream", async () => {
    const probeOutput = {
      streams: [
        {
          codec_type: "video",
          codec_name: "vp9",
          width: 1280,
          height: 720,
          r_frame_rate: "60/1",
        },
      ],
      format: {
        duration: "30.0",
        bit_rate: "3000000",
        size: "11250000",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const metadata = await processor.getVideoMetadata("/test/silent-video.mp4");

    assert.equal(metadata.hasAudio, false);
    assert.equal(metadata.audioCodec, "none");
    assert.equal(metadata.hasVideo, true);
  });

  it("should parse fractional frame rates correctly", async () => {
    const probeOutput = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30000/1001", // 29.97 fps
        },
      ],
      format: {
        duration: "60.0",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    const metadata = await processor.getVideoMetadata("/test/ntsc-video.mp4");

    assert.ok(Math.abs(metadata.fps - 29.97) < 0.01);
  });

  it("should calculate aspect ratio correctly", async () => {
    const testCases = [
      { width: 1920, height: 1080, expected: "16:9" },
      { width: 1280, height: 720, expected: "16:9" },
      { width: 1080, height: 1920, expected: "9:16" },
      { width: 1080, height: 1080, expected: "1:1" },
    ];

    for (const testCase of testCases) {
      const probeOutput = {
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: testCase.width,
            height: testCase.height,
            r_frame_rate: "30/1",
          },
        ],
        format: { duration: "10.0" },
      };

      mockSpawnState.stdout = JSON.stringify(probeOutput);
      mockSpawnState.stderr = "";
      mockSpawnState.exitCode = 0;

      const metadata = await processor.getVideoMetadata("/test/video.mp4");
      assert.equal(metadata.aspectRatio, testCase.expected);
    }
  });

  it("should handle ffprobe errors", async () => {
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "Invalid data found when processing input";
    mockSpawnState.exitCode = 1;

    await assert.rejects(
      async () => {
        await processor.getVideoMetadata("/test/invalid-video.mp4");
      },
      {
        message: /ffprobe failed/,
      }
    );
  });

  it("should handle missing video stream", async () => {
    const probeOutput = {
      streams: [
        {
          codec_type: "audio",
          codec_name: "aac",
        },
      ],
      format: {
        duration: "60.0",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    await assert.rejects(
      async () => {
        await processor.getVideoMetadata("/test/audio-only.m4a");
      },
      {
        message: /No video stream found/,
      }
    );
  });
});

describe("VideoProcessor - Video Processing", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should process video with basic options", async () => {
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
        duration: "60.0",
        bit_rate: "5000000",
        size: "37500000",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr = "frame=1800 fps=30 time=00:01:00.00";
    mockSpawnState.exitCode = 0;

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/output.mp4", true);

    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/output.mp4",
      format: "mp4",
      quality: "medium",
      resolution: "1080p",
      videoCodec: "h264",
      audioCodec: "aac",
    };

    const result = await processor.processVideo(options);

    assert.equal(result.status, "completed");
    assert.equal(result.progress, 100);
    assert.equal(result.outputPath, "/test/output.mp4");
    assert.ok(result.jobId);
  });

  it("should track processing progress", async () => {
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
        duration: "120.0",
        bit_rate: "5000000",
      },
    };

    mockSpawnState.stdout = JSON.stringify(probeOutput);
    mockSpawnState.stderr =
      "time=00:00:30.00\ntime=00:01:00.00\ntime=00:01:30.00\ntime=00:02:00.00";
    mockSpawnState.exitCode = 0;

    mockFsData.files.set("/test/progress-input.mp4", true);
    mockFsData.files.set("/test/progress-output.mp4", true);

    const progressUpdates: ProcessingProgress[] = [];

    const options: VideoProcessingOptions = {
      inputPath: "/test/progress-input.mp4",
      outputPath: "/test/progress-output.mp4",
      format: "mp4",
      quality: "medium",
    };

    await processor.processVideo(options, (progress) => {
      progressUpdates.push({ ...progress });
    });

    assert.ok(progressUpdates.length > 0);
    assert.ok(progressUpdates.some((p) => p.stage === "Analyzing input video"));
    assert.ok(progressUpdates.some((p) => p.stage === "Processing video"));
    assert.ok(progressUpdates.some((p) => p.status === "completed"));
  });

  it("should handle processing errors", async () => {
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
        duration: "60.0",
      },
    };

    // First spawn (ffprobe) succeeds with JSON, second spawn (ffmpeg) fails
    queueSpawnResponses(
      { stdout: JSON.stringify(probeOutput), stderr: "", exitCode: 0 },
      { stdout: "", stderr: "Conversion failed!", exitCode: 1 }
    );

    mockFsData.files.set("/test/error-input.mp4", true);

    const options: VideoProcessingOptions = {
      inputPath: "/test/error-input.mp4",
      outputPath: "/test/error-output.mp4",
      format: "mp4",
      quality: "medium",
    };

    await assert.rejects(
      async () => {
        await processor.processVideo(options);
      },
      {
        message: /FFmpeg failed/,
      }
    );
  });
});

describe("VideoProcessor - Codec Options", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should support H.264 codec", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/h264-output.mp4",
      format: "mp4",
      quality: "high",
      videoCodec: "h264",
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/h264-output.mp4", true);

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

  it("should support H.265/HEVC codec", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/h265-output.mp4",
      format: "mp4",
      quality: "ultra",
      videoCodec: "h265",
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/h265-output.mp4", true);

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

  it("should support VP9 codec", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/vp9-output.webm",
      format: "webm",
      quality: "high",
      videoCodec: "vp9",
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/vp9-output.webm", true);

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

  it("should support different audio codecs", async () => {
    const audioCodecs: Array<VideoProcessingOptions["audioCodec"]> = ["aac", "mp3", "opus"];

    for (const audioCodec of audioCodecs) {
      const options: VideoProcessingOptions = {
        inputPath: "/test/input.mp4",
        outputPath: `/test/audio-${audioCodec}.mp4`,
        format: "mp4",
        quality: "medium",
        audioCodec,
      };

      mockFsData.files.set("/test/input.mp4", true);
      mockFsData.files.set(`/test/audio-${audioCodec}.mp4`, true);

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
    }
  });
});

describe("VideoProcessor - Resolution and Quality", { concurrency: 1 }, () => {
  let processor: VideoProcessor;

  beforeEach((t) => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks(t);
  });

  it("should support different resolutions", async () => {
    const resolutions: Array<VideoProcessingOptions["resolution"]> = [
      "720p",
      "1080p",
      "1440p",
      "4k",
    ];

    for (const resolution of resolutions) {
      const options: VideoProcessingOptions = {
        inputPath: "/test/input.mp4",
        outputPath: `/test/output-${resolution}.mp4`,
        format: "mp4",
        quality: "medium",
        resolution,
      };

      mockFsData.files.set("/test/input.mp4", true);
      mockFsData.files.set(`/test/output-${resolution}.mp4`, true);

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
    }
  });

  it("should support different quality presets", async () => {
    const qualities: Array<VideoProcessingOptions["quality"]> = ["low", "medium", "high", "ultra"];

    for (const quality of qualities) {
      const options: VideoProcessingOptions = {
        inputPath: "/test/input.mp4",
        outputPath: `/test/output-${quality}.mp4`,
        format: "mp4",
        quality,
      };

      mockFsData.files.set("/test/input.mp4", true);
      mockFsData.files.set(`/test/output-${quality}.mp4`, true);

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
    }
  });

  it("should support custom bitrate", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/custom-bitrate.mp4",
      format: "mp4",
      quality: "medium",
      bitrate: 8000, // 8 Mbps
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/custom-bitrate.mp4", true);

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

  it("should support custom FPS", async () => {
    const options: VideoProcessingOptions = {
      inputPath: "/test/input.mp4",
      outputPath: "/test/custom-fps.mp4",
      format: "mp4",
      quality: "medium",
      fps: 60,
    };

    mockFsData.files.set("/test/input.mp4", true);
    mockFsData.files.set("/test/custom-fps.mp4", true);

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
