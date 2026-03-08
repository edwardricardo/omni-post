/**
 * @file videoProcessor.ts
 * @description TikTok video processing service -- analysis, optimization,
 * template application, and batch processing with ffmpeg.
 * Types live in videoProcessorTypes.ts; helpers in videoProcessorHelpers.ts.
 */

import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";
import * as client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:tiktok:video-processor");
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

// Re-export all types so existing importers continue to work
export type {
  TikTokVideoSpecs,
  TikTokVideoProcessingOptions,
  TikTokProcessedVideo,
  TikTokVideoAnalysis,
  TikTokVideoTemplate,
} from "./videoProcessorTypes.js";

import type {
  TikTokVideoProcessingOptions,
  TikTokProcessedVideo,
  TikTokVideoAnalysis,
  TikTokVideoTemplate,
} from "./videoProcessorTypes.js";

import {
  calculateAspectRatio,
  parseFrameRate,
  validateCompliance,
  calculateProcessingParameters,
} from "./videoProcessorHelpers.js";

// Re-export specs constant for backward compatibility
export { TIKTOK_VIDEO_SPECS } from "./videoProcessorHelpers.js";

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class TikTokVideoProcessor {
  private tempDir: string;

  constructor(tempDir: string = "/tmp/tiktok-video-processing") {
    this.tempDir = tempDir;
  }

  /**
   * Analyze video file for TikTok compliance
   */
  async analyzeVideo(filePath: string): Promise<TikTokVideoAnalysis> {
    const apiCall = async (): Promise<TikTokVideoAnalysis> => {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
          if (err) {
            reject(new Error(`Video analysis failed: ${err.message}`));
            return;
          }

          const videoStream = metadata.streams.find((s: any) => s.codec_type === "video");
          const audioStream = metadata.streams.find((s: any) => s.codec_type === "audio");

          if (!videoStream) {
            reject(new Error("No video stream found"));
            return;
          }

          const analysis: TikTokVideoAnalysis = {
            fileName: path.basename(filePath),
            format: metadata.format.format_name || "unknown",
            duration: parseFloat(String(metadata.format.duration || "0")),
            fileSize: parseInt(String(metadata.format.size || "0")),
            resolution: { width: videoStream.width || 0, height: videoStream.height || 0 },
            aspectRatio: calculateAspectRatio(videoStream.width || 0, videoStream.height || 0),
            frameRate: parseFrameRate(videoStream.r_frame_rate || "0/1"),
            bitRate: parseInt(String(videoStream.bit_rate || metadata.format.bit_rate || "0")),
            codec: videoStream.codec_name || "unknown",
            audioCodec: audioStream?.codec_name || "none",
            audioChannels: audioStream?.channels || 0,
            audioSampleRate: audioStream?.sample_rate
              ? parseInt(String(audioStream.sample_rate))
              : 0,
            audioBitRate: audioStream?.bit_rate ? parseInt(String(audioStream.bit_rate)) : 0,
            isCompliant: false,
            issues: [],
            recommendations: [],
          };

          validateCompliance(analysis);
          resolve(analysis);
        });
      });
    };

    return circuitBreaker.call("tiktok-video-processor", "analyze-video", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 1800000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Process video for TikTok optimization
   */
  async processVideo(
    inputPath: string,
    options: TikTokVideoProcessingOptions = {}
  ): Promise<TikTokProcessedVideo> {
    const apiCall = async (): Promise<TikTokProcessedVideo> => {
      const startTime = Date.now();

      await fs.mkdir(this.tempDir, { recursive: true });

      const outputFileName = `processed_${crypto.randomUUID()}.mp4`;
      const outputPath = path.join(this.tempDir, outputFileName);
      const thumbnailPath = path.join(this.tempDir, `thumb_${crypto.randomUUID()}.jpg`);
      const previewGifPath = path.join(this.tempDir, `preview_${crypto.randomUUID()}.gif`);

      const analysis = await this.analyzeVideo(inputPath);
      const processingParams = calculateProcessingParameters(analysis, options);

      await this.executeVideoProcessing(inputPath, outputPath, processingParams);
      await this.generateThumbnail(outputPath, thumbnailPath);
      await this.generatePreviewGif(outputPath, previewGifPath);

      const processedAnalysis = await this.analyzeVideo(outputPath);
      const processingTime = Date.now() - startTime;

      return {
        originalFile: inputPath,
        processedFile: outputPath,
        format: processingParams.format,
        codec: processingParams.codec,
        resolution: processingParams.resolution,
        aspectRatio: processingParams.aspectRatio,
        duration: processedAnalysis.duration,
        fileSize: processedAnalysis.fileSize,
        bitRate: processedAnalysis.bitRate,
        frameRate: processedAnalysis.frameRate,
        audioCodec: processedAnalysis.audioCodec,
        audioSampleRate: processedAnalysis.audioSampleRate,
        audioBitRate: processedAnalysis.audioBitRate,
        thumbnail: thumbnailPath,
        previewGif: previewGifPath,
        processingTime,
        optimizations: processingParams.optimizations,
        metadata: {
          title: "Processed TikTok Video",
          description: "Video processed for TikTok optimization",
          ...(options.addEffects && { effects: options.addEffects }),
        },
      };
    };

    return circuitBreaker.call("tiktok-video-processor", "process-video", apiCall, [], {
      timeout: 300000,
      errorThresholdPercentage: 80,
      resetTimeout: 180000,
      maxRetries: 1,
      baseDelay: 5000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  /**
   * Get TikTok video templates
   */
  getVideoTemplates(category?: string): TikTokVideoTemplate[] {
    const templates: TikTokVideoTemplate[] = [
      {
        id: "vertical-trending",
        name: "Vertical Trending",
        description: "Optimized for maximum reach with trending effects",
        category: "trending",
        aspectRatio: "9:16",
        resolution: { width: 1080, height: 1920 },
        duration: { min: 15, max: 60 },
        effects: ["fade-in", "zoom", "color-pop"],
        transitions: ["quick-cut", "slide"],
        textOverlays: [
          {
            text: "Hook viewers in first 3 seconds",
            position: "top-center",
            style: "bold-white",
            duration: 3,
          },
        ],
        backgroundMusic: "upbeat-trending",
        colorScheme: ["#FF0050", "#00F5FF", "#FFB800"],
        usageCount: 15420,
        performance: {
          averageViews: 85000,
          averageLikes: 5200,
          averageShares: 890,
          engagementRate: 7.2,
        },
      },
      {
        id: "educational-vertical",
        name: "Educational Vertical",
        description: "Perfect for tutorials and educational content",
        category: "education",
        aspectRatio: "9:16",
        resolution: { width: 1080, height: 1920 },
        duration: { min: 30, max: 180 },
        effects: ["text-highlight", "step-counter"],
        transitions: ["smooth-fade"],
        textOverlays: [
          { text: "Step 1: Hook", position: "top-left", style: "educational", duration: 10 },
        ],
        colorScheme: ["#007AFF", "#34C759", "#FF9500"],
        usageCount: 8750,
        performance: {
          averageViews: 125000,
          averageLikes: 8500,
          averageShares: 1200,
          engagementRate: 8.9,
        },
      },
      {
        id: "dance-challenge",
        name: "Dance Challenge",
        description: "Optimized for dance and movement content",
        category: "entertainment",
        aspectRatio: "9:16",
        resolution: { width: 1080, height: 1920 },
        duration: { min: 15, max: 30 },
        effects: ["beat-sync", "mirror", "slow-motion"],
        transitions: ["beat-match"],
        textOverlays: [
          { text: "#DanceChallenge", position: "bottom-center", style: "neon", duration: 15 },
        ],
        backgroundMusic: "dance-trending",
        colorScheme: ["#FF006E", "#FFBE0B", "#8338EC"],
        usageCount: 23100,
        performance: {
          averageViews: 195000,
          averageLikes: 15800,
          averageShares: 3200,
          engagementRate: 9.8,
        },
      },
    ];

    return category ? templates.filter((t) => t.category === category) : templates;
  }

  /**
   * Apply video template
   */
  async applyTemplate(
    inputPath: string,
    templateId: string,
    customizations: Partial<TikTokVideoProcessingOptions> = {}
  ): Promise<TikTokProcessedVideo> {
    const template = this.getVideoTemplates().find((t) => t.id === templateId);
    if (!template) throw ProviderError.notFound("tiktok", `Template: ${templateId}`);

    const options: TikTokVideoProcessingOptions = {
      targetAspectRatio: template.aspectRatio as any,
      targetResolution: template.resolution.height >= 1920 ? "1080p" : "720p",
      quality: "high",
      addEffects: template.effects,
      ...customizations,
    };

    return this.processVideo(inputPath, options);
  }

  /**
   * Batch process multiple videos
   */
  async batchProcessVideos(
    inputs: Array<{ path: string; options?: TikTokVideoProcessingOptions }>,
    concurrency: number = 2
  ): Promise<TikTokProcessedVideo[]> {
    const results: TikTokProcessedVideo[] = [];

    for (let i = 0; i < inputs.length; i += concurrency) {
      const batch = inputs.slice(i, i + concurrency);
      const batchPromises = batch.map((input) => this.processVideo(input.path, input.options));
      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          logger.error({ err: result.reason, path: batch[index]?.path }, "Failed to process video");
        }
      });
    }

    return results;
  }

  /**
   * Clean up temporary files
   */
  async cleanup(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        logger.warn({ err: error, filePath }, "Failed to cleanup file");
      }
    }
  }

  getCircuitBreakerStatus(): Record<string, any> {
    return circuitBreaker.getAllStatuses();
  }

  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  clearCache(): void {
    circuitBreaker.clearCache("tiktok-video-processor");
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private async executeVideoProcessing(
    inputPath: string,
    outputPath: string,
    params: any
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath);

      command = command
        .videoCodec(params.codec)
        .outputFormat(params.format)
        .size(`${params.resolution.width}x${params.resolution.height}`)
        .aspect(params.aspectRatio);

      if (params.optimizations.includes("compress")) {
        command = command.videoBitrate("2000k");
      }
      if (params.optimizations.includes("enhance-audio")) {
        command = command.audioCodec("aac").audioBitrate("128k");
      }

      command
        .on("end", () => resolve())
        .on("error", (err: any) => reject(new Error(`Video processing failed: ${err.message}`)))
        .save(outputPath);
    });
  }

  private async generateThumbnail(videoPath: string, thumbnailPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ["10%"],
          filename: path.basename(thumbnailPath),
          folder: path.dirname(thumbnailPath),
          size: "720x1280",
        })
        .on("end", () => resolve())
        .on("error", (err: any) =>
          reject(new Error(`Thumbnail generation failed: ${err.message}`))
        );
    });
  }

  private async generatePreviewGif(videoPath: string, gifPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .inputOptions(["-t 3"])
        .outputOptions(["-vf scale=320:-1", "-r 10", "-f gif"])
        .on("end", () => resolve())
        .on("error", (err: any) =>
          reject(new Error(`Preview GIF generation failed: ${err.message}`))
        )
        .save(gifPath);
    });
  }
}
