/**
 * Thumbnail Analysis - Video Analysis for Optimal Thumbnails
 *
 * Analyzes video frames for quality, color, motion, and scene changes
 * to determine optimal thumbnail timestamps.
 *
 * @module video/thumbnailAnalysis
 */

import { promises as fs } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { AnalysisResult } from "./thumbnailTypes.js";
import type { ThumbnailGenerationEngine } from "./thumbnailGeneration.js";

/**
 * Video analysis engine for finding optimal thumbnail frames
 */
export class ThumbnailAnalysisEngine {
  constructor(private engine: ThumbnailGenerationEngine) {}

  /**
   * Analyze video to find optimal thumbnail timestamps
   */
  async analyzeVideoForThumbnails(
    videoPath: string,
    analysisOptions?: {
      sampleInterval?: number;
      minQualityScore?: number;
      detectSceneChanges?: boolean;
      analyzeMotion?: boolean;
      analyzeColors?: boolean;
    }
  ): Promise<AnalysisResult> {
    const options = {
      sampleInterval: 2,
      minQualityScore: 70,
      detectSceneChanges: true,
      analyzeMotion: true,
      analyzeColors: true,
      ...analysisOptions,
    };

    const duration = await this.engine.getVideoDuration(videoPath);
    const sampleCount = Math.floor(duration / options.sampleInterval);
    const timestamps: number[] = Array.from(
      { length: sampleCount },
      (_, i) => i * options.sampleInterval
    );

    const analysisDir = path.join(this.engine.tempDir, crypto.randomUUID());
    await fs.mkdir(analysisDir, { recursive: true });

    try {
      await this.engine.extractFramesForAnalysis(videoPath, analysisDir, timestamps);

      const qualityScores: AnalysisResult["qualityScores"] = [];
      const colorAnalysis: AnalysisResult["colorAnalysis"] = [];
      const motionAnalysis: AnalysisResult["motionAnalysis"] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];
        if (timestamp === undefined) continue;

        const framePath = path.join(analysisDir, `frame_${i}.jpg`);

        if (await this.engine.fileExists(framePath)) {
          const quality = await this.analyzeFrameQuality(framePath, timestamp);
          qualityScores.push(quality);

          if (options.analyzeColors) {
            const colors = await this.analyzeFrameColors(framePath, timestamp);
            colorAnalysis.push(colors);
          }

          if (options.analyzeMotion && i > 0) {
            const prevFramePath = path.join(analysisDir, `frame_${i - 1}.jpg`);
            const motion = await this.analyzeFrameMotion(prevFramePath, framePath, timestamp);
            motionAnalysis.push(motion);
          }
        }
      }

      const sceneChanges = options.detectSceneChanges
        ? await this.detectSceneChanges(videoPath)
        : [];

      const optimalTimestamps = this.findOptimalTimestamps(
        qualityScores,
        sceneChanges,
        options.minQualityScore
      );

      return {
        optimalTimestamps,
        sceneChanges,
        qualityScores,
        colorAnalysis,
        motionAnalysis,
      };
    } finally {
      await fs.rm(analysisDir, { recursive: true, force: true });
    }
  }

  /**
   * Get optimal timestamps by running analysis
   */
  async getOptimalTimestamps(videoPath: string, count: number): Promise<number[]> {
    const analysis = await this.analyzeVideoForThumbnails(videoPath, {
      sampleInterval: 5,
      minQualityScore: 60,
    });

    return analysis.optimalTimestamps.slice(0, count);
  }

  // ---------------------------------------------------------------------------
  // Frame Analysis
  // ---------------------------------------------------------------------------

  private async analyzeFrameQuality(
    framePath: string,
    timestamp: number
  ): Promise<AnalysisResult["qualityScores"][0]> {
    const stats = await fs.stat(framePath);
    const baseScore = Math.min(90, (stats.size / 10000) * 100);

    const reasoning: string[] = [];
    let score = baseScore;

    if (stats.size < 50000) {
      reasoning.push("Low file size may indicate poor quality or simple scene");
      score -= 20;
    }

    if (stats.size > 200000) {
      reasoning.push("High file size indicates detailed scene");
      score += 10;
    }

    return {
      timestamp,
      score: Math.max(0, Math.min(100, score)),
      reasoning,
    };
  }

  // Future: analyzeFrameColors
  // Extract dominant colors, brightness, and contrast from a video frame
  // using real image analysis (e.g., sharp or canvas pixel sampling).
  // Requires: Image processing library (sharp, jimp, or canvas)
  private async analyzeFrameColors(
    _framePath: string,
    timestamp: number
  ): Promise<AnalysisResult["colorAnalysis"][0]> {
    return {
      timestamp,
      dominantColors: [],
      brightness: 0,
      contrast: 0,
    };
  }

  // Future: analyzeFrameMotion
  // Compare consecutive frames to detect motion level using pixel difference
  // analysis or optical flow estimation via ffmpeg/OpenCV.
  // Requires: Frame comparison library or ffmpeg filter-based motion detection
  private async analyzeFrameMotion(
    _prevFramePath: string,
    _currentFramePath: string,
    timestamp: number
  ): Promise<AnalysisResult["motionAnalysis"][0]> {
    return {
      timestamp,
      motionLevel: 0,
      type: "static" as const,
    };
  }

  // ---------------------------------------------------------------------------
  // Scene Detection
  // ---------------------------------------------------------------------------

  private async detectSceneChanges(videoPath: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const args = ["-i", videoPath, "-vf", "select=gt(scene\\,0.3),showinfo", "-f", "null", "-"];

      const ffmpeg = this.engine.spawn(this.engine.ffmpegPath, args);
      let errorOutput = "";
      const sceneChanges: number[] = [];

      ffmpeg.stderr?.on("data", (data) => {
        const output = data.toString();
        errorOutput += output;

        const matches = output.matchAll(/pts_time:(\d+\.?\d*)/g);
        for (const match of matches) {
          const timestamp = parseFloat(match[1]);
          if (!isNaN(timestamp)) {
            sceneChanges.push(timestamp);
          }
        }
      });

      ffmpeg.on("close", (code) => {
        if (code === 0 || code === 1) {
          resolve(sceneChanges);
        } else {
          reject(new Error(`Scene detection failed: ${errorOutput}`));
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Optimal Timestamp Selection
  // ---------------------------------------------------------------------------

  private findOptimalTimestamps(
    qualityScores: AnalysisResult["qualityScores"],
    sceneChanges: number[],
    minQualityScore: number
  ): number[] {
    const highQualityFrames = qualityScores.filter((q) => q.score >= minQualityScore);

    const scoredTimestamps = highQualityFrames.map((frame) => {
      let score = frame.score;

      const nearSceneChange = sceneChanges.some((change) => Math.abs(change - frame.timestamp) < 2);

      if (nearSceneChange) {
        score += 20;
      }

      return { timestamp: frame.timestamp, score };
    });

    return scoredTimestamps.sort((a, b) => b.score - a.score).map((item) => item.timestamp);
  }
}
