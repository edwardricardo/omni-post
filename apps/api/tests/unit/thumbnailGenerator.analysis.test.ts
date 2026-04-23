/**
 * Unit Tests for ThumbnailGenerator — Video Analysis
 * Tests analyzeVideoForThumbnails(): optimal timestamps, scene-change detection,
 * quality scoring, color analysis, and motion analysis.
 *
 * The source uses crypto.randomUUID() to create the analysis directory name,
 * so we cannot pre-populate frame paths with a fixed UUID.
 * Instead, the fs mocks in this file use wildcard matching for frame paths:
 * any path matching /frame_\d+\.jpg$/ is treated as an existing frame file.
 *
 * @file thumbnailGenerator.analysis.test.ts
 * @description Tests for ThumbnailGenerator - Video Analysis
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import { ThumbnailGenerator } from "../../src/video/thumbnailGenerator";
import { promises as fs } from "fs";
import { mockSpawnState, createMockSpawn } from "./thumbnailGenerator.test-helpers";

// Frame-aware size table: maps frame index -> size (set per test)
const frameData = new Map<number, number>();

/** Extract frame index from a path like /tmp/.../test-uuid/frame_3.jpg */
function getFrameIndex(path: string): number | null {
  const match = /frame_(\d+)\.jpg$/.exec(path);
  return match ? parseInt(match[1]!, 10) : null;
}

describe("ThumbnailGenerator - Video Analysis", () => {
  let generator: ThumbnailGenerator;

  beforeEach(() => {
    generator = new ThumbnailGenerator(createMockSpawn());

    // Mock fs.stat: real paths use frameData, others fall through to ENOENT
    vi.spyOn(fs, "stat").mockImplementation(async (path: string) => {
      const idx = getFrameIndex(path);
      if (idx !== null && frameData.has(idx)) {
        return { size: frameData.get(idx)!, mtime: new Date() } as any;
      }
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    });

    // Mock fs.readFile: not used in analysis path, but keep consistent
    vi.spyOn(fs, "readFile").mockImplementation(async (path: string) => {
      const idx = getFrameIndex(path);
      if (idx !== null && frameData.has(idx)) {
        return Buffer.from(`frame-${idx}`);
      }
      throw new Error(`ENOENT: no such file or directory, readFile '${path}'`);
    });

    // Mock fs.writeFile: no-op (analysis doesn't write)
    vi.spyOn(fs, "writeFile").mockImplementation(async (_path: string, _data: Buffer | string) => {
      return undefined;
    });

    // Mock fs.mkdir: always succeed
    vi.spyOn(fs, "mkdir").mockImplementation(async () => {
      return undefined;
    });

    // Mock fs.rm: always succeed (cleanup of analysis dir)
    vi.spyOn(fs, "rm").mockImplementation(async () => {
      return undefined;
    });

    // Mock fs.access: succeed for frame paths present in frameData
    vi.spyOn(fs, "access").mockImplementation(async (path: string) => {
      const idx = getFrameIndex(path);
      if (idx !== null && frameData.has(idx)) {
        return; // file exists
      }
      throw new Error(`ENOENT: no such file or directory, access '${path}'`);
    });
  });

  it("should analyze video for optimal thumbnails", async () => {
    const videoPath = "/test/video.mp4";

    mockSpawnState.stdout = "30.0";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    // Populate 15 frames (indices 0-14) -- sampleInterval=2, duration=30 -> 15 samples
    frameData.clear();
    for (let i = 0; i < 15; i++) {
      frameData.set(i, 100000 + i * 10000);
    }

    const analysis = await generator.analyzeVideoForThumbnails(videoPath, {
      sampleInterval: 2,
      minQualityScore: 70,
      detectSceneChanges: true,
      analyzeMotion: true,
      analyzeColors: true,
    });

    expect(analysis).toBeTruthy();
    expect(Array.isArray(analysis.optimalTimestamps)).toBeTruthy();
    expect(Array.isArray(analysis.sceneChanges)).toBeTruthy();
    expect(Array.isArray(analysis.qualityScores)).toBeTruthy();
    expect(Array.isArray(analysis.colorAnalysis)).toBeTruthy();
    expect(Array.isArray(analysis.motionAnalysis)).toBeTruthy();
  });

  it("should detect scene changes", async () => {
    const videoPath = "/test/video.mp4";

    // Scene changes are parsed from stderr -- stdout=0 so sampleCount=0, but
    // detectSceneChanges still runs and returns parsed timestamps from stderr.
    mockSpawnState.stdout = "";
    mockSpawnState.stderr = "pts_time:5.2 pts_time:12.8 pts_time:23.4";
    mockSpawnState.exitCode = 0;

    // 0 frames (stdout="" -> duration=0 -> sampleCount=0); scene detection still works
    frameData.clear();

    const analysis = await generator.analyzeVideoForThumbnails(videoPath, {
      sampleInterval: 10,
      detectSceneChanges: true,
    });

    expect(analysis.sceneChanges.length > 0).toBeTruthy();
  });

  it("should calculate quality scores for frames", async () => {
    const videoPath = "/test/video.mp4";

    mockSpawnState.stdout = "20.0";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    // 10 frames with varying sizes -- sampleInterval=2, duration=20 -> 10 samples
    frameData.clear();
    for (let i = 0; i < 10; i++) {
      frameData.set(i, 50000 + i * 20000);
    }

    const analysis = await generator.analyzeVideoForThumbnails(videoPath, {
      sampleInterval: 2,
      minQualityScore: 50,
    });

    expect(analysis.qualityScores.length > 0).toBeTruthy();
    analysis.qualityScores.forEach((score) => {
      expect(score.score >= 0 && score.score <= 100).toBeTruthy();
      expect(score.timestamp >= 0).toBeTruthy();
      expect(Array.isArray(score.reasoning)).toBeTruthy();
    });
  });

  it("should return stub color analysis (Future: real image analysis)", async () => {
    const videoPath = "/test/video.mp4";

    mockSpawnState.stdout = "15.0";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    // 7 frames -- sampleInterval=2, duration=15 -> floor(15/2)=7 samples
    frameData.clear();
    for (let i = 0; i < 7; i++) {
      frameData.set(i, 100000);
    }

    const analysis = await generator.analyzeVideoForThumbnails(videoPath, {
      sampleInterval: 2,
      analyzeColors: true,
    });

    expect(analysis.colorAnalysis.length > 0).toBeTruthy();
    analysis.colorAnalysis.forEach((colorData) => {
      expect(Array.isArray(colorData.dominantColors)).toBeTruthy();
      expect(colorData.dominantColors.length).toBe(0);
      expect(colorData.brightness).toBe(0);
      expect(colorData.contrast).toBe(0);
    });
  });

  it("should return stub motion analysis (Future: real frame comparison)", async () => {
    const videoPath = "/test/video.mp4";

    mockSpawnState.stdout = "12.0";
    mockSpawnState.stderr = "";
    mockSpawnState.exitCode = 0;

    // 6 frames -- sampleInterval=2, duration=12 -> floor(12/2)=6 samples
    frameData.clear();
    for (let i = 0; i < 6; i++) {
      frameData.set(i, 100000);
    }

    const analysis = await generator.analyzeVideoForThumbnails(videoPath, {
      sampleInterval: 2,
      analyzeMotion: true,
    });

    expect(analysis.motionAnalysis.length > 0).toBeTruthy();
    analysis.motionAnalysis.forEach((motion) => {
      expect(motion.motionLevel).toBe(0);
      expect(motion.type).toBe("static");
    });
  });
});
