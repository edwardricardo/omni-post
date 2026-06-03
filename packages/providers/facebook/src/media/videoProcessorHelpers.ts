/**
 * @file videoProcessorHelpers.ts
 * @description Pure helper functions for Facebook video processing calculations.
 * Extracted from FacebookVideoProcessor to keep files under 600 lines.
 * @layer infrastructure
 */

import type { VideoProcessingOptions, VideoProcessingResult } from "./videoProcessorTypes.js";

/**
 * Calculate target dimensions based on aspect ratio.
 */
export function calculateTargetDimensions(
  originalDimensions: { width: number; height: number },
  targetAspectRatio?: string
): { width: number; height: number } {
  if (!targetAspectRatio) return originalDimensions;

  const parts = targetAspectRatio.split(":").map(Number);
  const widthRatio = parts[0] ?? 1;
  const heightRatio = parts[1] ?? 1;
  const targetRatio = widthRatio / heightRatio;

  let newWidth = originalDimensions.width;
  let newHeight = originalDimensions.height;

  const currentRatio = originalDimensions.width / originalDimensions.height;

  if (currentRatio > targetRatio) {
    newWidth = Math.round(originalDimensions.height * targetRatio);
  } else {
    newHeight = Math.round(originalDimensions.width / targetRatio);
  }

  return { width: newWidth, height: newHeight };
}

/**
 * Calculate aspect ratio string from dimensions.
 */
export function calculateAspectRatio(dimensions: { width: number; height: number }): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(dimensions.width, dimensions.height);
  const width = dimensions.width / divisor;
  const height = dimensions.height / divisor;
  return `${width}:${height}`;
}

/**
 * Get compression ratio multiplier based on compression level.
 */
export function getCompressionRatio(compressionLevel?: string): number {
  switch (compressionLevel) {
    case "light":
      return 0.8;
    case "medium":
      return 0.6;
    case "heavy":
      return 0.4;
    default:
      return 0.6;
  }
}

/**
 * Calculate target bitrate based on quality setting.
 */
export function calculateTargetBitrate(quality?: string): number {
  switch (quality) {
    case "low":
      return 1000;
    case "medium":
      return 2500;
    case "high":
      return 5000;
    case "original":
      return 8000;
    default:
      return 2500;
  }
}

/**
 * Calculate optimizations achieved by comparing original and processed metadata.
 */
export function calculateOptimizations(
  originalMetadata: { fileSize: number },
  processedVideo: { fileSize: number }
): VideoProcessingResult["optimizations"] {
  const sizeReduction =
    ((originalMetadata.fileSize - processedVideo.fileSize) / originalMetadata.fileSize) * 100;
  const compressionRatio = originalMetadata.fileSize / processedVideo.fileSize;
  const qualityScore = Math.max(0, Math.min(100, 100 - sizeReduction * 0.5));

  return {
    sizeReduction: Math.max(0, sizeReduction),
    qualityScore,
    compressionRatio,
  };
}

/**
 * Build a list of human-readable processing step descriptions.
 */
export function getProcessingSteps(options: VideoProcessingOptions): string[] {
  const steps = [];

  if (options.targetFormat) {
    steps.push(`Convert to ${options.targetFormat.toUpperCase()}`);
  }
  if (options.targetAspectRatio) {
    steps.push(`Resize to ${options.targetAspectRatio} aspect ratio`);
  }
  if (options.compressionLevel) {
    steps.push(`Apply ${options.compressionLevel} compression`);
  }
  if (options.watermark) {
    steps.push("Add watermark");
  }
  if (options.subtitles) {
    steps.push("Add subtitles");
  }
  if (options.audioDubbing) {
    steps.push("Process audio");
  }

  return steps;
}
