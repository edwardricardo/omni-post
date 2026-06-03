/**
 * @file AIProviderError.ts
 * @description Typed error thrown by AI provider adapters. Carries the
 *              provider name, an error code, the `retryable` hint and an
 *              optional `retryAfterMs` recovered from the upstream
 *              `Retry-After` header (RFC 9110) — so the orchestrator can
 *              honour the provider's pacing instead of using its own
 *              exponential schedule blindly.
 * @layer infrastructure
 */

import type { AIErrorCategory, AIProviderName } from "@core/domain/ai/AIContracts.js";
import { extractRetryAfterMs, parseRetryAfterMs } from "../../lib/retry/retryAfter.js";

export interface AIProviderErrorDetails {
  readonly retryable: boolean;
  readonly category: AIErrorCategory;
  readonly retryAfterMs?: number;
  readonly statusCode?: number;
  readonly cause?: unknown;
}

export class AIProviderError extends Error {
  readonly provider: AIProviderName;
  readonly code: string;
  readonly retryable: boolean;
  readonly category: AIErrorCategory;
  readonly retryAfterMs: number | undefined;
  readonly statusCode: number | undefined;

  constructor(
    provider: AIProviderName,
    code: string,
    message: string,
    details: AIProviderErrorDetails
  ) {
    super(message, details.cause instanceof Error ? { cause: details.cause } : undefined);
    this.name = "AIProviderError";
    this.provider = provider;
    this.code = code;
    this.retryable = details.retryable;
    this.category = details.category;
    this.retryAfterMs = details.retryAfterMs;
    this.statusCode = details.statusCode;
  }
}

function readStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const obj = error as Record<string, unknown>;
  if (typeof obj.status === "number") return obj.status;
  if (typeof obj.statusCode === "number") return obj.statusCode;
  const response = obj.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") return response.status;
  return undefined;
}

/**
 * @function classifyProviderError
 * @description Maps an unknown thrown value (typically an SDK error) into
 *   `(code, retryable, category)`. Pure heuristic:
 *   - 401/403 → AUTH (user-fixable, no retry)
 *   - 408/429/5xx → TRANSIENT (retry with backoff)
 *   - 4xx other → CLIENT (user-fixable, no retry)
 *   - no status discoverable → UNKNOWN (transient by default — preserves
 *     the conservative behaviour of retrying when we cannot diagnose)
 * @param error - Unknown error/response object.
 * @returns `(code, retryable, category)` and the captured statusCode (if any).
 */
export function classifyProviderError(error: unknown): {
  code: string;
  retryable: boolean;
  category: AIErrorCategory;
  statusCode: number | undefined;
} {
  const statusCode = readStatus(error);

  if (statusCode === undefined) {
    return {
      code: "UNKNOWN_ERROR",
      retryable: true,
      category: "transient",
      statusCode: undefined,
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return { code: "AUTH_ERROR", retryable: false, category: "user-fixable", statusCode };
  }

  if (statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
    return { code: "TRANSIENT_ERROR", retryable: true, category: "transient", statusCode };
  }

  if (statusCode >= 400 && statusCode < 500) {
    return { code: "CLIENT_ERROR", retryable: false, category: "user-fixable", statusCode };
  }

  return { code: "UNKNOWN_ERROR", retryable: true, category: "transient", statusCode };
}

/**
 * @function toAIProviderError
 * @description Factory that produces an `AIProviderError` from an unknown
 *   thrown value. Combines `classifyProviderError` (status → code +
 *   retryable) with `extractRetryAfterMs` (header inspection). Pass-through
 *   when `error` already is an `AIProviderError` so adapters that wrap
 *   internal failures don't lose context.
 * @param provider - The provider name to tag the error with.
 * @param error - Unknown thrown value from the SDK or fetch call.
 * @param fallbackMessage - Used when `error` is not an `Error` instance.
 * @returns Typed `AIProviderError` with all hints attached.
 */
export function toAIProviderError(
  provider: AIProviderName,
  error: unknown,
  fallbackMessage: string
): AIProviderError {
  if (error instanceof AIProviderError) return error;

  const { code, retryable, category, statusCode } = classifyProviderError(error);
  const retryAfterMs = extractRetryAfterMs(error);
  const message = error instanceof Error ? `${fallbackMessage}: ${error.message}` : fallbackMessage;

  return new AIProviderError(provider, code, message, {
    retryable,
    category,
    ...(retryAfterMs !== null && { retryAfterMs }),
    ...(statusCode !== undefined && { statusCode }),
    cause: error,
  });
}

/**
 * @function errorFromFetchResponse
 * @description Builds an `AIProviderError` from a non-ok fetch `Response`.
 *   Reads `Retry-After` from the response headers, classifies by status, and
 *   preserves both for the orchestrator. Use this in providers that talk via
 *   `fetch` (no SDK error object to inspect).
 * @param provider - The provider name to tag the error with.
 * @param response - Non-ok `Response` returned by fetch.
 * @param fallbackMessage - Message prefix when the response gives none.
 * @returns Typed `AIProviderError`.
 */
export function errorFromFetchResponse(
  provider: AIProviderName,
  response: Response,
  fallbackMessage: string
): AIProviderError {
  const { code, retryable, category, statusCode } = classifyProviderError({
    status: response.status,
  });
  const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after") ?? null);
  return new AIProviderError(
    provider,
    code,
    `${fallbackMessage}: ${response.status} ${response.statusText}`,
    {
      retryable,
      category,
      ...(retryAfterMs !== null && { retryAfterMs }),
      ...(statusCode !== undefined && { statusCode }),
    }
  );
}
