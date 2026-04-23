/**
 * Unit Tests for ThumbnailGenerator -- Single Thumbnail Generation
 * Tests basic generateThumbnail() for jpg/png/webp, filters, ffmpeg failure,
 * checksum calculation, and processing-time recording.
 *
 * @file thumbnailGenerator.single.test.ts
 * @description Tests for ThumbnailGenerator - Single Thumbnail Generation
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { ThumbnailGenerator, type ThumbnailOptions } from "../../src/video/thumbnailGenerator";
import { promises as fs } from "fs";
import {
  mockSpawnState,
  createMockSpawn,
  mockFsData,
  setupFsMocks,
} from "./thumbnailGenerator.test-helpers";

describe("ThumbnailGenerator - Single Thumbnail Generation", () => {
  let generator: ThumbnailGenerator;

  beforeEach(() => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(fs);
  });

  it("should generate thumbnail with basic options", async () => {
    const videoPath = "/test/video.mp4";
    const outputPath = "/test/thumbnail.jpg";
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
      timestamp: 5,
    };

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "frame=1 fps=0.0 q=2.0 Lsize=N/A time=00:00:00.04 bitrate=N/A";
    mockSpawnState.exitCode = 0;

    const thumbnailData = Buffer.from("fake-jpeg-data");
    mockFsData.files.set(outputPath, thumbnailData);
    mockFsData.stats.set(outputPath, { size: thumbnailData.length, mtime: new Date() });

    const result = await generator.generateThumbnail(videoPath, outputPath, options);

    expect(typeof result).toBe("object");
    expect(typeof result.id === "string" && result.id.length > 0).toBeTruthy();
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.format).toBe("jpg");
    expect(result.quality).toBe(85);
    expect(result.timestamp).toBe(5);
    expect(result.inputVideoPath).toBe(videoPath);
    expect(result.outputPath).toBe(outputPath);
    expect(typeof result.checksum === "string" && result.checksum.length > 0).toBeTruthy();
  });

  it("should generate PNG thumbnail", async () => {
    const options: ThumbnailOptions = {
      width: 1920,
      height: 1080,
      quality: 95,
      format: "png",
      timestamp: 10,
    };

    const outputPath = "/test/thumbnail.png";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("png-data"));
    mockFsData.stats.set(outputPath, { size: 50000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(result.format).toBe("png");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it("should generate WebP thumbnail", async () => {
    const options: ThumbnailOptions = {
      width: 854,
      height: 480,
      quality: 75,
      format: "webp",
    };

    const outputPath = "/test/thumbnail.webp";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("webp-data"));
    mockFsData.stats.set(outputPath, { size: 30000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(result.format).toBe("webp");
  });

  it("should apply brightness filter", async () => {
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
      filters: {
        brightness: 20,
      },
    };

    const outputPath = "/test/thumbnail-bright.jpg";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("jpeg-data"));
    mockFsData.stats.set(outputPath, { size: 100000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(typeof result).toBe("object");
    expect(result.outputPath).toBe(outputPath);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(typeof result.id === "string" && result.id.length > 0).toBeTruthy();
  });

  it("should apply multiple filters", async () => {
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
      filters: {
        brightness: 10,
        contrast: 15,
        saturation: 20,
        sharpen: true,
      },
    };

    const outputPath = "/test/thumbnail-filtered.jpg";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("jpeg-data"));
    mockFsData.stats.set(outputPath, { size: 100000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(typeof result).toBe("object");
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.format).toBe("jpg");
    expect(typeof result.id === "string" && result.id.length > 0).toBeTruthy();
  });

  it("should handle ffmpeg failure", async () => {
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
    };

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "Invalid input file";
    mockSpawnState.exitCode = 1;

    await expect(
      generator.generateThumbnail("/invalid/video.mp4", "/test/output.jpg", options)
    ).rejects.toThrow(/FFmpeg failed/);
  });

  it("should calculate file checksum", async () => {
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
    };

    const outputPath = "/test/checksum-test.jpg";
    const thumbnailData = Buffer.from("test-thumbnail-data");
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, thumbnailData);
    mockFsData.stats.set(outputPath, { size: thumbnailData.length, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(result.checksum).toBeTruthy();
    expect(typeof result.checksum).toBe("string");
    expect(result.checksum.length).toBe(32); // MD5 hex length
  });

  it("should record processing time", async () => {
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
    };

    const outputPath = "/test/timing-test.jpg";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("data"));
    mockFsData.stats.set(outputPath, { size: 50000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(result.processingTime >= 0).toBeTruthy();
    expect(typeof result.processingTime).toBe("number");
  });
});
