/**
 * Shared types for the thumbnail subsystem.
 *
 * Extracted to break the circular dependency between thumbnailGenerator.ts
 * (facade that imports implementation classes) and the implementation files
 * (thumbnailGeneration.ts, thumbnailAnalysis.ts, thumbnailTemplates.ts) that
 * need these interfaces/types.
 *
 * @module video/thumbnailTypes
 */

export interface ThumbnailOptions {
  width: number;
  height: number;
  quality: number;
  format: "jpg" | "png" | "webp";
  timestamp?: number;
  count?: number;
  positions?: number[];
  filters?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    blur?: number;
    sharpen?: boolean;
  };
  overlay?: {
    text?: string;
    fontSize?: number;
    fontColor?: string;
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    backgroundColor?: string;
    opacity?: number;
  };
  border?: {
    width: number;
    color: string;
    style: "solid" | "dashed" | "dotted";
  };
}

export interface ThumbnailResult {
  id: string;
  inputVideoPath: string;
  outputPath: string;
  width: number;
  height: number;
  format: string;
  fileSize: number;
  timestamp: number;
  quality: number;
  createdAt: Date;
  processingTime: number;
  checksum: string;
}

export interface ThumbnailTemplate {
  name: string;
  description: string;
  options: ThumbnailOptions;
  platform: string[];
  useCase: string;
}

export interface AnalysisResult {
  optimalTimestamps: number[];
  sceneChanges: number[];
  qualityScores: Array<{
    timestamp: number;
    score: number;
    reasoning: string[];
  }>;
  colorAnalysis: Array<{
    timestamp: number;
    dominantColors: string[];
    brightness: number;
    contrast: number;
  }>;
  motionAnalysis: Array<{
    timestamp: number;
    motionLevel: number;
    type: "static" | "low" | "medium" | "high";
  }>;
}
