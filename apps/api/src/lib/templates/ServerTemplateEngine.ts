/**
 * @file ServerTemplateEngine.ts
 * @description Server-side template engine extending BaseTemplateEngine with Prisma
 *              database access, DOMPurify sanitization, and platform content validation.
 * @layer infrastructure
 */

import DOMPurify from "isomorphic-dompurify";
import { prisma, type PrismaClient } from "@infra/prisma";
import {
  BaseTemplateEngine,
  Template,
  TemplateContext,
  TemplateCompilationResult,
  ValidationResult,
} from "@shared/types";

interface PlatformLimits {
  maxLength: number;
  maxLines?: number;
  allowsHashtags: boolean;
  allowsMentions: boolean;
  allowsUrls: boolean;
  allowsEmojis: boolean;
  allowsMedia: boolean;
  recommendedHashtagCount?: number;
  hashtagPosition?: "anywhere" | "end" | "beginning";
  mediaTypes?: string[];
  linkShortening?: boolean;
}

interface PlatformAdapter {
  validate: (content: string) => { errors: string[] };
  adapt: (content: string) => string;
}

interface CompilationResult extends TemplateCompilationResult {
  platform: string;
  adaptations?: {
    truncated?: boolean;
    hashtagsRelocated?: boolean;
    urlsShortened?: boolean;
  };
}

const PLATFORM_CONFIGS: Record<string, PlatformLimits> = {
  TWITTER: {
    maxLength: 280,
    allowsHashtags: true,
    allowsMentions: true,
    allowsUrls: true,
    allowsEmojis: true,
    allowsMedia: true,
    recommendedHashtagCount: 2,
    hashtagPosition: "anywhere",
    mediaTypes: ["image", "video", "gif"],
    linkShortening: true,
  },
  X: {
    maxLength: 280,
    allowsHashtags: true,
    allowsMentions: true,
    allowsUrls: true,
    allowsEmojis: true,
    allowsMedia: true,
    recommendedHashtagCount: 2,
    hashtagPosition: "anywhere",
    mediaTypes: ["image", "video", "gif"],
    linkShortening: true,
  },
  INSTAGRAM: {
    maxLength: 2200,
    allowsHashtags: true,
    allowsMentions: true,
    allowsUrls: true,
    allowsEmojis: true,
    allowsMedia: true,
    recommendedHashtagCount: 30,
    hashtagPosition: "end",
    mediaTypes: ["image", "video"],
  },
  FACEBOOK: {
    maxLength: 63206,
    allowsHashtags: true,
    allowsMentions: true,
    allowsUrls: true,
    allowsEmojis: true,
    allowsMedia: true,
    mediaTypes: ["image", "video", "link"],
  },
  LINKEDIN: {
    maxLength: 3000,
    maxLines: 7,
    allowsHashtags: true,
    allowsMentions: true,
    allowsUrls: true,
    allowsEmojis: true,
    allowsMedia: true,
    mediaTypes: ["image", "video", "document"],
  },
  YOUTUBE: {
    maxLength: 5000,
    allowsHashtags: true,
    allowsMentions: false,
    allowsUrls: true,
    allowsEmojis: true,
    allowsMedia: true,
    mediaTypes: ["video"],
  },
  TIKTOK: {
    maxLength: 2200,
    allowsHashtags: true,
    allowsMentions: true,
    allowsUrls: false,
    allowsEmojis: true,
    allowsMedia: true,
    mediaTypes: ["video"],
  },
};

export class ServerTemplateEngine extends BaseTemplateEngine {
  private platformAdapters: Map<string, PlatformAdapter> = new Map();

  constructor(private readonly prisma: PrismaClient) {
    super();
    this.initializePlatformAdapters();
  }

  /**
   * 🔒 Server-only: Initialize platform adapters
   */
  private initializePlatformAdapters(): void {
    // Platform adapters handle platform-specific validation and content adaptation
    Object.keys(PLATFORM_CONFIGS).forEach((platform) => {
      this.platformAdapters.set(platform, {
        validate: (content: string) => this.validateForPlatform(content, platform),
        adapt: (content: string) => this.adaptForPlatform(content, platform),
      });
    });
  }

  /**
   * 🔒 Server-only: Validate content for specific platform
   */
  private validateForPlatform(content: string, platform: string): { errors: string[] } {
    const errors: string[] = [];
    const limits = PLATFORM_CONFIGS[platform];

    if (!limits) {
      return { errors: [`Unknown platform: ${platform}`] };
    }

    if (content.length > limits.maxLength) {
      errors.push(
        `Content exceeds ${platform} character limit (${content.length}/${limits.maxLength})`
      );
    }

    if (limits.maxLines) {
      const lineCount = content.split("\n").length;
      if (lineCount > limits.maxLines) {
        errors.push(`Content exceeds ${platform} line limit (${lineCount}/${limits.maxLines})`);
      }
    }

    return { errors };
  }

  /**
   * 🔒 Server-only: Adapt content for specific platform
   */
  private adaptForPlatform(content: string, platform: string): string {
    const limits = PLATFORM_CONFIGS[platform];
    if (!limits) return content;

    let adapted = content;

    // Truncate if needed
    if (adapted.length > limits.maxLength) {
      adapted = adapted.substring(0, limits.maxLength - 3) + "...";
    }

    return adapted;
  }

  /**
   * 🔒 Server-only: Sanitize HTML content
   */
  sanitize(content: string): string {
    return DOMPurify.sanitize(content);
  }

