/**
 * @file BaseRouteHandler.ts
 * @description Abstract base class for Fastify route handlers providing standardized error
 *              handling, Zod validation, contextual logging, response shaping, and Result handling.
 * @layer infrastructure
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { ZodSchema, ZodError } from "zod";
import type { Result } from "@shared/types";
import pino from "pino";
import {
  verifyWebhookSignature as verifyWebhookSignatureCore,
  constantTimeCompare as constantTimeCompareCore,
} from "@packages/api-common";

const logger = pino({
  name: "base-route-handler",
  level: process.env.LOG_LEVEL || "info",
});

export interface RouteContext {
  request: FastifyRequest;
  reply: FastifyReply;
  userId?: string;
  tenantId?: string;
}

export interface ValidationOptions {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export interface ErrorResponse {
  ok: false;
  error: string;
  details?: unknown;
}

export interface SuccessResponse<T = unknown> {
  ok: true;
  data: T;
}

/**
 * OAuth error context for structured error handling
 */
export interface OAuthErrorContext {
  provider: string;
  operation: string;
  accountId?: string;
  retryable?: boolean;
}

/**
 * OAuth error response structure
 */
export interface OAuthErrorResponse {
  statusCode: number;
  error: string;
  details?: string;
  retryable: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Webhook signature verification options — sourced from the framework-neutral
 * helper in `@packages/api-common` so consumers may import the type from
 * either side without duplication.
 */
export type { WebhookVerificationOptions } from "@packages/api-common";
import type { WebhookVerificationOptions } from "@packages/api-common";

/**
 * Abstract base class for route handlers
 */
export abstract class BaseRouteHandler {
  protected abstract routeName: string;

  /**
   * Validate request body using Zod schema
   */
  protected async validateBody<T>(
    ctx: RouteContext,
    schema: ZodSchema<T>
  ): Promise<Result<T, "VALIDATION_ERROR">> {
    try {
      const validated = schema.parse(ctx.request.body);
      return { ok: true, value: validated };
    } catch (error) {
      if (error instanceof ZodError) {
        this.logError(ctx, "Body validation failed", { errors: error.issues });
        return { ok: false, error: "VALIDATION_ERROR" };
      }
      this.logError(ctx, "Unexpected body validation error", { error });
      return { ok: false, error: "VALIDATION_ERROR" };
    }
  }

  /**
   * Validate request query parameters using Zod schema
   */
  protected async validateQuery<T>(
    ctx: RouteContext,
    schema: ZodSchema<T>
  ): Promise<Result<T, "VALIDATION_ERROR">> {
    try {
      const validated = schema.parse(ctx.request.query);
      return { ok: true, value: validated };
    } catch (error) {
      if (error instanceof ZodError) {
        this.logError(ctx, "Query validation failed", { errors: error.issues });
        return { ok: false, error: "VALIDATION_ERROR" };
      }
      this.logError(ctx, "Unexpected query validation error", { error });
      return { ok: false, error: "VALIDATION_ERROR" };
    }
  }

  /**
   * Validate request params using Zod schema
   */
  protected async validateParams<T>(
    ctx: RouteContext,
    schema: ZodSchema<T>
  ): Promise<Result<T, "VALIDATION_ERROR">> {
    try {
      const validated = schema.parse(ctx.request.params);
      return { ok: true, value: validated };
    } catch (error) {
      if (error instanceof ZodError) {
        this.logError(ctx, "Params validation failed", { errors: error.issues });
        return { ok: false, error: "VALIDATION_ERROR" };
      }
      this.logError(ctx, "Unexpected params validation error", { error });
      return { ok: false, error: "VALIDATION_ERROR" };
    }
  }

  /**
   * Validate request data using Zod schemas (composite validation)
   */
  protected async validateRequest<T = unknown>(
    ctx: RouteContext,
    schemas: ValidationOptions
  ): Promise<Result<T, "VALIDATION_ERROR">> {
    try {
      const validated: Record<string, unknown> = {};

      if (schemas.body) {
        validated.body = schemas.body.parse(ctx.request.body);
      }

      if (schemas.params) {
        validated.params = schemas.params.parse(ctx.request.params);
      }

      if (schemas.query) {
        validated.query = schemas.query.parse(ctx.request.query);
      }

      return { ok: true, value: validated as T };
    } catch (error) {
      if (error instanceof ZodError) {
        this.logError(ctx, "Validation failed", { errors: error.issues });
        return {
          ok: false,
          error: "VALIDATION_ERROR",
        };
      }

      this.logError(ctx, "Unexpected validation error", { error });
      return {
        ok: false,
        error: "VALIDATION_ERROR",
      };
    }
  }

