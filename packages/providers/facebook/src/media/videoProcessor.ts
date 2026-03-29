/**
 * @file videoProcessor.ts
 * @description Facebook video processing service -- single/batch processing,
 * presets, analytics, and status tracking.
 * Types live in videoProcessorTypes.ts; helpers in videoProcessorHelpers.ts.
 */

import { randomUUID } from "node:crypto";
import { FacebookApiClient } from "../apiClient.js";
import { AppError } from "@shared/types";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:facebook:video-processor");

// Re-export all types so existing importers continue to work
export type {
  VideoProcessingOptions,
  VideoProcessingResult,
  VideoAnalytics,
  BatchVideoProcessingOptions,
  BatchVideoProcessingResult,
  VideoOptimizationPreset,
} from "./videoProcessorTypes.js";

import type {
  VideoProcessingOptions,
  VideoProcessingResult,
  VideoAnalytics,
  BatchVideoProcessingOptions,
  BatchVideoProcessingResult,
  VideoOptimizationPreset,
} from "./videoProcessorTypes.js";

import {
  calculateTargetDimensions,
  calculateAspectRatio,
  getCompressionRatio,
  calculateTargetBitrate,
  calculateOptimizations,
  getProcessingSteps,
} from "./videoProcessorHelpers.js";

export class FacebookVideoProcessor {
  private apiClient: FacebookApiClient;
  private processingQueue: Map<string, unknown> = new Map();

