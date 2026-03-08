/**
 * Thumbnail Generation - Core Generation Logic
 *
 * Single and multiple thumbnail generation from video files using ffmpeg.
 * Includes ffmpeg command building, execution, and video metadata extraction.
 *
 * @module video/thumbnailGeneration
 */

import type { ChildProcess } from "child_process";
import { createLogger } from "../lib/logger.js";

const videoLogger = createLogger("video");
import { spawn as defaultSpawn } from "child_process";
import type { SpawnOptionsWithoutStdio } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { ThumbnailOptions, ThumbnailResult } from "./thumbnailTypes.js";

export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnOptionsWithoutStdio
) => ChildProcess;

/**
 * Core thumbnail generation engine
 */
export class ThumbnailGenerationEngine {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly tempDir: string;
  readonly spawn: SpawnFn;

  constructor(spawnFn?: SpawnFn) {
    this.ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    this.ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
    this.tempDir = process.env.THUMBNAIL_TEMP_DIR || "/tmp/claude/thumbnails";
    this.spawn = spawnFn ?? defaultSpawn;
    this.ensureTempDir();
  }

  /**
   * Generate single thumbnail from video
   */
  async generateThumbnail(
    videoPath: string,
    outputPath: string,
    options: ThumbnailOptions
  ): Promise<ThumbnailResult> {
    const startTime = Date.now();
    const thumbnailId = crypto.randomUUID();

    const args = await this.buildFFmpegCommand(
      videoPath,
      outputPath,
      options,
      options.timestamp || 0
    );

    await this.executeFFmpeg(args);

    const stats = await fs.stat(outputPath);
    const checksum = await this.calculateChecksum(outputPath);

    return {
      id: thumbnailId,
      inputVideoPath: videoPath,
      outputPath,
      width: options.width,
      height: options.height,
      format: options.format,
      fileSize: stats.size,
      timestamp: options.timestamp || 0,
      quality: options.quality,
      createdAt: new Date(),
      processingTime: Date.now() - startTime,
      checksum,
    };
  }

  /**
   * Generate multiple thumbnails from video
   */
  async generateMultipleThumbnails(
    videoPath: string,
    outputDir: string,
    options: ThumbnailOptions
  ): Promise<ThumbnailResult[]> {
    let timestamps: number[];

    if (options.positions && options.positions.length > 0) {
      timestamps = options.positions;
    } else if (options.count && options.count > 1) {
      const duration = await this.getVideoDuration(videoPath);
      timestamps = this.generateEvenTimestamps(duration, options.count);
    } else {
      const duration = await this.getVideoDuration(videoPath);
      timestamps = [options.timestamp || duration * 0.1];
    }

    const results: ThumbnailResult[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const filename = `thumbnail_${i + 1}.${options.format}`;
      const outputPath = path.join(outputDir, filename);

      const thumbnailOptions: ThumbnailOptions = {
        ...options,
        ...(timestamp !== undefined && { timestamp }),
      };
      const result = await this.generateThumbnail(videoPath, outputPath, thumbnailOptions);

      results.push(result);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // FFmpeg Command Building & Execution
  // ---------------------------------------------------------------------------

  async buildFFmpegCommand(
    inputPath: string,
    outputPath: string,
    options: ThumbnailOptions,
    timestamp: number
  ): Promise<string[]> {
    const args: string[] = ["-i", inputPath];

    args.push("-ss", timestamp.toString());
    args.push("-frames:v", "1");
    args.push("-vf", `scale=${options.width}:${options.height}`);

    if (options.filters) {
      const filters: string[] = [];

      if (options.filters.brightness !== undefined) {
        filters.push(`eq=brightness=${options.filters.brightness / 100}`);
      }

      if (options.filters.contrast !== undefined) {
        filters.push(`eq=contrast=${1 + options.filters.contrast / 100}`);
      }

      if (options.filters.saturation !== undefined) {
        filters.push(`eq=saturation=${1 + options.filters.saturation / 100}`);
      }

      if (options.filters.blur !== undefined && options.filters.blur > 0) {
        filters.push(`boxblur=${options.filters.blur}`);
      }

      if (options.filters.sharpen) {
        filters.push("unsharp=5:5:1.0:5:5:0.0");
      }

      if (filters.length > 0) {
        const existingVf = args.findIndex((arg) => arg === "-vf");
        if (existingVf !== -1) {
          args[existingVf + 1] += "," + filters.join(",");
        } else {
          args.push("-vf", filters.join(","));
        }
      }
    }

    if (options.format === "jpg") {
      args.push("-q:v", Math.floor((100 - options.quality) / 4).toString());
    } else if (options.format === "webp") {
      args.push("-quality", options.quality.toString());
    }

    args.push("-y");
    args.push(outputPath);

    return args;
  }

  async executeFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = this.spawn(this.ffmpegPath, args);
      let errorOutput = "";

      ffmpeg.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed: ${errorOutput}`));
        }
      });

      ffmpeg.on("error", (error) => {
        reject(new Error(`FFmpeg spawn error: ${error}`));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Video Metadata
  // ---------------------------------------------------------------------------

  async getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath];
      const ffprobe = this.spawn(this.ffprobePath, args);
      let output = "";

      ffprobe.stdout?.on("data", (data) => {
        output += data.toString();
      });

      ffprobe.on("close", (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          resolve(isNaN(duration) ? 0 : duration);
        } else {
          reject(new Error("Failed to get video duration"));
        }
      });
    });
  }

  generateEvenTimestamps(duration: number, count: number): number[] {
    if (count <= 1) return [duration * 0.1];

    const interval = duration / (count + 1);
    return Array.from({ length: count }, (_, i) => interval * (i + 1));
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  async calculateChecksum(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return crypto.createHash("md5").update(data).digest("hex");
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async extractFramesForAnalysis(
    videoPath: string,
    outputDir: string,
    timestamps: number[]
  ): Promise<void> {
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      if (timestamp === undefined) continue;

      const outputPath = path.join(outputDir, `frame_${i}.jpg`);

      const args = [
        "-i",
        videoPath,
        "-ss",
        timestamp.toString(),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-y",
        outputPath,
      ];

      await this.executeFFmpeg(args);
    }
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      videoLogger.warn({ err: error }, "Failed to create temp directory");
    }
  }
}
