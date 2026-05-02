/**
 * @file videoProcessor.ts
 * @description Video processing service using ffmpeg for transcoding, format conversion,
 *              resolution adjustment, codec selection, and platform-specific optimization.
 * @layer infrastructure
 */
import { spawn as defaultSpawn } from "child_process";
import type { SpawnOptionsWithoutStdio, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import * as _path from "path";
import * as crypto from "crypto";
import { createLogger } from "../lib/logger.js";
import { env } from "../config/env.js";

const videoLogger = createLogger("video");

type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnOptionsWithoutStdio
) => ChildProcess;

export interface VideoProcessingOptions {
  inputPath: string;
  outputPath: string;
  format: "mp4" | "webm" | "mov" | "avi";
  quality: "low" | "medium" | "high" | "ultra";
  resolution?: "720p" | "1080p" | "1440p" | "4k";
  bitrate?: number; // kbps
  fps?: number;
  audioCodec?: "aac" | "mp3" | "opus";
  videoCodec?: "h264" | "h265" | "vp9" | "av1";
  optimize?: {
    forYouTube?: boolean;
    forShorts?: boolean;
    forLiveStream?: boolean;
  };
  watermark?: {
    imagePath: string;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    opacity: number; // 0-1
    scale: number; // 0-1
  };
  filters?: {
    brightness?: number; // -1 to 1
    contrast?: number; // -1 to 1
    saturation?: number; // -1 to 1
    denoise?: boolean;
    stabilize?: boolean;
  };
}

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  audioCodec: string;
  fileSize: number;
  aspectRatio: string;
  colorSpace?: string;
  hasAudio: boolean;
  hasVideo: boolean;
  format: string;
}

export interface ProcessingProgress {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number; // 0-100
  stage: string;
  eta?: number; // seconds remaining
  outputPath?: string;
  error?: string;
  metadata?: VideoMetadata;
  startedAt: Date;
  completedAt?: Date;
}

interface VideoOptimizationPreset {
  name: string;
  description: string;
  settings: Partial<VideoProcessingOptions>;
  platforms: string[];
  maxFileSize?: number; // MB
  maxDuration?: number; // seconds
}

export class VideoProcessor {
  private ffmpegPath: string;
  private ffprobePath: string;
  private tempDir: string;
  private progressCallbacks: Map<string, (progress: ProcessingProgress) => void> = new Map();
  private readonly spawn: SpawnFn;

  constructor(spawnFn?: SpawnFn) {
    this.ffmpegPath = env.FFMPEG_PATH || "ffmpeg";
    this.ffprobePath = env.FFPROBE_PATH || "ffprobe";
    this.tempDir = env.VIDEO_TEMP_DIR || "/tmp/claude/video-processing";
    this.spawn = spawnFn ?? defaultSpawn;
    this.ensureTempDir();
  }

