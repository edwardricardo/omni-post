/**
 * Thumbnail Templates - Predefined Templates & A/B Testing
 *
 * Platform-specific thumbnail templates and A/B test variant generation.
 *
 * @module video/thumbnailTemplates
 */

import * as path from "path";
import type { ThumbnailOptions, ThumbnailResult, ThumbnailTemplate } from "./thumbnailTypes.js";
import type { ThumbnailGenerationEngine } from "./thumbnailGeneration.js";
import type { ThumbnailAnalysisEngine } from "./thumbnailAnalysis.js";

/**
 * Template management and A/B test thumbnail generation
 */
export class ThumbnailTemplateEngine {
  constructor(
    private generationEngine: ThumbnailGenerationEngine,
    private analysisEngine: ThumbnailAnalysisEngine
  ) {}

  /**
   * Get predefined thumbnail templates
   */
  getThumbnailTemplates(): ThumbnailTemplate[] {
    return [
      {
        name: "YouTube Standard",
        description: "Standard YouTube thumbnail (1280x720)",
        platform: ["youtube"],
        useCase: "general",
        options: {
          width: 1280,
          height: 720,
          quality: 95,
          format: "jpg",
        },
      },
      {
        name: "YouTube Shorts",
        description: "Vertical thumbnail for YouTube Shorts (720x1280)",
        platform: ["youtube"],
        useCase: "shorts",
        options: {
          width: 720,
          height: 1280,
          quality: 90,
          format: "jpg",
        },
      },
      {
        name: "Social Media Square",
        description: "Square format for Instagram, Facebook posts",
        platform: ["instagram", "facebook", "twitter"],
        useCase: "social_post",
        options: {
          width: 1080,
          height: 1080,
          quality: 85,
          format: "jpg",
        },
      },
      {
        name: "Instagram Story",
        description: "Vertical format for Instagram Stories",
        platform: ["instagram"],
        useCase: "story",
        options: {
          width: 1080,
          height: 1920,
          quality: 85,
          format: "jpg",
        },
      },
      {
        name: "Twitter Card",
        description: "Twitter card image format",
        platform: ["twitter"],
        useCase: "card",
        options: {
          width: 1200,
          height: 675,
          quality: 85,
          format: "jpg",
        },
      },
      {
        name: "Web Optimized",
        description: "Optimized for web display with fast loading",
        platform: ["web"],
        useCase: "web_display",
        options: {
          width: 854,
          height: 480,
          quality: 75,
          format: "webp",
        },
      },
      {
        name: "High Quality Preview",
        description: "High quality preview for video players",
        platform: ["web", "app"],
        useCase: "preview",
        options: {
          width: 1920,
          height: 1080,
          quality: 95,
          format: "jpg",
        },
      },
    ];
  }

  /**
   * Apply template to generate thumbnail
   */
  async applyTemplate(
    videoPath: string,
    outputPath: string,
    templateName: string,
    customOptions?: Partial<ThumbnailOptions>
  ): Promise<ThumbnailResult> {
    const template = this.getThumbnailTemplates().find((t) => t.name === templateName);
    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }

    const options: ThumbnailOptions = {
      ...template.options,
      ...customOptions,
    };

    return this.generationEngine.generateThumbnail(videoPath, outputPath, options);
  }

  /**
   * Generate thumbnails optimized for A/B testing
   */
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
    const results: ThumbnailResult[] = [];

    const timestamps =
      variations?.timestamps || (await this.analysisEngine.getOptimalTimestamps(videoPath, 3));
    const filters: Array<ThumbnailOptions["filters"]> = variations?.filters || [
      {},
      { brightness: 10, contrast: 10 },
      { saturation: 20 },
    ];

    let variantIndex = 0;

    for (const timestamp of timestamps) {
      for (const filter of filters) {
        const filename = `thumbnail_variant_${++variantIndex}.${baseOptions.format}`;
        const outputPath = path.join(outputDir, filename);

        const options: ThumbnailOptions = {
          ...baseOptions,
          timestamp,
          ...(baseOptions.filters && { filters: { ...baseOptions.filters, ...filter } }),
          ...(!baseOptions.filters &&
            filter &&
            Object.keys(filter).length > 0 && { filters: filter }),
        };

        const result = await this.generationEngine.generateThumbnail(
          videoPath,
          outputPath,
          options
        );
        results.push(result);
      }
    }

    return results;
  }
}
