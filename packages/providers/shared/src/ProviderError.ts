/**
 * @file ProviderError.ts
 * @description Structured error class for provider adapters.
 * Mirrors the factory-method API of apps/api AppError so that
 * upstream error handlers can inspect `code` and `statusCode`
 * without importing the API layer.
 * @layer infrastructure
 */

/**
 * Error codes used across all provider adapters.
 */
export enum ProviderErrorCode {
  /** The external platform API returned an error or was unreachable. */
  EXTERNAL_SERVICE = "EXTERNAL_SERVICE_ERROR",
  /** Input validation failed before calling the platform API. */
  BAD_REQUEST = "BAD_REQUEST",
  /** A requested resource (video, playlist, channel, etc.) was not found. */
  NOT_FOUND = "RESOURCE_NOT_FOUND",
  /** The OAuth token is invalid, expired, or revoked. */
  UNAUTHORIZED = "AUTH_INVALID_CREDENTIALS",
  /** The platform API throttled the request (transient). */
  RATE_LIMITED = "RATE_LIMIT_EXCEEDED",
  /** A conflict occurred (duplicate, already exists, etc.). */
  CONFLICT = "RESOURCE_CONFLICT",
  /** Internal invariant violation -- should not reach the client. */
  INTERNAL = "INTERNAL_SERVER_ERROR",
}

/**
 * Typed error thrown by every provider adapter instead of bare `Error`.
 *
 * Each instance carries:
 *  - `code`       – machine-readable enum
 *  - `statusCode` – HTTP-equivalent status (502 for external, 400 for bad request, etc.)
 *  - `provider`   – which platform threw (e.g. "youtube", "tiktok")
 *  - `isOperational` – true for expected failures (API down), false for bugs
 */
export class ProviderError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly statusCode: number;
  public readonly provider: string;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(
    code: ProviderErrorCode,
    statusCode: number,
    provider: string,
    message: string,
    isOperational = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "ProviderError";
    this.code = code;
    this.statusCode = statusCode;
    this.provider = provider;
    this.isOperational = isOperational;
    if (details !== undefined) {
      this.details = details;
    }
    this.timestamp = new Date();

    Error.captureStackTrace(this);
  }

  // ------------------------------------------------------------------
  // Factory helpers
  // ------------------------------------------------------------------

  /** External platform API error (maps to HTTP 502). */
  static externalService(
    provider: string,
    message: string,
    details?: Record<string, unknown>
  ): ProviderError {
    return new ProviderError(
      ProviderErrorCode.EXTERNAL_SERVICE,
      502,
      provider,
      message,
      true,
      details
    );
  }

  /** Validation / bad-request error (maps to HTTP 400). */
  static badRequest(
    provider: string,
    message: string,
    details?: Record<string, unknown>
  ): ProviderError {
    return new ProviderError(ProviderErrorCode.BAD_REQUEST, 400, provider, message, true, details);
  }

  /** Resource not found (maps to HTTP 404). */
  static notFound(
    provider: string,
    resource: string,
    details?: Record<string, unknown>
  ): ProviderError {
    return new ProviderError(
      ProviderErrorCode.NOT_FOUND,
      404,
      provider,
      `${resource} not found`,
      true,
      details
    );
  }

  /** Authentication / token error (maps to HTTP 401). */
  static unauthorized(
    provider: string,
    message: string,
    details?: Record<string, unknown>
  ): ProviderError {
    return new ProviderError(ProviderErrorCode.UNAUTHORIZED, 401, provider, message, true, details);
  }

  /** Rate-limit / throttle error (maps to HTTP 429). Transient — never AUTH. */
  static rateLimited(
    provider: string,
    message: string,
    details?: Record<string, unknown>
  ): ProviderError {
    return new ProviderError(ProviderErrorCode.RATE_LIMITED, 429, provider, message, true, details);
  }

  /** Conflict (maps to HTTP 409). */
  static conflict(
    provider: string,
    message: string,
    details?: Record<string, unknown>
  ): ProviderError {
    return new ProviderError(ProviderErrorCode.CONFLICT, 409, provider, message, true, details);
  }

  /** Internal / programming error (maps to HTTP 500). */
  static internal(
    provider: string,
    message: string,
    details?: Record<string, unknown>
  ): ProviderError {
    return new ProviderError(ProviderErrorCode.INTERNAL, 500, provider, message, false, details);
  }
}
