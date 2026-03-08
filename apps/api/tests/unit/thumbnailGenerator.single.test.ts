/**
 * Unit Tests for ThumbnailGenerator -- Single Thumbnail Generation
 * Tests basic generateThumbnail() for jpg/png/webp, filters, ffmpeg failure,
 * checksum calculation, and processing-time recording.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ThumbnailGenerator, type ThumbnailOptions } from "../../src/video/thumbnailGenerator";
import { promises as fs } from "fs";
import {
  mockSpawnState,
  createMockSpawn,
  mockFsData,
  setupFsMocks,
} from "./thumbnailGenerator.test-helpers";

describe("ThumbnailGenerator - Single Thumbnail Generation", { concurrency: 1 }, () => {
  let generator: ThumbnailGenerator;

  beforeEach((t) => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(t, fs);
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

    assert.strictEqual(typeof result, "object", "result should be a ThumbnailResult object");
    assert.ok(
      typeof result.id === "string" && result.id.length > 0,
      "result should have a non-empty id"
    );
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.equal(result.format, "jpg");
    assert.equal(result.quality, 85);
    assert.equal(result.timestamp, 5);
    assert.equal(result.inputVideoPath, videoPath);
    assert.equal(result.outputPath, outputPath);
    assert.ok(
      typeof result.checksum === "string" && result.checksum.length > 0,
      "result should have a non-empty checksum"
    );
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

    assert.equal(result.format, "png");
    assert.equal(result.width, 1920);
    assert.equal(result.height, 1080);
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

    assert.equal(result.format, "webp");
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

    assert.strictEqual(typeof result, "object", "result should be a ThumbnailResult object");
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.width, 1280, "width should match requested dimensions");
    assert.equal(result.height, 720, "height should match requested dimensions");
    assert.ok(
      typeof result.id === "string" && result.id.length > 0,
      "result should have a non-empty id"
    );
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

    assert.strictEqual(typeof result, "object", "result should be a ThumbnailResult object");
    assert.equal(result.width, 1280, "width should match requested dimensions");
    assert.equal(result.height, 720, "height should match requested dimensions");
    assert.equal(result.format, "jpg", "format should match requested format");
    assert.ok(
      typeof result.id === "string" && result.id.length > 0,
      "result should have a non-empty id"
    );
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

    await assert.rejects(
      async () => {
        await generator.generateThumbnail("/invalid/video.mp4", "/test/output.jpg", options);
      },
      {
        message: /FFmpeg failed/,
      }
    );
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

    assert.ok(result.checksum);
    assert.equal(typeof result.checksum, "string");
    assert.equal(result.checksum.length, 32); // MD5 hex length
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

    assert.ok(result.processingTime >= 0);
    assert.equal(typeof result.processingTime, "number");
  });
});
