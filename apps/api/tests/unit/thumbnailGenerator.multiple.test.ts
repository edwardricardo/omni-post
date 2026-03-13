/**
 * Unit Tests for ThumbnailGenerator -- Multiple Thumbnails
 * Tests generateMultipleThumbnails() with specific positions,
 * count-based even distribution, and single-thumbnail fallback.
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

describe("ThumbnailGenerator - Multiple Thumbnails", () => {
  let generator: ThumbnailGenerator;

  beforeEach(() => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(fs);
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

    expect(results.length).toBe(4);
    results.forEach((result, index) => {
      expect(result.timestamp).toBe(options.positions![index]);
      expect(result.outputPath.includes(`thumbnail_${index + 1}.jpg`)).toBeTruthy();
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

    expect(results.length).toBe(5);
    results.forEach((result) => {
      expect(result.timestamp >= 0).toBeTruthy();
      expect(result.timestamp <= 60).toBeTruthy();
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

    expect(results.length).toBe(1);
    expect(results[0]!.timestamp).toBe(10);
  });
});
