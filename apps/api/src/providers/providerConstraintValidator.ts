import type { CanonicalPost } from "@shared/types";
import { validateContentForProvider } from "@shared/types";
import type {
  ProviderAdapter,
  ContentValidationResult,
  ProviderId,
} from "./providerAdapter.interface.js";

export interface ValidationRule {
  name: string;
  description: string;
  severity: "error" | "warning" | "info";
  validate: (content: CanonicalPost, provider: ProviderAdapter) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
  suggestion?: string;
  field?: string;
}

export interface LocalContentAdaptation {
  type: "truncate" | "split" | "compress" | "format" | "remove";
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
}

export interface ValidationSummary {
  providerId: ProviderId;
  valid: boolean;
  score: number; // 0-100, higher is better
  errors: number;
  warnings: number;
  infos: number;
  adaptationsRequired: LocalContentAdaptation[];
  estimatedEffort: "none" | "minimal" | "moderate" | "significant";
}

/**
 * Validates content against provider constraints and suggests adaptations
 */
export class ProviderConstraintValidator {
  private rules: ValidationRule[] = [];

  constructor() {
    this.registerDefaultRules();
  }

  /**
   * Register a custom validation rule
   */
  registerRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Validate content against a specific provider
   */
  async validateContent(
    content: CanonicalPost,
    provider: ProviderAdapter
  ): Promise<ContentValidationResult> {
    const errors: ContentValidationResult["errors"] = [];
    const suggestions: ContentValidationResult["suggestions"] = [];
    const adaptations: ContentValidationResult["adaptations"] = [];

    // Run all validation rules
    for (const rule of this.rules) {
      try {
        const result = rule.validate(content, provider);

        if (!result.valid) {
          errors.push({
            field: result.field || "content",
            message: result.message || rule.description,
            severity: rule.severity,
          });

          if (result.suggestion) {
            suggestions.push({
              type: this.getSuggestionType(rule.name),
              message: result.suggestion,
              action: this.getSuggestionAction(rule.name, result.suggestion),
            });
          }
        }
      } catch (error: unknown) {
        errors.push({
          field: "validation",
          message: `Validation rule '${rule.name}' failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          severity: "error",
        });
      }
    }

    // Generate adaptations if needed
    if (errors.length > 0) {
      const requiredAdaptations = await this.generateAdaptations(content, provider, errors);
      adaptations.push(...requiredAdaptations);
    }

    return {
      valid: errors.filter((e) => e.severity === "error").length === 0,
      errors,
      suggestions,
      adaptations,
    };
  }

  /**
   * Validate content against multiple providers
   */
  async validateMultipleProviders(
    content: CanonicalPost,
    providers: ProviderAdapter[]
  ): Promise<ValidationSummary[]> {
    const summaries: ValidationSummary[] = [];

    for (const provider of providers) {
      const validation = await this.validateContent(content, provider);

      const errors = validation.errors.filter((e) => e.severity === "error").length;
      const warnings = validation.errors.filter((e) => e.severity === "warning").length;
      const infos = validation.errors.filter((e) => e.severity === "info").length;

      // Calculate score (0-100)
      let score = 100;
      score -= errors * 25; // Heavy penalty for errors
      score -= warnings * 10; // Medium penalty for warnings
      score -= infos * 2; // Light penalty for info messages
      score = Math.max(0, score);

      // Estimate adaptation effort
      const adaptationCount = validation.suggestions.length;
      let estimatedEffort: ValidationSummary["estimatedEffort"] = "none";
      if (adaptationCount > 0) {
        if (adaptationCount <= 2) estimatedEffort = "minimal";
        else if (adaptationCount <= 5) estimatedEffort = "moderate";
        else estimatedEffort = "significant";
      }

      summaries.push({
        providerId: provider.id,
        valid: validation.valid,
        score,
        errors,
        warnings,
        infos,
        adaptationsRequired: validation.suggestions.map((s) => ({
          type:
            s.type === "truncate"
              ? ("truncate" as const)
              : s.type === "split"
                ? ("split" as const)
                : s.type === "format"
                  ? ("format" as const)
                  : ("compress" as const),
          field: "content",
          from: null,
          to: null,
          reason: s.message,
        })),
        estimatedEffort,
      });
    }

    return summaries.sort((a, b) => b.score - a.score);
  }

  /**
   * Get the best provider for given content
   */
  async getBestProvider(
    content: CanonicalPost,
    providers: ProviderAdapter[],
    preferences?: {
      prioritizeReach?: boolean;
      allowAdaptations?: boolean;
      requiredScore?: number;
    }
  ): Promise<ProviderAdapter | null> {
    const summaries = await this.validateMultipleProviders(content, providers);
    const minScore = preferences?.requiredScore || 50;

    for (const summary of summaries) {
      if (summary.score >= minScore) {
        if (!preferences?.allowAdaptations && summary.adaptationsRequired.length > 0) {
          continue;
        }

        const provider = providers.find((p) => p.id === summary.providerId);
        if (provider) {
          return provider;
        }
      }
    }

    return null;
  }

  /**
   * Suggest content adaptations to make it compatible with a provider
   */
  async suggestAdaptations(
    content: CanonicalPost,
    provider: ProviderAdapter
  ): Promise<ContentValidationResult["adaptations"]> {
    const validation = await this.validateContent(content, provider);
    return this.generateAdaptations(content, provider, validation.errors);
  }

  // Private methods

  private registerDefaultRules(): void {
    // Use centralized validation for basic checks
    this.registerRule({
      name: "basic_validation",
      description: "Basic provider constraint validation",
      severity: "error",
      validate: (content, provider) => {
        const textLength = content.body?.length || 0;
        const mediaCount = content.media?.length || 0;

        // Use centralized validation
        const validation = validateContentForProvider(provider.id, content.body || "", mediaCount);

        if (!validation.valid) {
          return {
            valid: false,
            message: validation.errors.join("; "),
            suggestion: validation.warnings.join("; ") || "Check content constraints",
            field: textLength > provider.limits.maxChars ? "text" : "media",
          };
        }

        return { valid: true };
      },
    });

    // Media type validation
    this.registerRule({
      name: "media_type",
      description: "Unsupported media type",
      severity: "error",
      validate: (content, provider) => {
        if (!content.media?.length) return { valid: true };

        const allowedTypes = provider.limits.allowedMedia;
        const unsupportedMedia = content.media.filter(
          (media) => !allowedTypes.includes(media.type)
        );

        if (unsupportedMedia.length > 0) {
          const types = unsupportedMedia.map((m) => m.type).join(", ");
          return {
            valid: false,
            message: `Unsupported media types: ${types}`,
            suggestion: `Convert media to supported formats: ${allowedTypes.join(", ")}`,
            field: "media",
          };
        }

        return { valid: true };
      },
    });

    // Media size validation
    this.registerRule({
      name: "media_size",
      description: "Media file too large",
      severity: "warning",
      validate: (content, provider) => {
        if (!content.media?.length) return { valid: true };

        const _maxImageSize = provider.limits.maxImageSize;
        const _maxVideoSize = provider.limits.maxVideoSize;

        for (const _media of content.media) {
          // Note: Media type doesn't have metadata.size, this would need to be implemented
          // For now, skip size validation
          continue;
        }

        return { valid: true };
      },
    });

    // Video duration validation
    this.registerRule({
      name: "video_duration",
      description: "Video too long",
      severity: "warning",
      validate: (content, provider) => {
        if (!content.media?.length) return { valid: true };

        const maxDuration = provider.limits.maxVideoDuration;
        if (!maxDuration) return { valid: true };

        const videos = content.media.filter((m) => m.type === "video");
        for (const video of videos) {
          const duration = video.durationMs ? video.durationMs / 1000 : null;
          if (duration && duration > maxDuration) {
            return {
              valid: false,
              message: `Video is ${duration}s long, limit is ${maxDuration}s`,
              suggestion: `Trim video to ${maxDuration} seconds or less`,
              field: "media",
            };
          }
        }

        return { valid: true };
      },
    });

    // Hashtag validation
    this.registerRule({
      name: "hashtag_limit",
      description: "Too many hashtags",
      severity: "warning",
      validate: (content, provider) => {
        const text = content.body || "";
        const hashtags = text.match(/#\w+/g) || [];
        const limit = provider.limits.maxHashtags;

        if (limit && hashtags.length > limit) {
          return {
            valid: false,
            message: `${hashtags.length} hashtags found, limit is ${limit}`,
            suggestion: `Remove ${hashtags.length - limit} hashtags`,
            field: "text",
          };
        }

        return { valid: true };
      },
    });

    // Threading capability validation
    this.registerRule({
      name: "threading_required",
      description: "Content requires threading but provider does not support it",
      severity: "error",
      validate: (content, provider) => {
        const textLength = content.body?.length || 0;
        const requiresThreading = textLength > provider.limits.maxChars;

        if (requiresThreading && !provider.capabilities.threading) {
          return {
            valid: false,
            message: "Content is too long and provider does not support threading",
            suggestion: "Reduce content length or choose a provider that supports threading",
            field: "text",
          };
        }

        return { valid: true };
      },
    });

    // Scheduling capability validation
    this.registerRule({
      name: "scheduling_required",
      description: "Scheduling requested but not supported",
      severity: "error",
      validate: (content, provider) => {
        const hasSchedule = content.scheduledAt;

        if (hasSchedule && !provider.capabilities.schedule) {
          return {
            valid: false,
            message: "Scheduling requested but provider does not support it",
            suggestion: "Publish immediately or choose a provider that supports scheduling",
            field: "schedule",
          };
        }

        return { valid: true };
      },
    });
  }

  private async generateAdaptations(
    content: CanonicalPost,
    provider: ProviderAdapter,
    errors: ContentValidationResult["errors"]
  ): Promise<ContentValidationResult["adaptations"]> {
    const adaptations: ContentValidationResult["adaptations"] = [];

    for (const error of errors) {
      if (error.severity === "error") {
        switch (error.field) {
          case "text":
            if (error.message.includes("character limit")) {
              adaptations.push({
                providerId: provider.id,
                requiredChanges: ["Truncate text or split into thread"],
                preview: this.truncateText(content.body || "", provider.limits.maxChars),
              });
            }
            break;
          case "media":
            if (error.message.includes("too many")) {
              adaptations.push({
                providerId: provider.id,
                requiredChanges: ["Remove excess media files"],
                preview: `Keep only ${provider.limits.maxMediaPerPost} media files`,
              });
            }
            break;
        }
      }
    }

    return adaptations;
  }

  private getSuggestionType(ruleName: string): ContentValidationResult["suggestions"][0]["type"] {
    const typeMap: Record<string, ContentValidationResult["suggestions"][0]["type"]> = {
      basic_validation: "truncate",
      media_size: "optimize",
      media_type: "format",
      threading_required: "split",
      hashtag_limit: "format",
    };

    return typeMap[ruleName] || "format";
  }

  private getSuggestionAction(ruleName: string, suggestion: string): string {
    return `Apply ${ruleName} fix: ${suggestion}`;
  }

  private formatFileSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)}${units[unitIndex]}`;
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    // Try to truncate at word boundary
    const truncated = text.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(" ");

    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + "...";
    }

    return truncated + "...";
  }
}