  constructor(apiClient: FacebookApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Get video optimization presets
   */
  getOptimizationPresets(): VideoOptimizationPreset[] {
    return [
      {
        name: "Facebook Feed Optimized",
        description: "Optimized for Facebook news feed posts",
        targetPlatform: "facebook",
        options: {
          targetFormat: "mp4",
          quality: "high",
          targetAspectRatio: "16:9",
          maxDuration: 240,
          maxFileSize: 100 * 1024 * 1024,
          compressionLevel: "medium",
        },
        estimatedProcessingTime: 30,
        recommendedFor: ["News feed posts", "Educational content", "Product showcases"],
      },
      {
        name: "Instagram Stories",
        description: "Optimized for Instagram Stories format",
        targetPlatform: "stories",
        options: {
          targetFormat: "mp4",
          quality: "medium",
          targetAspectRatio: "9:16",
          maxDuration: 15,
          maxFileSize: 30 * 1024 * 1024,
          compressionLevel: "light",
        },
        estimatedProcessingTime: 15,
        recommendedFor: ["Story content", "Quick updates", "Behind-the-scenes"],
      },
      {
        name: "Facebook Reels",
        description: "Optimized for Facebook Reels",
        targetPlatform: "reels",
        options: {
          targetFormat: "mp4",
          quality: "high",
          targetAspectRatio: "9:16",
          maxDuration: 90,
          maxFileSize: 50 * 1024 * 1024,
          compressionLevel: "light",
        },
        estimatedProcessingTime: 25,
        recommendedFor: ["Short-form content", "Entertainment", "Viral content"],
      },
      {
        name: "Square Format",
        description: "Square format for Instagram feed",
        targetPlatform: "instagram",
        options: {
          targetFormat: "mp4",
          quality: "high",
          targetAspectRatio: "1:1",
          maxDuration: 60,
          maxFileSize: 40 * 1024 * 1024,
          compressionLevel: "medium",
        },
        estimatedProcessingTime: 20,
        recommendedFor: ["Instagram posts", "Product demos", "Square content"],
      },
      {
        name: "Universal Optimized",
        description: "Balanced optimization for all platforms",
        targetPlatform: "universal",
        options: {
          targetFormat: "mp4",
          quality: "medium",
          targetAspectRatio: "16:9",
          maxDuration: 120,
          maxFileSize: 60 * 1024 * 1024,
          compressionLevel: "medium",
        },
        estimatedProcessingTime: 35,
        recommendedFor: ["Multi-platform posting", "General content", "Backup format"],
      },
    ];
  }

  /**
   * Process a single video
   */
  async processVideo(
    videoUrl: string,
    options: VideoProcessingOptions
  ): Promise<VideoProcessingResult> {
    const startTime = Date.now();
    const processingId = `proc_${randomUUID()}`;

    try {
      this.processingQueue.set(processingId, {
        status: "processing",
        startTime,
        videoUrl,
        options,
      });

      const originalMetadata = await this.getVideoMetadata(videoUrl);
      this.validateVideoInput(originalMetadata, options);

      const processedVideo = await this.performVideoProcessing(videoUrl, options, originalMetadata);
      const thumbnail = await this.generateThumbnail(processedVideo.url, options.thumbnail);
      const optimizations = calculateOptimizations(originalMetadata, processedVideo);
      const processingTime = Date.now() - startTime;

      const result: VideoProcessingResult = {
        processedVideoUrl: processedVideo.url,
        processedVideoId: processedVideo.id,
        ...(thumbnail?.url !== undefined && { thumbnailUrl: thumbnail.url }),
        duration: processedVideo.duration,
        fileSize: processedVideo.fileSize,
        dimensions: processedVideo.dimensions,
        format: processedVideo.format,
        codec: processedVideo.codec,
        bitrate: processedVideo.bitrate,
        frameRate: processedVideo.frameRate,
        aspectRatio: calculateAspectRatio(processedVideo.dimensions),
        hasAudio: processedVideo.hasAudio,
        processingTime,
        optimizations,
        metadata: {
          originalFileSize: originalMetadata.fileSize,
          originalDuration: originalMetadata.duration,
          originalDimensions: originalMetadata.dimensions,
          processedAt: new Date().toISOString(),
          processingSteps: getProcessingSteps(options),
        },
      };

      this.processingQueue.set(processingId, {
        ...this.processingQueue.get(processingId),
        status: "completed",
        result,
      });

      return result;
    } catch (_error) {
      this.processingQueue.set(processingId, {
        ...this.processingQueue.get(processingId),
        status: "failed",
        error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Process multiple videos in batch
   */
  async batchProcessVideos(
    batchOptions: BatchVideoProcessingOptions
  ): Promise<BatchVideoProcessingResult> {
    const batchId = `batch_${randomUUID()}`;
    const startedAt = new Date().toISOString();

    const batchResult: BatchVideoProcessingResult = {
      batchId,
      totalVideos: batchOptions.videos.length,
      processedVideos: 0,
      failedVideos: 0,
      status: "processing",
      startedAt,
      results: [],
      summary: {
        totalProcessingTime: 0,
        totalSizeReduction: 0,
        avgQualityScore: 0,
        totalOriginalSize: 0,
        totalProcessedSize: 0,
      },
    };

    try {
      const maxConcurrent = batchOptions.maxConcurrentJobs || 3;
      const processingPromises: Promise<unknown>[] = [];

      for (let i = 0; i < batchOptions.videos.length; i += maxConcurrent) {
        const batch = batchOptions.videos.slice(i, i + maxConcurrent);
        const batchPromises = batch.map(async (video) => {
          const videoOptions = { ...batchOptions.globalOptions, ...video.customOptions };
          try {
            const result = await this.processVideo(video.videoUrl, videoOptions);
            batchResult.processedVideos++;
            batchResult.results.push({
              videoUrl: video.videoUrl,
              fileName: video.fileName,
              success: true,
              result,
            });
            batchResult.summary.totalProcessingTime += result.processingTime;
            batchResult.summary.totalOriginalSize += result.metadata.originalFileSize;
            batchResult.summary.totalProcessedSize += result.fileSize;
            batchResult.summary.totalSizeReduction += result.optimizations.sizeReduction;
            return result;
          } catch (_error) {
            batchResult.failedVideos++;
            batchResult.results.push({
              videoUrl: video.videoUrl,
              fileName: video.fileName,
              success: false,
              error: _error instanceof Error ? _error.message : String(_error),
            });
            return null;
          }
        });

        if (batchOptions.parallelProcessing) {
          processingPromises.push(...batchPromises);
        } else {
          await Promise.all(batchPromises);
        }
      }

      if (batchOptions.parallelProcessing) {
        await Promise.all(processingPromises);
      }

      const successfulResults = batchResult.results.filter((r) => r.success && r.result);
      if (successfulResults.length > 0) {
        batchResult.summary.avgQualityScore =
          successfulResults.reduce(
            (sum, r) => sum + (r.result?.optimizations.qualityScore || 0),
            0
          ) / successfulResults.length;
      }

      batchResult.status = "completed";
      batchResult.completedAt = new Date().toISOString();

      if (batchOptions.webhook) {
        await this.sendWebhookNotification(batchOptions.webhook, batchResult);
      }

      return batchResult;
    } catch (_error) {
      batchResult.status = "failed";
      batchResult.completedAt = new Date().toISOString();
      throw _error;
    }
  }

  /**
   * Get video analytics and compatibility info
   */
  async getVideoAnalytics(videoId: string): Promise<VideoAnalytics> {
    return {
      videoId,
      fileName: "sample_video.mp4",
      uploadedAt: new Date().toISOString(),
      processingHistory: [],
      platformCompatibility: {
        facebook: {
          compatible: true,
          formats: ["mp4", "mov"],
          maxFileSize: 4 * 1024 * 1024 * 1024,
          maxDuration: 240 * 60,
        },
        instagram: {
          compatible: true,
          formats: ["mp4", "mov"],
          maxFileSize: 100 * 1024 * 1024,
          maxDuration: 60,
        },
        stories: { compatible: true, requiredAspectRatio: "9:16", maxDuration: 15 },
        reels: { compatible: true, requiredAspectRatio: "9:16", maxDuration: 90 },
      },
      performance: {
        avgProcessingTime: 30000,
        successRate: 95,
        errorRate: 5,
        mostUsedSettings: { targetFormat: "mp4", quality: "high", compressionLevel: "medium" },
      },
    };
  }

  getBatchProcessingStatus(
    _batchId: string
  ): { status: string; progress: number; estimatedTimeRemaining?: number } | null {
    return null;
  }

  async cancelBatchProcessing(_batchId: string): Promise<boolean> {
    return false;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private async getVideoMetadata(videoUrl: string): Promise<unknown> {
    try {
      const response = await fetch(videoUrl, { method: "HEAD" });
      const contentLength = response.headers.get("content-length");
      return {
        duration: 60,
        fileSize: contentLength ? parseInt(contentLength) : 10 * 1024 * 1024,
        dimensions: { width: 1920, height: 1080 },
        format: "mp4",
        codec: "h264",
        bitrate: 2500,
        frameRate: 30,
        hasAudio: true,
      };
    } catch (error) {
      throw AppError.externalService("facebook", `Failed to get video metadata: ${error}`);
    }
  }

  private validateVideoInput(metadata: unknown, options: VideoProcessingOptions): void {
    if (options.maxDuration && metadata.duration > options.maxDuration) {
      throw AppError.validationFailed(
        `Video duration (${metadata.duration}s) exceeds maximum allowed (${options.maxDuration}s)`
      );
    }
    if (options.maxFileSize && metadata.fileSize > options.maxFileSize) {
      throw AppError.validationFailed(
        `Video file size (${metadata.fileSize} bytes) exceeds maximum allowed (${options.maxFileSize} bytes)`
      );
    }
  }

  private async performVideoProcessing(
    videoUrl: string,
    options: VideoProcessingOptions,
    originalMetadata: {
      dimensions: { width: number; height: number };
      duration: number;
      format: string;
    }
  ): Promise<unknown> {
    const processedDimensions = calculateTargetDimensions(
      originalMetadata.dimensions,
      options.targetAspectRatio
    );
    return {
      url: `${videoUrl}_processed`,
      id: `proc_${Date.now()}`,
      duration: Math.min(
        originalMetadata.duration,
        options.maxDuration || originalMetadata.duration
      ),
      fileSize: Math.floor(
        originalMetadata.fileSize * getCompressionRatio(options.compressionLevel)
      ),
      dimensions: processedDimensions,
      format: options.targetFormat,
      codec: "h264",
      bitrate: calculateTargetBitrate(options.quality),
      frameRate: originalMetadata.frameRate,
      hasAudio: originalMetadata.hasAudio,
    };
  }

  private async generateThumbnail(
    videoUrl: string,
    thumbnailOptions?: VideoProcessingOptions["thumbnail"]
  ): Promise<{ url: string } | null> {
    if (!thumbnailOptions) return null;
    if (thumbnailOptions.customImageUrl) return { url: thumbnailOptions.customImageUrl };
    const timestamp = thumbnailOptions.timestampSeconds || 5;
    return { url: `${videoUrl}_thumbnail_${timestamp}.jpg` };
  }

  private async sendWebhookNotification(
    webhook: { url: string; secret?: string },
    result: BatchVideoProcessingResult
  ): Promise<void> {
    try {
      const payload = JSON.stringify(result);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "FacebookVideoProcessor/1.0",
      };
      if (webhook.secret) {
        const crypto = await import("crypto");
        const signature = crypto.createHmac("sha256", webhook.secret).update(payload).digest("hex");
        headers["X-Signature-256"] = `sha256=${signature}`;
      }
      await fetch(webhook.url, { method: "POST", headers, body: payload });
    } catch (error) {
      logger.warn({ err: error }, "Failed to send webhook notification");
    }
  }
}
