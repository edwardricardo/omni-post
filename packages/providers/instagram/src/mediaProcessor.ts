import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { isOk as _isOk, isErr, unwrap, AppError, type Result as _Result } from "@shared/types";
import client from "prom-client";
import ffmpeg, { FfmpegCommand, FfprobeData } from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import os from "os";

export interface VideoSegment {
  id: string;
  url: string;
  duration: number; // Duration in seconds
  sequence: number; // Order in the sequence
  startTime: number; // Start time in original video
  endTime: number; // End time in original video
}

export interface VideoSplitOptions {
  segmentLength?: number; // Length of each segment in seconds (default: 15)
  maxSegments?: number; // Maximum number of segments (default: 100 for Stories limit)
  aspectRatio?: "9:16" | "1:1" | "16:9"; // Target aspect ratio
  quality?: "low" | "medium" | "high"; // Video quality
  addTransitions?: boolean; // Add fade transitions between segments
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  format: string;
  bitrate: number;
  frameRate: number;
}

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class InstagramMediaProcessor {
  private storageBaseUrl: string;

  constructor(
    storageBaseUrl: string = process.env.MEDIA_STORAGE_URL || "https://your-storage.com"
  ) {
    this.storageBaseUrl = storageBaseUrl;
  }

  /**
   * Get video metadata using FFprobe
   */
  async getVideoMetadata(videoUrl: string): Promise<VideoMetadata> {
    const metadataCall = async (): Promise<VideoMetadata> => {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoUrl, (err: any, metadata: FfprobeData) => {
          if (err) {
            reject(new Error(`FFprobe error: ${err.message}`));
            return;
          }

          const videoStream = metadata.streams.find((stream) => stream.codec_type === "video");
          if (!videoStream) {
            reject(new Error("No video stream found"));
            return;
          }

          const duration = parseFloat(String(metadata.format.duration || "0"));
          const bitrate = parseInt(String(metadata.format.bit_rate || "0"), 10);
          const width = videoStream.width || 0;
          const height = videoStream.height || 0;
          const frameRate = this.parseFrameRate(videoStream.r_frame_rate || "0/1");
          const format = metadata.format.format_name?.split(",")[0] || "unknown";

          resolve({
            duration,
            width,
            height,
            format,
            bitrate,
            frameRate,
          });
        });
      });
    };

    return circuitBreaker.call("media-analysis", "get-metadata", metadataCall, [], {
      timeout: 30000,
      maxRetries: 2,
      baseDelay: 1000,
      jitterEnabled: true,
    });
  }

  /**
   * Parse frame rate from FFprobe format (e.g., "30/1" -> 30)
   */
  private parseFrameRate(frameRateString: string): number {
    const parts = frameRateString.split("/");
    if (parts.length === 2) {
      const numerator = parseInt(parts[0] || "0", 10);
      const denominator = parseInt(parts[1] || "1", 10);
      return denominator !== 0 ? numerator / denominator : 0;
    }
    return parseFloat(frameRateString) || 0;
  }

  /**
   * Split video into segments for Instagram Stories
   */
  async splitVideoForStories(
    videoUrl: string,
    options: VideoSplitOptions = {}
  ): Promise<VideoSegment[]> {
    const {
      segmentLength = 15,
      maxSegments = 100,
      aspectRatio = "9:16",
      quality = "high",
      addTransitions = false,
    } = options;

    const splitCall = async (): Promise<VideoSegment[]> => {
      // Get video metadata first
      const metadata = await this.getVideoMetadata(videoUrl);

      // Calculate number of segments needed
      const totalSegments = Math.min(Math.ceil(metadata.duration / segmentLength), maxSegments);

      const segments: VideoSegment[] = [];

      for (let i = 0; i < totalSegments; i++) {
        const startTime = i * segmentLength;
        const endTime = Math.min(startTime + segmentLength, metadata.duration);
        const actualDuration = endTime - startTime;

        // In a real implementation, this would use FFmpeg to create the segment:
        // ffmpeg -i input.mp4 -ss ${startTime} -t ${actualDuration} -c copy segment_${i}.mp4

        const segmentId = `${Date.now()}_${i}`;
        const segmentUrl = await this.processVideoSegment(
          videoUrl,
          startTime,
          actualDuration,
          segmentId,
          { aspectRatio, quality, addTransitions }
        );

        segments.push({
          id: segmentId,
          url: segmentUrl,
          duration: actualDuration,
          sequence: i + 1,
          startTime,
          endTime,
        });
      }

      return segments;
    };

    return circuitBreaker.call("video-splitting", "split-video", splitCall, [], {
      timeout: 120000, // 2 minutes for video processing
      maxRetries: 1, // Video processing is expensive, limit retries
      baseDelay: 5000,
      jitterEnabled: true,
    });
  }

  /**
   * Process individual video segment with optimizations
   */
  private async processVideoSegment(
    originalVideoUrl: string,
    startTime: number,
    duration: number,
    segmentId: string,
    options: {
      aspectRatio?: string;
      quality?: string;
      addTransitions?: boolean;
    }
  ): Promise<string> {
    const processCall = async (): Promise<string> => {
      const tempDir = os.tmpdir();
      const outputPath = path.join(tempDir, `segment_${segmentId}.mp4`);

      return new Promise((resolve, reject) => {
        try {
          let command: FfmpegCommand = ffmpeg(originalVideoUrl)
            .seekInput(startTime)
            .duration(duration)
            .videoCodec("libx264")
            .audioCodec("aac")
            .audioBitrate("128k")
            .addOption("-preset", "fast")
            .addOption("-movflags", "+faststart");

          // Set quality based on options
          const crf = options.quality === "low" ? "28" : options.quality === "high" ? "18" : "23";
          command = command.addOption("-crf", crf);

          // Apply aspect ratio scaling if specified
          if (options.aspectRatio === "9:16") {
            command = command.videoFilters([
              "scale=1080:1920:force_original_aspect_ratio=increase",
              "crop=1080:1920",
            ]);
          } else if (options.aspectRatio === "1:1") {
            command = command.videoFilters([
              "scale=1080:1080:force_original_aspect_ratio=increase",
              "crop=1080:1080",
            ]);
          }

          // Add fade-in transition if requested and not first segment
          if (options.addTransitions && startTime > 0) {
            command = command.videoFilters(["fade=in:0:15"]); // 15 frame fade-in
          }

          command
            .output(outputPath)
            .on("end", () => {
              // Handle upload in separate async function
              (async () => {
                try {
                  // Upload processed segment to storage
                  const { createS3StorageAdapter } = await import("@adapters/storage-s3");

                  if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) {
                    throw AppError.configuration(
                      "AWS_REGION and AWS_S3_BUCKET environment variables are required"
                    );
                  }

                  const s3Config = {
                    region: process.env.AWS_REGION,
                    bucket: process.env.AWS_S3_BUCKET,
                    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
                      ? {
                          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                        }
                      : {}),
                    ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
                  };

                  const storageAdapter = createS3StorageAdapter(s3Config);
                  const fileBuffer = await fs.promises.readFile(outputPath);
                  const filename = `segments/${segmentId}.mp4`;

                  const signatureResult = await storageAdapter.generateUploadSignature(
                    filename,
                    "video/mp4"
                  );

                  if (isErr(signatureResult)) {
                    throw AppError.externalService(
                      "s3",
                      `Failed to generate upload signature: ${signatureResult.error}`
                    );
                  }

                  const signature = unwrap(signatureResult);
                  const formData = new FormData();

                  Object.entries(signature.fields).forEach(([key, value]) => {
                    formData.append(key, value);
                  });

                  const fileBlob = new Blob([new Uint8Array(fileBuffer)], { type: "video/mp4" });
                  formData.append("file", fileBlob);

                  const uploadResponse = await fetch(signature.url, {
                    method: "POST",
                    body: formData,
                  });

                  if (!uploadResponse.ok) {
                    throw AppError.externalService(
                      "s3",
                      `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
                    );
                  }

                  // Clean up temporary file
                  await fs.promises.unlink(outputPath).catch(() => {});

                  const mediaUrl = `${signature.url}${signature.fields.key}`;
                  resolve(mediaUrl);
                } catch (uploadError) {
                  reject(uploadError);
                }
              })();
            })
            .on("error", (err: any) => {
              reject(AppError.externalService("ffmpeg", `FFmpeg processing error: ${err.message}`));
            })
            .run();
        } catch (error) {
          reject(error);
        }
      });
    };

    return circuitBreaker.call("segment-processing", "process-segment", processCall, [], {
      timeout: 180000, // 3 minutes per segment
      maxRetries: 1,
      baseDelay: 2000,
      jitterEnabled: true,
    });
  }

  /**
   * Optimize video for Instagram Reels (90-second limit, 9:16 aspect ratio)
   */
  async optimizeForReels(videoUrl: string): Promise<string> {
    const optimizeCall = async (): Promise<string> => {
      const metadata = await this.getVideoMetadata(videoUrl);

      // Check if optimization is needed
      const needsOptimization =
        metadata.duration > 90 || // Exceeds Reels limit
        metadata.width !== 1080 ||
        metadata.height !== 1920; // Not 9:16 aspect ratio

      if (!needsOptimization) {
        return videoUrl; // Return original if already optimized
      }

      const tempDir = os.tmpdir();
      const optimizedId = `reel_${Date.now()}`;
      const outputPath = path.join(tempDir, `${optimizedId}.mp4`);

      return new Promise((resolve, reject) => {
        try {
          ffmpeg(videoUrl)
            .duration(Math.min(90, metadata.duration)) // Limit to 90 seconds
            .videoCodec("libx264")
            .audioCodec("aac")
            .audioBitrate("128k")
            .addOption("-preset", "fast")
            .addOption("-crf", "23")
            .addOption("-movflags", "+faststart")
            .videoFilters([
              "scale=1080:1920:force_original_aspect_ratio=increase",
              "crop=1080:1920",
            ])
            .output(outputPath)
            .on("end", async () => {
              try {
                // Upload optimized video to storage
                const { createS3StorageAdapter } = await import("@adapters/storage-s3");

                if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) {
                  throw AppError.configuration(
                    "AWS_REGION and AWS_S3_BUCKET environment variables are required"
                  );
                }

                const s3Config = {
                  region: process.env.AWS_REGION,
                  bucket: process.env.AWS_S3_BUCKET,
                  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
                    ? {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                      }
                    : {}),
                  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
                };

                const storageAdapter = createS3StorageAdapter(s3Config);
                const fileBuffer = await fs.promises.readFile(outputPath);
                const filename = `reels/${optimizedId}.mp4`;

                const signatureResult = await storageAdapter.generateUploadSignature(
                  filename,
                  "video/mp4"
                );

                if (isErr(signatureResult)) {
                  throw AppError.externalService(
                    "s3",
                    `Failed to generate upload signature: ${signatureResult.error}`
                  );
                }

                const signature = unwrap(signatureResult);
                const formData = new FormData();

                Object.entries(signature.fields).forEach(([key, value]) => {
                  formData.append(key, value);
                });

                const fileBlob = new Blob([new Uint8Array(fileBuffer)], { type: "video/mp4" });
                formData.append("file", fileBlob);

                const uploadResponse = await fetch(signature.url, {
                  method: "POST",
                  body: formData,
                });

                if (!uploadResponse.ok) {
                  throw AppError.externalService(
                    "s3",
                    `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
                  );
                }

                // Clean up temporary file
                await fs.promises.unlink(outputPath).catch(() => {});

                const mediaUrl = `${signature.url}${signature.fields.key}`;
                resolve(mediaUrl);
              } catch (uploadError) {
                reject(uploadError);
              }
            })
            .on("error", (err: any) => {
              reject(
                AppError.externalService("ffmpeg", `FFmpeg optimization error: ${err.message}`)
              );
            })
            .run();
        } catch (error) {
          reject(error);
        }
      });
    };

    return circuitBreaker.call("reel-optimization", "optimize-reel", optimizeCall, [], {
      timeout: 180000, // 3 minutes for Reel optimization
      maxRetries: 1,
      baseDelay: 3000,
      jitterEnabled: true,
    });
  }

  /**
   * Create video thumbnail for previews
   */
  async createThumbnail(videoUrl: string, timeOffset: number = 0): Promise<string> {
    const thumbnailCall = async (): Promise<string> => {
      const tempDir = os.tmpdir();
      const thumbnailId = `thumb_${Date.now()}`;
      const outputPath = path.join(tempDir, `${thumbnailId}.jpg`);

      return new Promise((resolve, reject) => {
        try {
          ffmpeg(videoUrl)
            .seekInput(timeOffset)
            .frames(1) // Extract only 1 frame
            .addOption("-q:v", "2") // High quality JPEG
            .output(outputPath)
            .on("end", async () => {
              try {
                // Upload thumbnail to storage
                const { createS3StorageAdapter } = await import("@adapters/storage-s3");

                if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET) {
                  throw AppError.configuration(
                    "AWS_REGION and AWS_S3_BUCKET environment variables are required"
                  );
                }

                const s3Config = {
                  region: process.env.AWS_REGION,
                  bucket: process.env.AWS_S3_BUCKET,
                  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
                    ? {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                      }
                    : {}),
                  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
                };

                const storageAdapter = createS3StorageAdapter(s3Config);
                const fileBuffer = await fs.promises.readFile(outputPath);
                const filename = `thumbnails/${thumbnailId}.jpg`;

                const signatureResult = await storageAdapter.generateUploadSignature(
                  filename,
                  "image/jpeg"
                );

                if (isErr(signatureResult)) {
                  throw AppError.externalService(
                    "s3",
                    `Failed to generate upload signature: ${signatureResult.error}`
                  );
                }

                const signature = unwrap(signatureResult);
                const formData = new FormData();

                Object.entries(signature.fields).forEach(([key, value]) => {
                  formData.append(key, value);
                });

                const fileBlob = new Blob([new Uint8Array(fileBuffer)], { type: "image/jpeg" });
                formData.append("file", fileBlob);

                const uploadResponse = await fetch(signature.url, {
                  method: "POST",
                  body: formData,
                });

                if (!uploadResponse.ok) {
                  throw AppError.externalService(
                    "s3",
                    `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
                  );
                }

                // Clean up temporary file
                await fs.promises.unlink(outputPath).catch(() => {});

                const mediaUrl = `${signature.url}${signature.fields.key}`;
                resolve(mediaUrl);
              } catch (uploadError) {
                reject(uploadError);
              }
            })
            .on("error", (err: any) => {
              reject(new Error(`FFmpeg thumbnail error: ${err.message}`));
            })
            .run();
        } catch (error) {
          reject(error);
        }
      });
    };

    return circuitBreaker.call("thumbnail-creation", "create-thumbnail", thumbnailCall, [], {
      timeout: 60000, // 1 minute for thumbnail creation
      maxRetries: 2,
      baseDelay: 1000,
      jitterEnabled: true,
    });
  }

  /**
   * Validate video meets Instagram requirements
   */
  async validateVideo(
    videoUrl: string,
    contentType: "FEED" | "STORIES" | "REELS"
  ): Promise<{
    valid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const metadata = await this.getVideoMetadata(videoUrl);
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check duration limits
    switch (contentType) {
      case "STORIES":
        if (metadata.duration > 60) {
          issues.push("Stories videos must be 60 seconds or less");
          recommendations.push("Consider splitting into multiple Story segments");
        }
        break;
      case "REELS":
        if (metadata.duration > 90) {
          issues.push("Reels videos must be 90 seconds or less");
          recommendations.push("Trim video to 90 seconds or less");
        }
        if (metadata.duration < 5) {
          issues.push("Reels should be at least 5 seconds for optimal visibility");
        }
        break;
      case "FEED":
        if (metadata.duration > 600) {
          // 10 minutes
          issues.push("Feed videos should be under 10 minutes");
        }
        break;
    }

    // Check aspect ratio recommendations
    const aspectRatio = metadata.width / metadata.height;
    if (contentType === "STORIES" || contentType === "REELS") {
      if (Math.abs(aspectRatio - 9 / 16) > 0.1) {
        recommendations.push("Use 9:16 aspect ratio for optimal display in Stories/Reels");
      }
    }

    // Check file size (estimate)
    const estimatedFileSizeMB = (metadata.bitrate * metadata.duration) / (8 * 1024 * 1024);
    if (estimatedFileSizeMB > 100) {
      issues.push("Video file size may be too large");
      recommendations.push("Consider reducing bitrate or resolution");
    }

    return {
      valid: issues.length === 0,
      issues,
      recommendations,
    };
  }
}
