/**
 * @file ApiError.ts
 * @description Canonical `ApiError` class shared by the admin and client apps.
 *              Combines admin's structured constructor + helpers with client's
 *              optional `details` payload. All future call-sites should import
 *              from `@packages/api-errors` instead of duplicating per-app.
 * @layer infrastructure
 */

const ERROR_MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: "You don't have permission to perform this action.",
  UNAUTHORIZED: "Your session has expired. Please log in again.",
  INVALID_TOKEN: "Your session is invalid. Please log in again.",
  TOKEN_EXPIRED: "Your session has expired. Please log in again.",
  NOT_FOUND: "The requested resource was not found.",
  VALIDATION_ERROR: "The request contains invalid data.",
  RATE_LIMITED: "Too many requests. Please wait a moment.",
  ACCOUNT_SUSPENDED: "This account has been suspended.",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "The request was invalid. Please check your input.",
  401: "Your session has expired. Please log in again.",
  403: "You don't have permission to perform this action.",
  404: "The requested resource was not found.",
  409: "This action conflicts with existing data.",
  429: "Too many requests. Please wait a moment.",
};

const DEFAULT_SERVER_ERROR = "An unexpected error occurred. Please try again.";
const DEFAULT_ERROR = "Something went wrong. Please try again.";

/**
 * @class ApiError
 * @description Canonical structured API error. Constructor signature
 *   `(status, code, message, details?)` follows the admin app's prior shape;
 *   `details` carries optional server-side payload (e.g. validation field
 *   errors) that some clients may attach.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details?: unknown;

  constructor(status: number, code: string | null, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  get isPermissionDenied(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }

  /**
   * @method fromResponse
   * @description Build an `ApiError` from an HTTP response status + raw body
   *   text. Parses JSON body to extract error code, server message, and any
   *   structured `details` payload.
   */
  static fromResponse(status: number, body: string): ApiError {
    let code: string | null = null;
    let serverMessage: string | null = null;
    let details: unknown;

    try {
      const json = JSON.parse(body) as {
        error?: { code?: string; message?: string; details?: unknown };
        message?: string;
        code?: string;
        details?: unknown;
      };
      code = json?.error?.code ?? json?.code ?? null;
      serverMessage = json?.error?.message ?? json?.message ?? null;
      details = json?.error?.details ?? json?.details;
    } catch {
      // body was not JSON — fall through with defaults.
    }

    const message = resolveMessage(status, code, serverMessage);
    return new ApiError(status, code, message, details);
  }
}

function resolveMessage(status: number, code: string | null, serverMessage: string | null): string {
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code]!;
  }

  // Security-critical statuses always use the standard message — never trust
  // raw server text for 401 / 403 since they may leak implementation detail.
  if (status === 401 || status === 403) {
    return STATUS_MESSAGES[status] ?? DEFAULT_ERROR;
  }

  if (serverMessage && status >= 400 && status < 500) {
    if (
      !serverMessage.includes("{") &&
      !serverMessage.includes("prisma") &&
      serverMessage.length < 200
    ) {
      return serverMessage;
    }
  }

  if (STATUS_MESSAGES[status]) {
    return STATUS_MESSAGES[status]!;
  }

  if (status >= 500) {
    return DEFAULT_SERVER_ERROR;
  }

  return DEFAULT_ERROR;
}

/**
 * @method parseApiError
 * @description Best-effort coercion of any thrown value into an `ApiError`.
 *   Recognised inputs:
 *   - `ApiError` instances (returned as-is)
 *   - `Error` instances whose message starts with `HTTP NNN: <body>`
 *   - `Error` instances whose message embeds a known UPPER_SNAKE_CASE code
 *   - Plain `Error` with a short, JSON-free message (kept verbatim)
 *   - Bare `string` values (treated like a serialised body)
 *   Anything else collapses to a generic `DEFAULT_ERROR`.
 */
export function parseApiError(err: unknown): ApiError {
  if (err instanceof ApiError) {
    return err;
  }

  if (err instanceof Error) {
    const httpMatch = err.message.match(/^HTTP (\d+):\s*([\s\S]*)$/);
    if (httpMatch) {
      const status = Number(httpMatch[1]);
      const body = httpMatch[2] ?? "";
      return ApiError.fromResponse(status, body);
    }

    const codeMatch = err.message.match(/\b([A-Z][A-Z_]{2,}[A-Z])\b/);
    const matchedCode = codeMatch?.[1];
    const matchedMessage = matchedCode ? ERROR_MESSAGES[matchedCode] : undefined;
    if (matchedCode && matchedMessage) {
      return new ApiError(0, matchedCode, matchedMessage);
    }

    if (
      err.message &&
      !err.message.includes("{") &&
      !err.message.startsWith("HTTP") &&
      err.message.length < 200
    ) {
      return new ApiError(0, null, err.message);
    }

    return new ApiError(0, null, DEFAULT_ERROR);
  }

  if (typeof err === "string") {
    const httpMatch = err.match(/^HTTP (\d+):\s*([\s\S]*)$/);
    if (httpMatch) {
      return ApiError.fromResponse(Number(httpMatch[1]), httpMatch[2] ?? "");
    }
    if (!err.includes("{") && err.length < 200) {
      return new ApiError(0, null, err);
    }
    return new ApiError(0, null, DEFAULT_ERROR);
  }

  return new ApiError(0, null, DEFAULT_ERROR);
}

/**
 * @method getErrorMessage
 * @description Shortcut for extracting a user-facing error message from any
 *   thrown value. Equivalent to `parseApiError(err).message`.
 */
export function getErrorMessage(err: unknown): string {
  return parseApiError(err).message;
}

/**
 * @method isPermissionDenied
 * @description Returns `true` when the parsed error represents a 403 response.
 */
export function isPermissionDenied(err: unknown): boolean {
  return parseApiError(err).isPermissionDenied;
}

/**
 * @method isNotFoundError
 * @description Returns `true` when the parsed error represents a 404 response.
 */
export function isNotFoundError(err: unknown): boolean {
  return parseApiError(err).isNotFound;
}
