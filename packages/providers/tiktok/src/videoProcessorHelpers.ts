/**
 * @file videoProcessorHelpers.ts
 * @description Pure helper functions for TikTok video processing calculations.
 * Extracted from TikTokVideoProcessor to keep files under 600 lines.
 */

import type {
  TikTokVideoSpecs,
  TikTokVideoAnalysis,
  TikTokVideoProcessingOptions,
} from "./videoProcessorTypes.js";

/**
 * TikTok video specifications constant.
 */
export const TIKTOK_VIDEO_SPECS: TikTokVideoSpecs = {
  maxFileSize: 500 * 1024 * 1024, // 500MB
  maxDuration: 180, // 3 minutes
  minDuration: 3, // 3 seconds
  aspectRatios: [
    { width: 9, height: 16, name: "9:16" }, // Vertical (recommended)
    { width: 1, height: 1, name: "1:1" }, // Square
    { width: 16, height: 9, name: "16:9" }, // Horizontal
  ],
  resolutions: [
    { width: 720, height: 1280, quality: "720p" },
    { width: 1080, height: 1920, quality: "1080p" },
    { width: 1440, height: 2560, quality: "2K" },
    { width: 2160, height: 3840, quality: "4K" },
  ],
  formats: ["mp4", "mov", "webm"],
  codecs: ["h264", "h265", "vp9"],
  audioCodecs: ["aac", "mp3"],
  audioSampleRates: [44100, 48000],
  audioBitRates: [128, 192, 256, 320], // kbps
};

/**
 * Calculate aspect ratio string from width and height.
 */
export function calculateAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/**
 * Parse a frame rate string (e.g. "30/1") into a numeric value.
 */
export function parseFrameRate(frameRateStr: string): number {
  const parts = frameRateStr.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return parseFloat(parts[0]) / parseFloat(parts[1]);
  }
  return parseFloat(frameRateStr);
}

/**
 * Validate a video analysis against TikTok specifications and populate
 * issues and recommendations arrays in place.
 */
export function validateCompliance(analysis: TikTokVideoAnalysis): void {
  const specs = TIKTOK_VIDEO_SPECS;
  let isCompliant = true;

  // Check file size
  if (analysis.fileSize > specs.maxFileSize) {
    analysis.issues.push({
      type: "error",
      code: "FILE_SIZE_TOO_LARGE",
      message: `File size ${(analysis.fileSize / 1024 / 1024).toFixed(2)}MB exceeds maximum ${specs.maxFileSize / 1024 / 1024}MB`,
      suggestion: "Compress video or reduce quality",
    });
    isCompliant = false;
  }

  // Check duration
  if (analysis.duration > specs.maxDuration) {
    analysis.issues.push({
      type: "error",
      code: "DURATION_TOO_LONG",
      message: `Duration ${analysis.duration}s exceeds maximum ${specs.maxDuration}s`,
      suggestion: "Trim video to fit within duration limit",
    });
    isCompliant = false;
  }

  if (analysis.duration < specs.minDuration) {
    analysis.issues.push({
      type: "error",
      code: "DURATION_TOO_SHORT",
      message: `Duration ${analysis.duration}s is below minimum ${specs.minDuration}s`,
      suggestion: "Extend video content or add padding",
    });
    isCompliant = false;
  }

  // Check aspect ratio
  const supportedRatios = specs.aspectRatios.map((r) => r.name);
  if (!supportedRatios.includes(analysis.aspectRatio)) {
    analysis.issues.push({
      type: "warning",
      code: "UNSUPPORTED_ASPECT_RATIO",
      message: `Aspect ratio ${analysis.aspectRatio} is not optimal for TikTok`,
      suggestion: "Consider cropping to 9:16 for best performance",
    });
  }

  // Check format
  if (!specs.formats.includes(analysis.format.toLowerCase())) {
    analysis.issues.push({
      type: "warning",
      code: "UNSUPPORTED_FORMAT",
      message: `Format ${analysis.format} may not be supported`,
      suggestion: "Convert to MP4 for best compatibility",
    });
  }

  // Add recommendations based on analysis
  if (analysis.aspectRatio !== "9:16") {
    analysis.recommendations.push({
      optimization: "Convert to vertical format",
      impact: "high",
      description: "9:16 aspect ratio performs best on TikTok",
    });
  }

  if (analysis.resolution.height < 1080) {
    analysis.recommendations.push({
      optimization: "Upscale to 1080p",
      impact: "medium",
      description: "Higher resolution improves video quality",
    });
  }

  if (analysis.frameRate < 30) {
    analysis.recommendations.push({
      optimization: "Increase frame rate",
      impact: "low",
      description: "30fps provides smoother playback",
    });
  }

  analysis.isCompliant = isCompliant;
}

/**
 * Calculate processing parameters from analysis and user options.
 */
export function calculateProcessingParameters(
  _analysis: TikTokVideoAnalysis,
  options: TikTokVideoProcessingOptions
): {
  format: string;
  codec: string;
  resolution: { width: number; height: number };
  aspectRatio: string;
  quality: string;
  optimizations: unknown;
} {
  // Determine target resolution based on options
  let targetResolution = { width: 1080, height: 1920 }; // Default 9:16 1080p

  if (options.targetAspectRatio === "1:1") {
    targetResolution = { width: 1080, height: 1080 };
  } else if (options.targetAspectRatio === "16:9") {
    targetResolution = { width: 1920, height: 1080 };
  }

  if (options.targetResolution === "720p") {
    targetResolution.width = Math.round(targetResolution.width * 0.75);
    targetResolution.height = Math.round(targetResolution.height * 0.75);
  }

  return {
    format: options.targetFormat || "mp4",
    codec: options.targetCodec || "h264",
    resolution: targetResolution,
    aspectRatio: options.targetAspectRatio || "9:16",
    quality: options.quality || "high",
    optimizations: determineOptimizations(_analysis, options),
  };
}

/**
 * Determine which optimizations to apply based on the video analysis and options.
 */
export function determineOptimizations(
  analysis: TikTokVideoAnalysis,
  options: TikTokVideoProcessingOptions
): string[] {
  const optimizations: string[] = [];

  if (analysis.fileSize > TIKTOK_VIDEO_SPECS.maxFileSize * 0.8) {
    optimizations.push("compress");
  }

  if (analysis.aspectRatio !== (options.targetAspectRatio || "9:16")) {
    optimizations.push("crop");
  }

  if (analysis.resolution.height < 1080) {
    optimizations.push("upscale");
  }

  if (analysis.frameRate < 30) {
    optimizations.push("interpolate");
  }

  if (options.enhanceAudio) {
    optimizations.push("enhance-audio");
  }

  if (options.colorCorrection) {
    optimizations.push("color-correction");
  }

  return optimizations;
}
