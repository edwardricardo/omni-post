/**
 * @file helpers.ts
 * @description Stateless composition helpers used by concrete provider adapters
 *   (XAdapter, TelegramAdapter, etc.). Adapters implement the `ProviderAdapter`
 *   interface from `@ports/core` and compose these helpers as needed:
 *   - `validateCredentialStructure` — runtime check for required credential fields
 *   - `uploadMediaWithRetry` / `uploadMediaBatch` — exponential-backoff retries
 *   - `mapErrorToPublishError` — HTTP status → PublishError discriminant
 *   - `validateApiResponse` — runtime check for expected response fields
 *   - `validateContentForLimits` — char/media limit enforcement
 *   - `generateProviderPreview` — render preview for UI
 *
 *   Canon: composition over inheritance.
 * @layer infrastructure
 */
import type {
  CanonicalPost,
  RenderedContent,
  RenderedPost,
  ThreadPlan,
  Result,
  PublishError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import type { ProviderId, ProviderLimits } from "@ports/core";
import type { Logger } from "pino";
import type {
  ContentValidationResult,
  ProviderPreview,
  MediaUploadResult,
  MediaUploadOptions,
} from "./providerTypes.js";

// ─── Credential validation ──────────────────────────────────────────────────

/**
 * @function validateCredentialStructure
 * @description Runtime check: every required field is non-empty.
 *   Type-system guarantees the shape; this helper guarantees the values.
 *   Returns the credentials cast to the concrete type on success.
 */
export function validateCredentialStructure<TCredentials extends Record<string, unknown>>(
  credentials: unknown,
  requiredFields: (keyof TCredentials)[],
  logger?: Logger,
  providerId?: string
): Result<TCredentials, "AUTH_INVALID"> {
  if (!credentials || typeof credentials !== "object") {
    return err("AUTH_INVALID");
  }
  const creds = credentials as TCredentials;
  for (const field of requiredFields) {
    if (!creds[field]) {
      logger?.warn(
        `Missing required credential field: ${String(field)}${
          providerId ? ` for ${providerId}` : ""
        }`
      );
      return err("AUTH_INVALID");
    }
  }
  return ok(creds);
}

// ─── Media upload (with exponential backoff) ─────────────────────────────────

/**
 * @function uploadMediaWithRetry
 * @description Retries `uploadFn(mediaUrl)` with exponential backoff
 *   (2^attempt seconds) up to `maxRetries` (default 3).
 */
export async function uploadMediaWithRetry(
  mediaUrl: string,
  uploadFn: (url: string) => Promise<MediaUploadResult>,
  options: MediaUploadOptions = {},
  logger?: Logger
): Promise<Result<MediaUploadResult, "MEDIA_UPLOAD_FAILED">> {
  const maxRetries = options.maxRetries || 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger?.debug(`Uploading media (attempt ${attempt}/${maxRetries}): ${mediaUrl}`);
      const result = await uploadFn(mediaUrl);
      logger?.info(`Media uploaded successfully: ${result.id}`);
      return ok(result);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger?.warn(`Media upload attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger?.error(
    `Media upload failed after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`
  );
  return err("MEDIA_UPLOAD_FAILED");
}

/**
 * @function uploadMediaBatch
 * @description Sequential batch upload — fails the whole batch if any item fails.
 *   Sequential intentional: most provider APIs rate-limit concurrent uploads.
 */
export async function uploadMediaBatch(
  mediaUrls: string[],
  uploadFn: (url: string) => Promise<MediaUploadResult>,
  options: MediaUploadOptions = {},
  logger?: Logger
): Promise<Result<MediaUploadResult[], "MEDIA_UPLOAD_FAILED">> {
  const results: MediaUploadResult[] = [];
  for (const mediaUrl of mediaUrls) {
    const uploadResult = await uploadMediaWithRetry(mediaUrl, uploadFn, options, logger);
    if (!uploadResult.ok) {
      return err("MEDIA_UPLOAD_FAILED");
    }
    results.push(uploadResult.value);
  }
  return ok(results);
}

// ─── Error mapping ───────────────────────────────────────────────────────────

/**
 * @function mapErrorToPublishError
 * @description Maps HTTP status / error code to PublishError discriminant.
 *   429 → RATE_LIMIT, 401/403 → AUTH, 4xx → VALIDATION, 5xx → NETWORK.
 */
export function mapErrorToPublishError(error: unknown): PublishError {
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

// ─── API response validation ─────────────────────────────────────────────────

/**
 * @function validateApiResponse
 * @description Runtime guard for expected fields in a provider API response.
 *   Returns `err("INVALID_RESPONSE")` if any required field is missing.
 */
export function validateApiResponse<T>(
  response: unknown,
  requiredFields: string[],
  logger?: Logger
): Result<T, "INVALID_RESPONSE"> {
  if (!response || typeof response !== "object") {
    return err("INVALID_RESPONSE");
  }
  const obj = response as Record<string, unknown>;
  for (const field of requiredFields) {
    if (!(field in obj)) {
      logger?.warn(`Missing required field in API response: ${field}`);
      return err("INVALID_RESPONSE");
    }
  }
  return ok(obj as T);
}

// ─── Content validation ──────────────────────────────────────────────────────

/**
 * @function validateContentForLimits
 * @description Asserts canonical post fits within provider limits and
 *   capabilities. Returns structured result with errors + suggestions.
 */
export async function validateContentForLimits(
  canonical: CanonicalPost,
  limits: ProviderLimits,
  capabilities: { threading: boolean }
): Promise<ContentValidationResult> {
  const errors: ContentValidationResult["errors"] = [];
  const suggestions: ContentValidationResult["suggestions"] = [];

  if (limits.maxChars && canonical.body) {
    const textLength = canonical.body.length;
    if (textLength > limits.maxChars) {
      errors.push({
        field: "text",
        message: `Content exceeds maximum character limit of ${limits.maxChars} (current: ${textLength})`,
        severity: "error",
      });
      suggestions.push({
        type: "truncate",
        message: `Truncate text to ${limits.maxChars} characters`,
        action: "truncate",
      });
    }
  }

  if (canonical.media && canonical.media.length > 0) {
    const mediaCount = canonical.media.length;
    const maxMedia = limits.maxMediaPerPost;
    if (mediaCount > maxMedia) {
      errors.push({
        field: "media",
        message: `Too many media items (${mediaCount}). Maximum allowed: ${maxMedia}`,
        severity: "error",
      });
    }
    for (const media of canonical.media) {
      if (!limits.allowedMedia.includes(media.type)) {
        errors.push({
          field: "media",
          message: `Media type '${media.type}' is not supported. Allowed types: ${limits.allowedMedia.join(", ")}`,
          severity: "error",
        });
      }
    }
  }

  if (
    limits.maxChars &&
    canonical.body &&
    canonical.body.length > limits.maxChars &&
    capabilities.threading
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

// ─── Preview generation ──────────────────────────────────────────────────────

/**
 * @function generateProviderPreview
 * @description Build a UI preview for a canonical post given the adapter's
 *   render output. Pure transformation.
 */
export async function generateProviderPreview(
  canonical: CanonicalPost,
  providerId: ProviderId,
  limits: ProviderLimits,
  renderResult: Result<RenderedContent, unknown>
): Promise<ProviderPreview> {
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
  const maxChars = limits.maxChars || 0;

  return {
    providerId,
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
      mediaLimit: limits.maxMediaPerPost,
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
