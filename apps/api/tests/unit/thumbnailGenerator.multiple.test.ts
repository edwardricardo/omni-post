/**
 * Unit Tests for ThumbnailGenerator -- Multiple Thumbnails
 * Tests generateMultipleThumbnails() with specific positions,
 * count-based even distribution, and single-thumbnail fallback.
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

describe("ThumbnailGenerator - Multiple Thumbnails", { concurrency: 1 }, () => {
  let generator: ThumbnailGenerator;

  beforeEach((t) => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(t, fs);
  });

  it("should generate multiple thumbnails at specific positions", async () => {
    const videoPath = "/test/video.mp4";
    const outputDir = "/test/output";
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
      positions: [5, 10, 15, 20],
    };

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    for (let i = 0; i < options.positions!.length; i++) {
      const path = `${outputDir}/thumbnail_${i + 1}.jpg`;
      mockFsData.files.set(path, Buffer.from(`thumbnail-${i}`));
      mockFsData.stats.set(path, { size: 50000, mtime: new Date() });
    }

    const results = await generator.generateMultipleThumbnails(videoPath, outputDir, options);

    assert.equal(results.length, 4);
    results.forEach((result, index) => {
      assert.equal(result.timestamp, options.positions![index]);
      assert.ok(result.outputPath.includes(`thumbnail_${index + 1}.jpg`));
    });
  });

  it("should generate evenly distributed thumbnails by count", async () => {
    const videoPath = "/test/video.mp4";
    const outputDir = "/test/output";
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
      count: 5,
    };

    // Mock video duration
    mockSpawnState.stdout = "60.0";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    for (let i = 0; i < 5; i++) {
      const path = `${outputDir}/thumbnail_${i + 1}.jpg`;
      mockFsData.files.set(path, Buffer.from(`thumbnail-${i}`));
      mockFsData.stats.set(path, { size: 50000, mtime: new Date() });
    }

    const results = await generator.generateMultipleThumbnails(videoPath, outputDir, options);

    assert.equal(results.length, 5);
    results.forEach((result) => {
      assert.ok(result.timestamp >= 0);
      assert.ok(result.timestamp <= 60);
    });
  });

  it("should handle single thumbnail request", async () => {
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
      timestamp: 10,
    };

    const outputDir = "/test/output";
    mockSpawnState.stdout = "60.0";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    mockFsData.files.set(`${outputDir}/thumbnail_1.jpg`, Buffer.from("data"));
    mockFsData.stats.set(`${outputDir}/thumbnail_1.jpg`, { size: 50000, mtime: new Date() });

    const results = await generator.generateMultipleThumbnails(
      "/test/video.mp4",
      outputDir,
      options
    );

    assert.equal(results.length, 1);
    assert.equal(results[0]!.timestamp, 10);
  });
});
