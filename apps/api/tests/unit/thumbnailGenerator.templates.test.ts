/**
 * Unit Tests for ThumbnailGenerator -- Templates, A/B Testing, and Edge Cases
 * Tests getThumbnailTemplates(), applyTemplate(), generateABTestThumbnails(),
 * and edge cases (zero timestamp, max quality, small resolution).
 *
 * @file thumbnailGenerator.templates.test.ts
 * @description Tests for ThumbnailGenerator - Templates
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { ThumbnailGenerator, type ThumbnailOptions } from "../../src/video/thumbnailGenerator.js";
import { promises as fs } from "fs";
import {
  mockSpawnState,
  createMockSpawn,
  mockFsData,
  setupFsMocks,
} from "./thumbnailGenerator.test-helpers.js";

// --- Templates ---

describe("ThumbnailGenerator - Templates", () => {
  let generator: ThumbnailGenerator;

  beforeEach(() => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(fs);
  });

  it("should list available templates", () => {
    const templates = generator.getThumbnailTemplates();

    expect(Array.isArray(templates)).toBeTruthy();
    expect(templates.length > 0).toBeTruthy();

    templates.forEach((template) => {
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(Array.isArray(template.platform)).toBeTruthy();
      expect(template.options).toBeTruthy();
      expect(template.options.width).toBeTruthy();
      expect(template.options.height).toBeTruthy();
      expect(template.options.quality).toBeTruthy();
      expect(template.options.format).toBeTruthy();
    });
  });

  it("should include YouTube standard template", () => {
    const templates = generator.getThumbnailTemplates();
    const youtubeTemplate = templates.find((t) => t.name === "YouTube Standard");

    expect(youtubeTemplate).toBeTruthy();
    expect(youtubeTemplate.options.width).toBe(1280);
    expect(youtubeTemplate.options.height).toBe(720);
    expect(youtubeTemplate.platform.includes("youtube")).toBeTruthy();
  });

  it("should include Instagram Story template", () => {
    const templates = generator.getThumbnailTemplates();
    const igTemplate = templates.find((t) => t.name === "Instagram Story");

    expect(igTemplate).toBeTruthy();
    expect(igTemplate.options.width).toBe(1080);
    expect(igTemplate.options.height).toBe(1920);
    expect(igTemplate.platform.includes("instagram")).toBeTruthy();
  });

  it("should apply template successfully", async () => {
    const videoPath = "/test/video.mp4";
    const outputPath = "/test/youtube-thumb.jpg";

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("thumbnail-data"));
    mockFsData.stats.set(outputPath, { size: 150000, mtime: new Date() });

    const result = await generator.applyTemplate(videoPath, outputPath, "YouTube Standard");

    expect(typeof result).toBe("object");
    expect(typeof result.id === "string" && result.id.length > 0).toBeTruthy();
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it("should apply template with custom options", async () => {
    const videoPath = "/test/video.mp4";
    const outputPath = "/test/custom-thumb.jpg";

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("thumbnail-data"));
    mockFsData.stats.set(outputPath, { size: 150000, mtime: new Date() });

    const result = await generator.applyTemplate(videoPath, outputPath, "YouTube Standard", {
      timestamp: 15,
      quality: 90,
    });

    expect(result.timestamp).toBe(15);
    expect(result.quality).toBe(90);
  });

  it("should throw error for unknown template", async () => {
    await expect(
      generator.applyTemplate("/test/video.mp4", "/test/output.jpg", "NonExistentTemplate")
    ).rejects.toThrow(/Template "NonExistentTemplate" not found/);
  });
});

// --- A/B Testing ---

describe("ThumbnailGenerator - A/B Testing", () => {
  let generator: ThumbnailGenerator;

  beforeEach(() => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(fs);
  });

  it("should generate A/B test variations", async () => {
    const videoPath = "/test/video.mp4";
    const outputDir = "/test/ab-test";
    const baseOptions: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
    };

    // Provide explicit timestamps to avoid calling analyzeVideoForThumbnails
    // (which uses crypto.randomUUID() internally, making frame paths unpredictable)
    const variations = {
      timestamps: [5, 20, 40],
    };

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    // 3 timestamps x 3 default filters = 9 variants
    for (let i = 1; i <= 9; i++) {
      const path = `${outputDir}/thumbnail_variant_${i}.jpg`;
      mockFsData.files.set(path, Buffer.from(`variant-${i}`));
      mockFsData.stats.set(path, { size: 100000, mtime: new Date() });
    }

    const results = await generator.generateABTestThumbnails(
      videoPath,
      outputDir,
      baseOptions,
      variations
    );

    expect(results.length >= 3).toBeTruthy(); // At minimum 3 variants
    expect(results.every((r) => r.outputPath.includes("variant"))).toBeTruthy();
  });

  it("should use custom timestamps for A/B test", async () => {
    const baseOptions: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
    };

    const variations = {
      timestamps: [5, 15, 30],
    };

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    for (let i = 1; i <= 9; i++) {
      const path = `/test/ab/thumbnail_variant_${i}.jpg`;
      mockFsData.files.set(path, Buffer.from(`variant-${i}`));
      mockFsData.stats.set(path, { size: 100000, mtime: new Date() });
    }

    const results = await generator.generateABTestThumbnails(
      "/test/video.mp4",
      "/test/ab",
      baseOptions,
      variations
    );

    // Should have timestamp x filter combinations
    expect(results.length >= variations.timestamps.length).toBeTruthy();
  });

  it("should apply custom filter variations", async () => {
    const baseOptions: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
    };

    const variations = {
      timestamps: [10],
      filters: [{ brightness: 20 }, { contrast: 15 }, { saturation: 25 }],
    };

    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    for (let i = 1; i <= 3; i++) {
      const path = `/test/ab/thumbnail_variant_${i}.jpg`;
      mockFsData.files.set(path, Buffer.from(`variant-${i}`));
      mockFsData.stats.set(path, { size: 100000, mtime: new Date() });
    }

    const results = await generator.generateABTestThumbnails(
      "/test/video.mp4",
      "/test/ab",
      baseOptions,
      variations
    );

    expect(results.length).toBe(variations.filters.length);
  });
});

// --- Edge Cases ---

describe("ThumbnailGenerator - Edge Cases", () => {
  let generator: ThumbnailGenerator;

  beforeEach(() => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(fs);
  });

  it("should handle zero timestamp", async () => {
    const options: ThumbnailOptions = {
      width: 1280,
      height: 720,
      quality: 85,
      format: "jpg",
      timestamp: 0,
    };

    const outputPath = "/test/zero-timestamp.jpg";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("data"));
    mockFsData.stats.set(outputPath, { size: 50000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(result.timestamp).toBe(0);
  });

  it("should handle very high quality setting", async () => {
    const options: ThumbnailOptions = {
      width: 1920,
      height: 1080,
      quality: 100,
      format: "jpg",
    };

    const outputPath = "/test/max-quality.jpg";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("high-quality-data"));
    mockFsData.stats.set(outputPath, { size: 500000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(result.quality).toBe(100);
  });

  it("should handle small resolution", async () => {
    const options: ThumbnailOptions = {
      width: 320,
      height: 180,
      quality: 60,
      format: "jpg",
    };

    const outputPath = "/test/small-thumb.jpg";
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;
    mockFsData.files.set(outputPath, Buffer.from("small-data"));
    mockFsData.stats.set(outputPath, { size: 15000, mtime: new Date() });

    const result = await generator.generateThumbnail("/test/video.mp4", outputPath, options);

    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
  });
});
