/**
 * @file videoProcessor.metadata-processing.test.ts
 * @description Tests for VideoProcessor - Metadata Extraction
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import {
  VideoProcessor,
  type VideoProcessingOptions,
  type ProcessingProgress,
} from "../../src/video/videoProcessor.js";
import {
  spawnResponseQueue,
  mockSpawnState,
  queueSpawnResponses,
  createMockSpawn,
  mockFsData,
  setupFsMocks,
  setStatSizeOverride,
} from "./videoProcessor.test-helpers.js";

describe("VideoProcessor - Metadata Extraction", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    // Initialise queue with a default empty response so setters work
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
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

    expect(metadata.duration).toBe(120.5);
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
    expect(metadata.fps).toBe(30);
    expect(metadata.bitrate).toBe(5000000);
    expect(metadata.codec).toBe("h264");
    expect(metadata.audioCodec).toBe("aac");
    expect(metadata.fileSize).toBe(75000000);
    expect(metadata.aspectRatio).toBe("16:9");
    expect(metadata.hasAudio).toBe(true);
    expect(metadata.hasVideo).toBe(true);
    expect(metadata.colorSpace).toBeTruthy();
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

    expect(metadata.hasAudio).toBe(false);
    expect(metadata.audioCodec).toBe("none");
    expect(metadata.hasVideo).toBe(true);
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

    expect(Math.abs(metadata.fps - 29.97) < 0.01).toBeTruthy();
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
      expect(metadata.aspectRatio).toBe(testCase.expected);
    }
  });

  it("should handle ffprobe errors", async () => {
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "Invalid data found when processing input";
    mockSpawnState.exitCode = 1;

    await expect(processor.getVideoMetadata("/test/invalid-video.mp4")).rejects.toThrow(
      /ffprobe failed/
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

    await expect(processor.getVideoMetadata("/test/audio-only.m4a")).rejects.toThrow(
      /No video stream found/
    );
  });
});

describe("VideoProcessor - Video Processing", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
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

    expect(result.status).toBe("completed");
    expect(result.progress).toBe(100);
    expect(result.outputPath).toBe("/test/output.mp4");
    expect(result.jobId).toBeTruthy();
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

    expect(progressUpdates.length > 0).toBeTruthy();
    expect(progressUpdates.some((p) => p.stage === "Analyzing input video")).toBeTruthy();
    expect(progressUpdates.some((p) => p.stage === "Processing video")).toBeTruthy();
    expect(progressUpdates.some((p) => p.status === "completed")).toBeTruthy();
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

    await expect(processor.processVideo(options)).rejects.toThrow(/FFmpeg failed/);
  });
});

describe("VideoProcessor - Codec Options", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
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
    expect(result.status).toBe("completed");
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
    expect(result.status).toBe("completed");
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
    expect(result.status).toBe("completed");
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
      expect(result.status).toBe("completed");
    }
  });
});

describe("VideoProcessor - Resolution and Quality", () => {
  let processor: VideoProcessor;

  beforeEach(() => {
    spawnResponseQueue.length = 0;
    spawnResponseQueue.push({ stdout: "", stderr: "", exitCode: 0 });
    setStatSizeOverride(null);
    mockFsData.files.clear();
    processor = new VideoProcessor(createMockSpawn());
    setupFsMocks();
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
      expect(result.status).toBe("completed");
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
      expect(result.status).toBe("completed");
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
    expect(result.status).toBe("completed");
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
    expect(result.status).toBe("completed");
  });
});