  /**
   * 🔒 Server-only: Compile for specific platform with adaptation
   */
  async compileForPlatform(
    template: Template,
    context: TemplateContext,
    platform: string
  ): Promise<CompilationResult> {
    const baseResult = this.render(template.content, context);

    if (!baseResult.success || !baseResult.content) {
      return {
        ...baseResult,
        platform,
      } as CompilationResult;
    }

    const adapter = this.platformAdapters.get(platform.toUpperCase());
    const adaptedContent = adapter ? adapter.adapt(baseResult.content) : baseResult.content;
    const sanitizedContent = this.sanitize(adaptedContent);

    const adaptations = this.checkAdaptations(baseResult.content, sanitizedContent, platform);

    return {
      ...baseResult,
      content: sanitizedContent,
      platform,
      ...(adaptations && Object.keys(adaptations).length > 0 && { adaptations }),
    };
  }

  /**
   * 🔒 Server-only: Check what adaptations were made
   */
  private checkAdaptations(
    originalContent: string,
    adaptedContent: string,
    platform: string
  ): CompilationResult["adaptations"] {
    const adaptations: CompilationResult["adaptations"] = {};

    if (originalContent.length !== adaptedContent.length) {
      adaptations.truncated = true;
    }

    if (platform.toUpperCase() === "INSTAGRAM") {
      const originalHashtagPosition = originalContent.search(/#\w+/);
      const adaptedHashtagPosition = adaptedContent.search(/#\w+/);
      if (originalHashtagPosition !== adaptedHashtagPosition) {
        adaptations.hashtagsRelocated = true;
      }
    }

    const originalUrls = originalContent.match(/https?:\/\/[^\s]+/g) || [];
    const adaptedUrls = adaptedContent.match(/https?:\/\/[^\s]+/g) || [];
    if (originalUrls.length !== adaptedUrls.length) {
      adaptations.urlsShortened = true;
    }

    return adaptations;
  }

  /**
   * 🔒 Server-only: Compile template component
   */
  async compileComponent(componentId: string, context: TemplateContext): Promise<string> {
    const component = await this.prisma.templateComponent.findUnique({
      where: { id: componentId },
    });

    if (!component) {
      throw new Error(`Template component ${componentId} not found`);
    }

    const compiledTemplate = this.compile(component.content as string);
    return compiledTemplate(context);
  }

  /**
   * 🔒 Server-only: Compile template with components
   */
  async compileTemplateWithComponents(
    template: Template,
    context: TemplateContext
  ): Promise<CompilationResult[]> {
    const componentUsages = await this.prisma.templateComponentUsage.findMany({
      where: { templateId: template.id },
      include: { component: true },
    });

    const componentContext = { ...context };

    for (const usage of componentUsages) {
      const compiledComponent = await this.compileComponent(usage.componentId, context);
      componentContext[`component_${usage.component.name}`] = compiledComponent;
    }

    const results: CompilationResult[] = [];
    for (const platform of template.platforms) {
      const result = await this.compileForPlatform(template, componentContext, platform);
      results.push(result);
    }

    return results;
  }

  /**
   * 🔒 Server-only: Validate template with platform checks
   */
  validateTemplate(template: Template): ValidationResult {
    const baseValidation = this.validate(template.content);
    const errors = [...baseValidation.errors];

    template.platforms.forEach((platform: string) => {
      const adapter = this.platformAdapters.get(platform.toUpperCase());
      if (adapter) {
        const validation = adapter.validate(template.content);
        errors.push(...validation.errors.map((error) => `${platform}: ${error}`));
      } else {
        errors.push(`Unknown platform: ${platform}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings: baseValidation.warnings || [],
    };
  }

  /**
   * 🔒 Server-only: Get platform limits
   */
  getPlatformLimits(platform: string): PlatformLimits | null {
    return PLATFORM_CONFIGS[platform.toUpperCase()] || null;
  }

  /**
   * 🔒 Server-only: Get all supported platforms
   */
  getSupportedPlatforms(): string[] {
    return Object.keys(PLATFORM_CONFIGS);
  }

  /**
   * 🔒 Server-only: Compile template for all platforms
   */
  async compileTemplate(
    template: Template,
    context: TemplateContext
  ): Promise<CompilationResult[]> {
    const results: CompilationResult[] = [];
    for (const platform of template.platforms) {
      const result = await this.compileForPlatform(template, context, platform);
      results.push(result);
    }
    return results;
  }

  /**
   * 🔒 Server-only: Compile with A/B test variant selection
   */
  async compileWithABTest(
    template: Template,
    context: TemplateContext,
    _abTestConfig: { enabled: boolean; trafficSplit?: number[] }
  ): Promise<CompilationResult[]> {
    const variant = this.selectVariant(template);
    const templateWithVariant: Template = {
      ...template,
      content: variant.content,
    };
    return this.compileTemplate(templateWithVariant, context);
  }

  // ===== Abstract Method Implementations =====
  // Stubs returning defaults — will use Prisma persistence once Template model is added to schema

  async loadTemplates(_filter?: { category?: string; tags?: string[] }): Promise<Template[]> {
    // Placeholder: Return empty array until Prisma models are created
    return [];
  }

  async loadTemplate(_id: string): Promise<Template | null> {
    // Placeholder: Return null until Prisma models are created
    return null;
  }

  async saveTemplate(template: Template): Promise<Template> {
    // Placeholder: Return the template unchanged until Prisma models are created
    return template;
  }

  async deleteTemplate(_id: string): Promise<boolean> {
    // Placeholder: Return true until Prisma models are created
    return true;
  }
}

// Export singleton instance
export const serverTemplateEngine = new ServerTemplateEngine(prisma);
