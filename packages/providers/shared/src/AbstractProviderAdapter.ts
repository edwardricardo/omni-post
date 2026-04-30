/**
 * @file AbstractProviderAdapter.ts
 * @description Base class for all provider adapters. Provides common functionality
 * while enforcing a consistent implementation pattern across all social media platforms.
 * Type definitions live in AbstractProviderAdapterTypes.ts.
 */

import { randomUUID } from "node:crypto";
import type { ProviderId, ProviderLimits, PublishInput, PublishReceipt } from "@ports/core";
import type {
  CanonicalPost,
  RenderedContent,
  RenderedPost,
  ThreadPlan,
  ThreadPublishInput,
  ThreadReceipt,
  Result,
  RenderError,
  PublishError,
  ThreadError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import pino from "pino";
import { resolveChannelCredentials } from "./channelCredentialsRepository.js";

export type { ChannelCredentialsRepository } from "./channelCredentialsRepository.js";
export { setChannelCredentialsRepository } from "./channelCredentialsRepository.js";

// Re-export all types so existing importers continue to work
export type {
  ProviderAuthType,
  ProviderMetadata,
  ProviderConstraints,
  ContentValidationResult,
  ProviderPreview,
  ConnectionConfig,
  ProviderCredentials,
  MediaUploadResult,
  MediaUploadOptions,
  ProviderCapabilities,
  HealthCheckResult,
  AccountInfo,
} from "./AbstractProviderAdapterTypes.js";

import type {
  ProviderMetadata,
  ProviderConstraints,
  ContentValidationResult,
  ProviderPreview,
  ConnectionConfig,
  ProviderCredentials,
  MediaUploadResult,
  MediaUploadOptions,
} from "./AbstractProviderAdapterTypes.js";

const logger = pino({
  name: "abstract-provider-adapter",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Abstract base class for all provider adapters.
 * Implements common functionality and defines contracts for provider-specific behavior.
 */
export abstract class AbstractProviderAdapter<TCredentials extends ProviderCredentials> {
  // ============================================================
  // Abstract Properties (must be implemented by subclasses)
  // ============================================================

  abstract readonly id: ProviderId;
  abstract readonly limits: ProviderLimits;
  abstract readonly capabilities: {
    publish: boolean;
    schedule: boolean;
    analytics: boolean;
    comments: boolean;
    replies: boolean;
    threading: boolean;
  };
  abstract readonly metadata: ProviderMetadata;
  abstract readonly constraints: ProviderConstraints;
  protected abstract readonly requiredCredentialFields: (keyof TCredentials)[];

  // ============================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================

  protected abstract getCredentialsFromEnvironment(): Result<TCredentials, "AUTH">;
  protected abstract createApiClient(credentials: TCredentials): unknown;
  abstract render(canonical: CanonicalPost): Result<RenderedContent, RenderError>;
  abstract publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>>;

  // ============================================================
  // Optional Methods (can be overridden by subclasses)
  // ============================================================

  planThread?(canonical: CanonicalPost): Result<ThreadPlan, ThreadError>;
  publishThread?(input: ThreadPublishInput): Promise<Result<ThreadReceipt, PublishError>>;
  fetchAnalytics?(q: {
    channelId: string;
    since?: Date;
    until?: Date;
  }): Promise<Result<unknown, "AUTH" | "NETWORK">>;
  handleWebhook?(payload: unknown): Promise<Result<unknown, "IGNORE" | "PARSE_ERROR">>;

  // ============================================================
  // Concrete Methods (inherited by all subclasses)
  // ============================================================

  async validateCredentials(
    creds: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const structureValidation = this.validateCredentialStructure(creds);
    if (!structureValidation.ok) {
      return err("AUTH_INVALID");
    }

    const credentials = structureValidation.value;

    try {
      const apiClient = this.createApiClient(credentials);
      await this.testCredentials(apiClient);
      return ok(undefined);
    } catch (error: unknown) {
      this.logError("validateCredentials", error);
      if (
        error instanceof Error &&
        "status" in error &&
        (error as Record<string, unknown>).status === 401
      ) {
        return err("AUTH_EXPIRED");
      }
      return err("AUTH_INVALID");
    }
  }

  protected async testCredentials(apiClient: unknown): Promise<void> {
    if (
      apiClient &&
      typeof apiClient === "object" &&
      "validateCredentials" in apiClient &&
      typeof (apiClient as Record<string, unknown>).validateCredentials === "function"
    ) {
      await (apiClient as { validateCredentials: () => Promise<void> }).validateCredentials();
    }
  }

  protected validateCredentialStructure(creds: unknown): Result<TCredentials, "AUTH_INVALID"> {
    const credentials = creds as TCredentials;
    for (const field of this.requiredCredentialFields) {
      if (!credentials[field]) {
        logger.warn(`Missing required credential field: ${String(field)} for ${this.id}`);
        return err("AUTH_INVALID");
      }
    }
    return ok(credentials);
  }

  protected async getCredentials(channelId: string): Promise<Result<TCredentials, "AUTH">> {
    try {
      const dbResult = await this.getCredentialsFromDatabase(channelId);
      if (dbResult.ok) {
        return dbResult;
      }
      return this.getCredentialsFromEnvironment();
    } catch (error: unknown) {
      logger.error(
        `Failed to get credentials for channel ${channelId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return err("AUTH");
    }
  }

  protected async getCredentialsFromDatabase(
    channelId: string
  ): Promise<Result<TCredentials, "AUTH">> {
    const credentialsResult = await resolveChannelCredentials(channelId);
    if (!credentialsResult.ok) {
      return err("AUTH");
    }

    // The repository returns the raw JSON blob; each provider validates the
    // shape against its own typed credentials below.
    const credentials = credentialsResult.value as TCredentials;
    const validationResult = this.validateCredentialStructure(credentials);

    if (!validationResult.ok) {
      return err("AUTH");
    }

    return ok(validationResult.value);
  }

  protected async uploadMediaWithRetry(
    mediaUrl: string,
    uploadFn: (url: string) => Promise<MediaUploadResult>,
    options: MediaUploadOptions = {}
  ): Promise<Result<MediaUploadResult, "MEDIA_UPLOAD_FAILED">> {
    const maxRetries = options.maxRetries || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Uploading media (attempt ${attempt}/${maxRetries}): ${mediaUrl}`);
        const result = await uploadFn(mediaUrl);
        logger.info(`Media uploaded successfully: ${result.id}`);
        return ok(result);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Media upload attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error(
      `Media upload failed after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`
    );
    return err("MEDIA_UPLOAD_FAILED");
  }

  protected async uploadMediaBatch(
    mediaUrls: string[],
    uploadFn: (url: string) => Promise<MediaUploadResult>,
    options: MediaUploadOptions = {}
  ): Promise<Result<MediaUploadResult[], "MEDIA_UPLOAD_FAILED">> {
    const results: MediaUploadResult[] = [];

    for (const mediaUrl of mediaUrls) {
      const uploadResult = await this.uploadMediaWithRetry(mediaUrl, uploadFn, options);
      if (!uploadResult.ok) {
        return err("MEDIA_UPLOAD_FAILED");
      }
      results.push(uploadResult.value);
    }

    return ok(results);
  }

  protected mapErrorToPublishError(error: unknown): PublishError {
    if (!(error instanceof Error)) {
      return "NETWORK";
    }

    const e = error as Error & { status?: number; code?: string };

    if (e.status === 429 || e.code === "RATE_LIMIT_EXCEEDED") {
      return "RATE_LIMIT";
    }
    if (e.status === 401 || e.status === 403) {
      return "AUTH";
    }
    if (e.status && e.status >= 400 && e.status < 500) {
      return "VALIDATION";
    }
    if (e.status && e.status >= 500) {
      return "NETWORK";
    }

    return "NETWORK";
  }

  protected logError(
    operation: string,
    error: unknown,
    context: Record<string, unknown> = {}
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({
      provider: this.id,
      operation,
      error: errorMessage,
      ...context,
    });
  }

  protected validateApiResponse<T>(
    response: unknown,
    requiredFields: string[]
  ): Result<T, "INVALID_RESPONSE"> {
    if (!response || typeof response !== "object") {
      return err("INVALID_RESPONSE");
    }

    const obj = response as Record<string, unknown>;

    for (const field of requiredFields) {
      if (!(field in obj)) {
        logger.warn(`Missing required field in API response: ${field}`);
        return err("INVALID_RESPONSE");
      }
    }

    return ok(obj as T);
  }

  // ============================================================
  // Enhanced Methods (from UniversalProviderAdapter)
  // ============================================================

  async validateContent(
    canonical: CanonicalPost,
    _config?: ConnectionConfig
  ): Promise<ContentValidationResult> {
    const errors: ContentValidationResult["errors"] = [];
    const suggestions: ContentValidationResult["suggestions"] = [];

    if (this.limits.maxChars && canonical.body) {
      const textLength = canonical.body.length;
      if (textLength > this.limits.maxChars) {
        errors.push({
          field: "text",
          message: `Content exceeds maximum character limit of ${this.limits.maxChars} (current: ${textLength})`,
          severity: "error",
        });
        suggestions.push({
          type: "truncate",
          message: `Truncate text to ${this.limits.maxChars} characters`,
          action: "truncate",
        });
      }
    }

    if (canonical.media && canonical.media.length > 0) {
      const mediaCount = canonical.media.length;
      const maxMedia = this.limits.maxMediaPerPost;

      if (mediaCount > maxMedia) {
        errors.push({
          field: "media",
          message: `Too many media items (${mediaCount}). Maximum allowed: ${maxMedia}`,
          severity: "error",
        });
      }

      for (const media of canonical.media) {
        if (!this.limits.allowedMedia.includes(media.type)) {
          errors.push({
            field: "media",
            message: `Media type '${media.type}' is not supported. Allowed types: ${this.limits.allowedMedia.join(", ")}`,
            severity: "error",
          });
        }
      }
    }

    if (
      this.limits.maxChars &&
      canonical.body &&
      canonical.body.length > this.limits.maxChars &&
      this.capabilities.threading
    ) {
      suggestions.push({
        type: "split",
        message: "Content can be split into a thread",
        action: "thread",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      suggestions,
      adaptations: [],
    };
  }

  async adaptContent(
    canonical: CanonicalPost,
    targetProvider: ProviderId
  ): Promise<Result<CanonicalPost, "ADAPTATION_FAILED">> {
    logger.debug(`No adaptation needed for ${this.id} -> ${targetProvider}`);
    return ok(canonical);
  }

  async generatePreview(
    canonical: CanonicalPost,
    _config?: ConnectionConfig
  ): Promise<ProviderPreview> {
    const renderResult = this.render(canonical);

    let text = "";
    if (renderResult.ok) {
      if (renderResult.value.type === "single") {
        text = (renderResult.value.content as RenderedPost).text || "";
      } else {
        const threadContent = renderResult.value.content as ThreadPlan;
        text = threadContent.tweets[0]?.text || "";
      }
    }

    const textLength = text.length;
    const maxChars = this.limits.maxChars || 0;

    return {
      providerId: this.id,
      content: {
        text,
        truncated: textLength > maxChars,
        ...(canonical.media && canonical.media.length > 0
          ? {
              media: canonical.media.map((m) => ({
                type: m.type,
                url: m.url,
                optimized: false,
              })),
            }
          : {}),
      },
      constraints: {
        charactersUsed: textLength,
        charactersRemaining: Math.max(0, maxChars - textLength),
        mediaCount: canonical.media?.length || 0,
        mediaLimit: this.limits.maxMediaPerPost,
      },
      warnings: textLength > maxChars ? ["Content exceeds character limit"] : [],
      ...(renderResult.ok && renderResult.value.type === "thread"
        ? {
            threading: {
              threadCount: (renderResult.value.content as ThreadPlan).tweets?.length || 0,
              posts:
                (renderResult.value.content as ThreadPlan).tweets?.map((t) => t.text || "") || [],
            },
          }
        : {}),
    };
  }

  async getAccountInfo(_config: ConnectionConfig): Promise<
    Result<
      {
        id: string;
        name: string;
        username?: string;
        profileImage?: string;
        verified?: boolean;
        followers?: number;
      },
      "AUTH" | "NETWORK"
    >
  > {
    logger.warn(`getAccountInfo not implemented for ${this.id}`);
    return err("AUTH");
  }

  async healthCheck(config?: ConnectionConfig): Promise<
    Result<
      {
        healthy: boolean;
        latency?: number;
        quotaRemaining?: number;
        nextReset?: Date;
        warnings?: string[];
      },
      "HEALTH_CHECK_FAILED"
    >
  > {
    try {
      const startTime = Date.now();

      if (config) {
        const validationResult = await this.validateCredentials(config);
        const latency = Date.now() - startTime;

        if (!validationResult.ok) {
          return err("HEALTH_CHECK_FAILED");
        }

        return ok({
          healthy: true,
          latency,
        });
      }

      return ok({
        healthy: true,
        latency: Date.now() - startTime,
      });
    } catch (error: unknown) {
      logger.error(`Health check failed for ${this.id}: ${error}`);
      return err("HEALTH_CHECK_FAILED");
    }
  }
}

/**
 * Utility functions for common provider operations
 */
export class ProviderUtils {
  static generateMediaId(providerId: string): string {
    return `${providerId}_${randomUUID()}`;
  }

  static extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    if (error && typeof error === "object" && "message" in error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "Unknown error";
  }

  static hasPlaceholders(credentials: ProviderCredentials): boolean {
    return Object.values(credentials).some(
      (value) => value === "placeholder" || value === "" || value === undefined
    );
  }

  static sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete("access_token");
      parsed.searchParams.delete("api_key");
      parsed.searchParams.delete("secret");
      return parsed.toString();
    } catch {
      return "[invalid URL]";
    }
  }
}
