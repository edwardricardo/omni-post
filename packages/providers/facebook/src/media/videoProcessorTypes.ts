/**
 * @file videoProcessorTypes.ts
 * @description Type definitions for Facebook video processing.
 * Consumed by videoProcessor.ts and videoProcessorHelpers.ts.
 * @layer infrastructure
 */

export interface VideoProcessingOptions {
  targetFormat: "mp4" | "mov" | "avi" | "webm";
  quality: "low" | "medium" | "high" | "original";
  targetAspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
  maxDuration?: number;
  maxFileSize?: number;
  compressionLevel?: "light" | "medium" | "heavy";
  watermark?: {
    imageUrl: string;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    opacity: number;
    scale: number;
  };
  thumbnail?: {
    timestampSeconds?: number;
    customImageUrl?: string;
  };
  subtitles?: {
    srtFileUrl?: string;
    autoGenerate?: boolean;
    language?: string;
    styling?: {
      fontFamily?: string;
      fontSize?: number;
      color?: string;
      backgroundColor?: string;
      position?: "top" | "bottom" | "center";
    };
  };
  audioDubbing?: {
    audioFileUrl: string;
    mixType: "replace" | "overlay" | "background";
    volume: number;
  };
}

export interface VideoProcessingResult {
  processedVideoUrl: string;
  processedVideoId: string;
  thumbnailUrl?: string;
  duration: number;
  fileSize: number;
  dimensions: { width: number; height: number };
  format: string;
  codec: string;
  bitrate: number;
  frameRate: number;
  aspectRatio: string;
  hasAudio: boolean;
  processingTime: number;
  optimizations: {
    sizeReduction: number;
    qualityScore: number;
    compressionRatio: number;
  };
  metadata: {
    originalFileSize: number;
    originalDuration: number;
    originalDimensions: { width: number; height: number };
    processedAt: string;
    processingSteps: string[];
  };
}

export interface VideoAnalytics {
  videoId: string;
  fileName: string;
  uploadedAt: string;
  processingHistory: Array<{
    processedAt: string;
    options: VideoProcessingOptions;
    result: VideoProcessingResult;
    platformsOptimizedFor: string[];
  }>;
  platformCompatibility: {
    facebook: {
      compatible: boolean;
      recommendations?: string[];
      formats: string[];
      maxFileSize: number;
      maxDuration: number;
    };
    instagram: {
      compatible: boolean;
      recommendations?: string[];
      formats: string[];
      maxFileSize: number;
      maxDuration: number;
    };
    stories: {
      compatible: boolean;
      recommendations?: string[];
      requiredAspectRatio: string;
      maxDuration: number;
    };
    reels: {
      compatible: boolean;
      recommendations?: string[];
      requiredAspectRatio: string;
      maxDuration: number;
    };
  };
  performance: {
    avgProcessingTime: number;
    successRate: number;
    errorRate: number;
    mostUsedSettings: VideoProcessingOptions;
  };
}

export interface BatchVideoProcessingOptions {
  videos: Array<{
    videoUrl: string;
    fileName: string;
    customOptions?: Partial<VideoProcessingOptions>;
  }>;
  globalOptions: VideoProcessingOptions;
  parallelProcessing?: boolean;
  maxConcurrentJobs?: number;
  priority?: "low" | "normal" | "high";
  webhook?: {
    url: string;
    secret?: string;
  };
}

export interface BatchVideoProcessingResult {
  batchId: string;
  totalVideos: number;
  processedVideos: number;
  failedVideos: number;
  status: "processing" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  estimatedTimeRemaining?: number;
  results: Array<{
    videoUrl: string;
    fileName: string;
    success: boolean;
    result?: VideoProcessingResult;
    error?: string;
  }>;
  summary: {
    totalProcessingTime: number;
    totalSizeReduction: number;
    avgQualityScore: number;
    totalOriginalSize: number;
    totalProcessedSize: number;
  };
}

export interface VideoOptimizationPreset {
  name: string;
  description: string;
  targetPlatform: "facebook" | "instagram" | "stories" | "reels" | "universal";
  options: VideoProcessingOptions;
  estimatedProcessingTime: number;
  recommendedFor: string[];
}