  /**
   * Handle Result type responses with error mapping
   */
  protected async handleResult<T>(
    ctx: RouteContext,
    result: Result<T, string>,
    errorMap: Record<string, { code: number; message: string }>
  ): Promise<void> {
    if (result.ok) {
      return ctx.reply.send({
        ok: true,
        data: result.value,
      });
    }

    const errorConfig = errorMap[result.error] || {
      code: 500,
      message: "Internal server error",
    };

    this.logError(ctx, `Request failed: ${result.error}`, { error: result.error });

    return ctx.reply.code(errorConfig.code).send({
      ok: false,
      error: errorConfig.message,
    });
  }

  /**
   * Map service Result to HTTP response
   *
   * Provides automatic HTTP status code mapping for common error types.
   * Use this for simpler Result handling without explicit error maps.
   *
   * Default mappings:
   * - Success → 200 (or custom successStatus)
   * - VALIDATION_ERROR → 400
   * - NOT_FOUND → 404
   * - UNAUTHORIZED → 401
   * - FORBIDDEN → 403
   * - CONFLICT → 409
   * - RATE_LIMITED → 429
   * - SERVICE_UNAVAILABLE → 503
   * - Other errors → 500
   */
  protected mapServiceResult<T>(
    result: Result<T, string>,
    successStatus: number = 200
  ): { status: number; body: SuccessResponse<T> | ErrorResponse } {
    if (result.ok) {
      return {
        status: successStatus,
        body: {
          ok: true,
          data: result.value,
        },
      };
    }

    const errorStatusMap: Record<string, number> = {
      VALIDATION_ERROR: 400,
      NOT_FOUND: 404,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      SERVICE_UNAVAILABLE: 503,
      BAD_REQUEST: 400,
      INTERNAL_ERROR: 500,
    };

    const status = errorStatusMap[result.error] || 500;

    return {
      status,
      body: {
        ok: false,
        error: result.error,
      },
    };
  }

  /**
   * Send success response
   */
  protected sendSuccess<T>(ctx: RouteContext, data: T, statusCode = 200): void {
    ctx.reply.code(statusCode).send({
      ok: true,
      data,
    });
  }

  /**
   * Send error response
   */
  protected sendError(
    ctx: RouteContext,
    statusCode: number,
    message: string,
    details?: unknown
  ): void {
    this.logError(ctx, message, details as Record<string, unknown> | undefined);

    ctx.reply.code(statusCode).send({
      ok: false,
      error: message,
      ...(details && typeof details === "object" && details !== null ? { details } : {}),
    });
  }

  /**
   * Handle unexpected errors
   */
  protected handleUnexpectedError(ctx: RouteContext, error: unknown): void {
    this.logError(ctx, "Unexpected error", { error });

    ctx.reply.code(500).send({
      ok: false,
      error: "Internal server error",
    });
  }

  /**
   * Handle OAuth errors with provider-specific error mapping
   *
   * Maps OAuth error codes to appropriate HTTP status codes and provides
   * structured error responses with retry hints.
   *
   * Common error scenarios:
   * - invalid_grant → 401 (expired/revoked refresh token)
   * - invalid_token → 401 (invalid access token)
   * - insufficient_scope → 403 (missing required permissions)
   * - invalid_request → 400 (malformed request)
   * - server_error → 503 (provider temporary issue, retryable)
   * - rate_limit_exceeded → 429 (too many requests, retryable)
   */
  protected handleOAuthError(
    ctx: RouteContext,
    error: unknown,
    context: OAuthErrorContext
  ): OAuthErrorResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = this.extractOAuthErrorCode(errorMessage);

    const errorMapping: Record<
      string,
      { statusCode: number; message: string; retryable: boolean }
    > = {
      invalid_grant: {
        statusCode: 401,
        message: "Token expired or revoked. Re-authentication required.",
        retryable: false,
      },
      invalid_token: {
        statusCode: 401,
        message: "Invalid access token. Re-authentication required.",
        retryable: false,
      },
      invalid_code_verifier: {
        statusCode: 400,
        message: "PKCE code verifier validation failed.",
        retryable: false,
      },
      insufficient_scope: {
        statusCode: 403,
        message: "Missing required OAuth scopes.",
        retryable: false,
      },
      invalid_request: {
        statusCode: 400,
        message: "Malformed OAuth request.",
        retryable: false,
      },
      server_error: {
        statusCode: 503,
        message: "Provider temporarily unavailable.",
        retryable: true,
      },
      temporarily_unavailable: {
        statusCode: 503,
        message: "Provider temporarily unavailable.",
        retryable: true,
      },
      rate_limit_exceeded: {
        statusCode: 429,
        message: "Rate limit exceeded. Retry after cooldown.",
        retryable: true,
      },
      network_timeout: {
        statusCode: 504,
        message: "Request to provider timed out.",
        retryable: true,
      },
      invalid_state: {
        statusCode: 400,
        message: "OAuth state validation failed. Possible CSRF attack.",
        retryable: false,
      },
    };

