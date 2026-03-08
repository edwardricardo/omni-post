/**
 * @file videoProcessorTypes.ts
 * @description Type definitions for TikTok video processing.
 * Consumed by videoProcessor.ts, videoProcessorHelpers.ts, and any module
 * that interacts with TikTok video features.
 */

export interface TikTokVideoSpecs {
  // Video specifications
  maxFileSize: number; // 500MB for TikTok
  maxDuration: number; // 180 seconds (3 minutes) for TikTok
  minDuration: number; // 3 seconds
  aspectRatios: Array<{ width: number; height: number; name: string }>;
  resolutions: Array<{ width: number; height: number; quality: string }>;
  formats: string[];
  codecs: string[];

  // Audio specifications
  audioCodecs: string[];
  audioSampleRates: number[];
  audioBitRates: number[];
}

export interface TikTokVideoProcessingOptions {
  targetAspectRatio?: "9:16" | "1:1" | "16:9";
  targetResolution?: "720p" | "1080p" | "2K" | "4K";
  targetFormat?: "mp4" | "mov" | "webm";
  targetCodec?: "h264" | "h265" | "vp9";
  quality?: "low" | "medium" | "high" | "ultra";
  cropMode?: "center" | "smart" | "top" | "bottom";
  addWatermark?: boolean;
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  addCaptions?: boolean;
  captionsLanguage?: string;
  enhanceAudio?: boolean;
  normalizeAudio?: boolean;
  addBackgroundMusic?: boolean;
  backgroundMusicUrl?: string;
  trimStart?: number;
  trimEnd?: number;
  fadeIn?: number;
  fadeOut?: number;
  speedMultiplier?: number;
  addEffects?: string[];
  colorCorrection?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    gamma?: number;
  };
}

export interface TikTokProcessedVideo {
  originalFile: string;
  processedFile: string;
  format: string;
  codec: string;
  resolution: { width: number; height: number };
  aspectRatio: string;
  duration: number;
  fileSize: number;
  bitRate: number;
  frameRate: number;
  audioCodec: string;
  audioSampleRate: number;
  audioBitRate: number;
  thumbnail: string;
  previewGif: string;
  processingTime: number;
  optimizations: string[];
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
    location?: string;
    effects?: string[];
  };
}

export interface TikTokVideoAnalysis {
  fileName: string;
  format: string;
  duration: number;
  fileSize: number;
  resolution: { width: number; height: number };
  aspectRatio: string;
  frameRate: number;
  bitRate: number;
  codec: string;
  audioCodec: string;
  audioChannels: number;
  audioSampleRate: number;
  audioBitRate: number;
  isCompliant: boolean;
  issues: Array<{
    type: "error" | "warning" | "info";
    code: string;
    message: string;
    suggestion?: string;
  }>;
  recommendations: Array<{
    optimization: string;
    impact: "high" | "medium" | "low";
    description: string;
  }>;
}

export interface TikTokVideoTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  aspectRatio: string;
  resolution: { width: number; height: number };
  duration: { min: number; max: number };
  effects: string[];
  transitions: string[];
  textOverlays: Array<{
    text: string;
    position: string;
    style: string;
    duration: number;
  }>;
  backgroundMusic?: string;
  colorScheme: string[];
  usageCount: number;
  performance: {
    averageViews: number;
    averageLikes: number;
    averageShares: number;
    engagementRate: number;
  };
}
