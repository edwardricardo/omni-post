/**
 * Thumbnail Generator - Facade
 *
 * Composes ThumbnailGenerationEngine, ThumbnailAnalysisEngine,
 * and ThumbnailTemplateEngine into the original public API.
 *
 * External consumers continue importing ThumbnailGenerator and types
 * from this file.
 *
 * @module video/thumbnailGenerator
 */

import { ThumbnailGenerationEngine, type SpawnFn } from "./thumbnailGeneration.js";
import { ThumbnailAnalysisEngine } from "./thumbnailAnalysis.js";
import { ThumbnailTemplateEngine } from "./thumbnailTemplates.js";
import type {
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailTemplate,
  AnalysisResult,
} from "./thumbnailTypes.js";

// ---------------------------------------------------------------------------
// Type Exports (unchanged public API — defined in thumbnailTypes.ts, re-exported here)
// ---------------------------------------------------------------------------

export type {
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailTemplate,
  AnalysisResult,
} from "./thumbnailTypes.js";

// ---------------------------------------------------------------------------
// Facade Class
// ---------------------------------------------------------------------------

export class ThumbnailGenerator {
  private generationEngine: ThumbnailGenerationEngine;
  private analysisEngine: ThumbnailAnalysisEngine;
  private templateEngine: ThumbnailTemplateEngine;

  constructor(spawnFn?: SpawnFn) {
    this.generationEngine = new ThumbnailGenerationEngine(spawnFn);
    this.analysisEngine = new ThumbnailAnalysisEngine(this.generationEngine);
    this.templateEngine = new ThumbnailTemplateEngine(this.generationEngine, this.analysisEngine);
  }

  async generateThumbnail(
    videoPath: string,
    outputPath: string,
    options: ThumbnailOptions
  ): Promise<ThumbnailResult> {
    return this.generationEngine.generateThumbnail(videoPath, outputPath, options);
  }

  async generateMultipleThumbnails(
    videoPath: string,
    outputDir: string,
    options: ThumbnailOptions
  ): Promise<ThumbnailResult[]> {
    return this.generationEngine.generateMultipleThumbnails(videoPath, outputDir, options);
  }

  async analyzeVideoForThumbnails(
    videoPath: string,
    analysisOptions?: {
      sampleInterval?: number;
      minQualityScore?: number;
      detectSceneChanges?: boolean;
      analyzeMotion?: boolean;
      analyzeColors?: boolean;
    }
  ): Promise<AnalysisResult> {
    return this.analysisEngine.analyzeVideoForThumbnails(videoPath, analysisOptions);
  }

  getThumbnailTemplates(): ThumbnailTemplate[] {
    return this.templateEngine.getThumbnailTemplates();
  }

  async applyTemplate(
    videoPath: string,
    outputPath: string,
    templateName: string,
    customOptions?: Partial<ThumbnailOptions>
  ): Promise<ThumbnailResult> {
    return this.templateEngine.applyTemplate(videoPath, outputPath, templateName, customOptions);
  }

  async generateABTestThumbnails(
    videoPath: string,
    outputDir: string,
    baseOptions: ThumbnailOptions,
    variations?: {
      timestamps?: number[];
      filters?: ThumbnailOptions["filters"][];
      overlays?: ThumbnailOptions["overlay"][];
    }
  ): Promise<ThumbnailResult[]> {
    return this.templateEngine.generateABTestThumbnails(
      videoPath,
      outputDir,
      baseOptions,
      variations
    );
  }
}