    const mappedError = errorMapping[errorCode] || {
      statusCode: 500,
      message: "OAuth operation failed.",
      retryable: false,
    };

    const metadata: Record<string, unknown> = {
      provider: context.provider,
      operation: context.operation,
      errorCode,
    };

    if (context.accountId) {
      metadata.accountId = context.accountId;
    }

    const response: OAuthErrorResponse = {
      statusCode: mappedError.statusCode,
      error: mappedError.message,
      details: errorMessage,
      retryable: context.retryable ?? mappedError.retryable,
      metadata,
    };

    this.logError(ctx, `OAuth error: ${context.operation}`, {
      provider: context.provider,
      errorCode,
      retryable: response.retryable,
      accountId: context.accountId,
    });

    return response;
  }

  /**
   * Extract OAuth error code from error message or object
   */
  private extractOAuthErrorCode(errorMessage: string): string {
    // Test known compound error codes first before generic patterns to prevent
    // partial captures (e.g., "server_error" must not be captured as "server")
    const errorPatterns = [
      /(invalid_grant|invalid_token|invalid_request|server_error|temporarily_unavailable|insufficient_scope|rate_limit_exceeded|network_timeout|invalid_code_verifier|invalid_state)/i,
      /error[_\s]code[:\s]+([a-z_]+)/i,
      /error[:\s]+([a-z_]+)/i,
    ];

    for (const pattern of errorPatterns) {
      const match = errorMessage.match(pattern);
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
    }

    return "unknown_error";
  }

  /**
   * Verify webhook signature using HMAC
   *
   * Performs constant-time comparison to prevent timing attacks.
   * Supports multiple algorithms (SHA-256, SHA-1) and encodings (hex, base64).
   *
   * Provider-specific implementations:
   * - X (Twitter): HMAC-SHA256, base64 or hex, header: x-signature
   * - Instagram/Facebook: HMAC-SHA256, hex, header: x-hub-signature-256, prefix: sha256=
   * - TikTok: HMAC-SHA256, hex (to be implemented)
   * - YouTube: HMAC-SHA256, hex (to be implemented)
   */
  protected verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
    options?: WebhookVerificationOptions
  ): boolean {
    return verifyWebhookSignatureCore(payload, signature, secret, {
      ...options,
      onError: (error) => {
        // Crypto / encoding errors are reported through the framework-specific
        // logger here. The core helper has no Fastify dependency, so the leak
        // (the previous `{} as FastifyRequest` cast) is gone.
        logger.error({ error, route: "webhookSignature" }, "Webhook signature verification failed");
      },
    });
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   *
   * Thin wrapper around the framework-neutral helper in `./webhookSignature`.
   */
  protected constantTimeCompare(a: string, b: string): boolean {
    return constantTimeCompareCore(a, b);
  }

  /**
   * Log with context
   */
  protected logInfo(ctx: RouteContext, message: string, meta?: Record<string, unknown>): void {
    logger.info({
      route: this.routeName,
      method: ctx.request.method,
      url: ctx.request.url,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      ...meta,
      message,
    });
  }

  /**
   * Log errors with context
   */
  protected logError(ctx: RouteContext, message: string, meta?: Record<string, unknown>): void {
    logger.error({
      route: this.routeName,
      method: ctx.request.method,
      url: ctx.request.url,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      ...meta,
      message,
    });
  }

  /**
   * Extract user context from authenticated request
   */
  protected getUserContext(request: FastifyRequest): { userId?: string; tenantId?: string } {
    const user = (request as unknown as Record<string, unknown>).user as
      | { id?: string; tenantId?: string }
      | undefined;
    return {
      ...(user?.id !== undefined && { userId: user.id }),
      ...(user?.tenantId !== undefined && { tenantId: user.tenantId }),
    };
  }

  /**
   * Parse pagination params
   */
  protected parsePagination(query: Record<string, unknown>): {
    page: number;
    limit: number;
    offset: number;
  } {
    const page = Math.max(1, parseInt(String(query.page || "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || "20"), 10)));
    const offset = (page - 1) * limit;

    return { page, limit, offset };
  }

  /**
   * Format paginated response
   */
  protected formatPaginatedResponse<T>(
    data: T[],
    total: number,
    page: number,
    limit: number
  ): {
    ok: true;
    data: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
  } {
    const totalPages = Math.ceil(total / limit);

    return {
      ok: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }
}
