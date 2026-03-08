/**
 * Unit Tests for ThumbnailGenerator -- Templates, A/B Testing, and Edge Cases
 * Tests getThumbnailTemplates(), applyTemplate(), generateABTestThumbnails(),
 * and edge cases (zero timestamp, max quality, small resolution).
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

// --- Templates ---

describe("ThumbnailGenerator - Templates", { concurrency: 1 }, () => {
  let generator: ThumbnailGenerator;

  beforeEach((t) => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(t, fs);
  });

  it("should list available templates", () => {
    const templates = generator.getThumbnailTemplates();

    assert.ok(Array.isArray(templates));
    assert.ok(templates.length > 0);

    templates.forEach((template) => {
      assert.ok(template.name);
      assert.ok(template.description);
      assert.ok(Array.isArray(template.platform));
      assert.ok(template.options);
      assert.ok(template.options.width);
      assert.ok(template.options.height);
      assert.ok(template.options.quality);
      assert.ok(template.options.format);
    });
  });

  it("should include YouTube standard template", () => {
    const templates = generator.getThumbnailTemplates();
    const youtubeTemplate = templates.find((t) => t.name === "YouTube Standard");

    assert.ok(youtubeTemplate);
    assert.equal(youtubeTemplate.options.width, 1280);
    assert.equal(youtubeTemplate.options.height, 720);
    assert.ok(youtubeTemplate.platform.includes("youtube"));
  });

  it("should include Instagram Story template", () => {
    const templates = generator.getThumbnailTemplates();
    const igTemplate = templates.find((t) => t.name === "Instagram Story");

    assert.ok(igTemplate);
    assert.equal(igTemplate.options.width, 1080);
    assert.equal(igTemplate.options.height, 1920);
    assert.ok(igTemplate.platform.includes("instagram"));
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

    assert.strictEqual(
      typeof result,
      "object",
      "applyTemplate should return a ThumbnailResult object"
    );
    assert.ok(
      typeof result.id === "string" && result.id.length > 0,
      "result should have a non-empty id"
    );
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
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

    assert.equal(result.timestamp, 15);
    assert.equal(result.quality, 90);
  });

  it("should throw error for unknown template", async () => {
    await assert.rejects(
      async () => {
        await generator.applyTemplate("/test/video.mp4", "/test/output.jpg", "NonExistentTemplate");
      },
      {
        message: /Template "NonExistentTemplate" not found/,
      }
    );
  });
});

// --- A/B Testing ---

describe("ThumbnailGenerator - A/B Testing", { concurrency: 1 }, () => {
  let generator: ThumbnailGenerator;

  beforeEach((t) => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(t, fs);
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

    assert.ok(results.length >= 3); // At minimum 3 variants
    assert.ok(results.every((r) => r.outputPath.includes("variant")));
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
    assert.ok(results.length >= variations.timestamps.length);
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

    assert.equal(results.length, variations.filters.length);
  });
});

// --- Edge Cases ---

describe("ThumbnailGenerator - Edge Cases", { concurrency: 1 }, () => {
  let generator: ThumbnailGenerator;

  beforeEach((t) => {
    generator = new ThumbnailGenerator(createMockSpawn());
    setupFsMocks(t, fs);
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

    assert.equal(result.timestamp, 0);
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

    assert.equal(result.quality, 100);
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

    assert.equal(result.width, 320);
    assert.equal(result.height, 180);
  });
});