  /**
   * Get video metadata using ffprobe
   */
  async getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    return this.runFfprobe(filePath);
  }

  /**
   * Internal ffprobe runner — called directly to avoid module-level circuit breaker
   * cross-instance pollution (shared breaker Map would use the first instance's closure).
   */
  private runFfprobe(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const args = [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ];

      const ffprobe = this.spawn(this.ffprobePath, args);
      let output = "";
      let errorOutput = "";

      ffprobe.stdout?.on("data", (data) => {
        output += data.toString();
      });

      ffprobe.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      ffprobe.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed: ${errorOutput}`));
          return;
        }

        try {
          const probe = JSON.parse(output);
          const videoStream = probe.streams.find(
            (s: Record<string, unknown>) => s.codec_type === "video"
          );
          const audioStream = probe.streams.find(
            (s: Record<string, unknown>) => s.codec_type === "audio"
          );

          if (!videoStream) {
            reject(new Error("No video stream found"));
            return;
          }

          const metadata: VideoMetadata = {
            duration: parseFloat(probe.format.duration || "0"),
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            fps: this.parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate),
            bitrate: parseInt(probe.format.bit_rate || "0"),
            codec: videoStream.codec_name || "unknown",
            audioCodec: audioStream?.codec_name || "none",
            fileSize: parseInt(probe.format.size || "0"),
            aspectRatio: this.calculateAspectRatio(videoStream.width, videoStream.height),
            ...(videoStream.color_space && { colorSpace: videoStream.color_space }),
            hasAudio: !!audioStream,
            hasVideo: !!videoStream,
            format: probe.format.format_name || "unknown",
          };

          resolve(metadata);
        } catch {
          reject(new Error(`Failed to parse ffprobe output`));
        }
      });

      ffprobe.on("error", (error) => {
        reject(new Error(`ffprobe spawn error: ${error}`));
      });
    });
  }

  /**
   * Process video with specified options
   */
  async processVideo(
    options: VideoProcessingOptions,
    onProgress?: (progress: ProcessingProgress) => void
  ): Promise<ProcessingProgress> {
    const jobId = crypto.randomUUID();

    const progress: ProcessingProgress = {
      jobId,
      status: "queued",
      progress: 0,
      stage: "Initializing",
      startedAt: new Date(),
    };

    if (onProgress) {
      this.progressCallbacks.set(jobId, onProgress);
      onProgress(progress);
    }

    try {
      // Update progress
      progress.status = "processing";
      progress.stage = "Analyzing input video";
      this.updateProgress(jobId, progress);

      // Get input metadata
      const inputMetadata = await this.getVideoMetadata(options.inputPath);
      progress.metadata = inputMetadata;

      // Build ffmpeg command
      const args = await this.buildFFmpegArgs(options, inputMetadata);

      progress.stage = "Processing video";
      progress.progress = 10;
      this.updateProgress(jobId, progress);

      // Process video
      await this.runFFmpeg(args, jobId, progress);

      // Verify output
      progress.stage = "Verifying output";
      progress.progress = 95;
      this.updateProgress(jobId, progress);

      const outputExists = await fs
        .access(options.outputPath)
        .then(() => true)
        .catch(() => false);
      if (!outputExists) {
        throw new Error("Output file was not created");
      }

      // Complete
      progress.status = "completed";
      progress.progress = 100;
      progress.stage = "Complete";
      progress.completedAt = new Date();
      progress.outputPath = options.outputPath;

      this.updateProgress(jobId, progress);
      this.progressCallbacks.delete(jobId);

      return progress;
    } catch (error) {
      progress.status = "failed";
      progress.error = error instanceof Error ? error.message : "Unknown error";
      progress.completedAt = new Date();
      this.updateProgress(jobId, progress);
      this.progressCallbacks.delete(jobId);
      throw error;
    }
  }

  /**
   * Get predefined optimization presets
   */
  getOptimizationPresets(): VideoOptimizationPreset[] {
    return [
      {
        name: "YouTube 1080p",
        description: "Optimized for YouTube 1080p upload",
        platforms: ["youtube"],
        maxFileSize: 128 * 1024, // 128GB YouTube limit
        settings: {
          format: "mp4",
          quality: "high",
          resolution: "1080p",
          videoCodec: "h264",
          audioCodec: "aac",
          bitrate: 8000,
          fps: 30,
          optimize: { forYouTube: true },
        },
      },
      {
        name: "YouTube Shorts",
        description: "Optimized for YouTube Shorts (vertical, <60s)",
        platforms: ["youtube"],
        maxDuration: 60,
        settings: {
          format: "mp4",
          quality: "high",
          resolution: "1080p",
          videoCodec: "h264",
          audioCodec: "aac",
          bitrate: 6000,
          fps: 30,
          optimize: { forShorts: true },
        },
      },
      {
        name: "Live Stream",
        description: "Optimized for live streaming",
        platforms: ["youtube", "twitch", "facebook"],
        settings: {
          format: "mp4",
          quality: "medium",
          resolution: "1080p",
          videoCodec: "h264",
          audioCodec: "aac",
          bitrate: 4500,
          fps: 30,
          optimize: { forLiveStream: true },
        },
      },
      {
        name: "High Quality Archive",
        description: "Maximum quality for archival purposes",
        platforms: ["youtube", "vimeo"],
        settings: {
          format: "mp4",
          quality: "ultra",
          resolution: "4k",
          videoCodec: "h265",
          audioCodec: "aac",
          bitrate: 20000,
          fps: 60,
        },
      },
      {
        name: "Social Media Optimized",
        description: "Optimized for social media platforms",
        platforms: ["instagram", "twitter", "facebook", "tiktok"],
        maxFileSize: 100, // 100MB typical social limit
        settings: {
          format: "mp4",
          quality: "medium",
          resolution: "1080p",
          videoCodec: "h264",
          audioCodec: "aac",
          bitrate: 3000,
          fps: 30,
        },
      },
      {
        name: "Mobile Optimized",
        description: "Optimized for mobile viewing and data usage",
        platforms: ["all"],
        maxFileSize: 50, // 50MB for mobile
        settings: {
          format: "mp4",
          quality: "medium",
          resolution: "720p",
          videoCodec: "h264",
          audioCodec: "aac",
          bitrate: 1500,
          fps: 30,
        },
      },
    ];
  }

  /**
   * Apply optimization preset
   */
  async applyPreset(
    inputPath: string,
    outputPath: string,
    presetName: string,
    customOptions?: Partial<VideoProcessingOptions>,
    onProgress?: (progress: ProcessingProgress) => void
  ): Promise<ProcessingProgress> {
    const preset = this.getOptimizationPresets().find((p) => p.name === presetName);
    if (!preset) {
      throw new Error(`Preset "${presetName}" not found`);
    }

    const options: VideoProcessingOptions = {
      inputPath,
      outputPath,
      ...preset.settings,
      ...customOptions,
    } as VideoProcessingOptions;

    // Validate constraints
    if (preset.maxFileSize) {
      const inputStats = await fs.stat(inputPath);
      if (inputStats.size > preset.maxFileSize * 1024 * 1024) {
        videoLogger.warn(
          { maxFileSize: preset.maxFileSize },
          "Input file exceeds recommended size for preset"
        );
      }
    }

    if (preset.maxDuration) {
      const metadata = await this.getVideoMetadata(inputPath);
      if (metadata.duration > preset.maxDuration) {
        videoLogger.warn(
          { maxDuration: preset.maxDuration },
          "Input duration exceeds recommended length for preset"
        );
      }
    }

    return this.processVideo(options, onProgress);
  }

  /**
   * Cancel video processing job
   */
  async cancelJob(_jobId: string): Promise<boolean> {
    // This would typically integrate with a job queue system
    // For now, we'll just remove the progress callback
    this.progressCallbacks.delete(_jobId);
    return true;
  }

  private async buildFFmpegArgs(
    options: VideoProcessingOptions,
    _inputMetadata: VideoMetadata
  ): Promise<string[]> {
    const args: string[] = ["-i", options.inputPath];

    // Video codec
    if (options.videoCodec) {
      switch (options.videoCodec) {
        case "h264":
          args.push("-c:v", "libx264");
          break;
        case "h265":
          args.push("-c:v", "libx265");
          break;
        case "vp9":
          args.push("-c:v", "libvpx-vp9");
          break;
        case "av1":
          args.push("-c:v", "libaom-av1");
          break;
      }
    }

    // Audio codec
    if (options.audioCodec) {
      switch (options.audioCodec) {
        case "aac":
          args.push("-c:a", "aac");
          break;
        case "mp3":
          args.push("-c:a", "libmp3lame");
          break;
        case "opus":
          args.push("-c:a", "libopus");
          break;
      }
    }

    // Resolution
    if (options.resolution) {
      const resolutionMap = {
        "720p": "1280:720",
        "1080p": "1920:1080",
        "1440p": "2560:1440",
        "4k": "3840:2160",
      };
      args.push("-vf", `scale=${resolutionMap[options.resolution]}`);
    }

    // Bitrate
    if (options.bitrate) {
      args.push("-b:v", `${options.bitrate}k`);
    }

    // FPS
    if (options.fps) {
      args.push("-r", options.fps.toString());
    }

    // Quality presets
    if (options.quality) {
      const qualityMap = {
        low: "fast",
        medium: "medium",
        high: "slow",
        ultra: "veryslow",
      };
      args.push("-preset", qualityMap[options.quality]);
    }

    // Platform-specific optimizations
    if (options.optimize?.forYouTube) {
      args.push("-movflags", "+faststart"); // Enable progressive download
      args.push("-pix_fmt", "yuv420p"); // Ensure compatibility
    }

    if (options.optimize?.forShorts) {
      // Ensure vertical orientation
      args.push(
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
      );
    }

    if (options.optimize?.forLiveStream) {
      args.push("-tune", "zerolatency");
      args.push("-g", "60"); // GOP size for streaming
    }

    // Filters
    if (options.filters) {
      const filterList: string[] = [];

      if (options.filters.brightness !== undefined) {
        filterList.push(`eq=brightness=${options.filters.brightness}`);
      }

      if (options.filters.contrast !== undefined) {
        filterList.push(`eq=contrast=${options.filters.contrast}`);
      }

      if (options.filters.saturation !== undefined) {
        filterList.push(`eq=saturation=${options.filters.saturation}`);
      }

      if (options.filters.denoise) {
        filterList.push("hqdn3d");
      }

      if (options.filters.stabilize) {
        filterList.push("deshake");
      }

      if (filterList.length > 0) {
        args.push("-vf", filterList.join(","));
      }
    }

    // Watermark
    if (options.watermark) {
      const overlayPosition = this.getOverlayPosition(options.watermark.position);
      args.push(
        "-i",
        options.watermark.imagePath,
        "-filter_complex",
        `[1:v]scale=iw*${options.watermark.scale}:ih*${options.watermark.scale}[wm];[0:v][wm]overlay=${overlayPosition}:format=auto,format=yuv420p[out]`,
        "-map",
        "[out]",
        "-map",
        "0:a?"
      );
    }

    // Output format
    args.push("-f", options.format);

    // Overwrite output
    args.push("-y");

    // Output path
    args.push(options.outputPath);

    return args;
  }

  private async runFFmpeg(
    args: string[],
    jobId: string,
    progress: ProcessingProgress
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = this.spawn(this.ffmpegPath, args);
      let errorOutput = "";

      ffmpeg.stderr?.on("data", (data) => {
        const output = data.toString();
        errorOutput += output;

        // Parse progress from ffmpeg output
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch && progress.metadata) {
          const [, hours, minutes, seconds] = timeMatch;
          const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
          const progressPercent = Math.min((currentTime / progress.metadata.duration) * 100, 99);

          progress.progress = Math.max(progress.progress, Math.floor(progressPercent));
          progress.eta = progress.metadata.duration - currentTime;
          this.updateProgress(jobId, progress);
        }
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${errorOutput}`));
        }
      });

      ffmpeg.on("error", (error) => {
        reject(new Error(`FFmpeg spawn error: ${error}`));
      });
    });
  }

  private updateProgress(jobId: string, progress: ProcessingProgress): void {
    const callback = this.progressCallbacks.get(jobId);
    if (callback) {
      callback(progress);
    }
  }

  private parseFps(fpsString: string): number {
    if (!fpsString) return 0;

    // Parse fraction format (e.g., "30000/1001" or "30/1")
    const parts = fpsString.split("/");
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    return denominator ? numerator / denominator : numerator;
  }

  private calculateAspectRatio(width: number, height: number): string {
    if (!width || !height) return "unknown";

    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);

    return `${width / divisor}:${height / divisor}`;
  }

  private getOverlayPosition(
    position: NonNullable<VideoProcessingOptions["watermark"]>["position"]
  ): string {
    switch (position) {
      case "top-left":
        return "10:10";
      case "top-right":
        return "W-w-10:10";
      case "bottom-left":
        return "10:H-h-10";
      case "bottom-right":
        return "W-w-10:H-h-10";
      case "center":
        return "(W-w)/2:(H-h)/2";
      default:
        return "10:10";
    }
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch {
      videoLogger.warn("Failed to create temp directory");
    }
  }
}
