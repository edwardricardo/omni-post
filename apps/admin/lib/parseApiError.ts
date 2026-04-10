/**
 * @file parseApiError.ts
 * @description Structured API error class and parsing utilities.
 *   Extracts human-readable messages from API responses — never exposes raw JSON to users.
 * @layer presentation (utility)
 */

// ---------------------------------------------------------------------------
// Known error code → user-friendly message mapping
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ApiError class
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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
   * Build an ApiError from an HTTP response status + raw body text.
   * Parses JSON body to extract error code and server message.
   */
  static fromResponse(status: number, body: string): ApiError {
    let code: string | null = null;
    let serverMessage: string | null = null;

    try {
      const json = JSON.parse(body) as {
        error?: { code?: string; message?: string };
        message?: string;
      };
      code = json?.error?.code ?? null;
      serverMessage = json?.error?.message ?? json?.message ?? null;
    } catch {
      // body is not JSON — ignore
    }

    const message = resolveMessage(status, code, serverMessage);
    return new ApiError(status, code, message);
  }
}

// ---------------------------------------------------------------------------
// Message resolution
// ---------------------------------------------------------------------------

function resolveMessage(status: number, code: string | null, serverMessage: string | null): string {
  // 1. Known error code takes priority
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }

  // 2. Security-critical statuses always use the standard message (never raw server text)
  if (status === 401 || status === 403) {
    return STATUS_MESSAGES[status] ?? DEFAULT_ERROR;
  }

  // 3. For other 4xx, use the server message if it's human-readable
  if (serverMessage && status >= 400 && status < 500) {
    if (
      !serverMessage.includes("{") &&
      !serverMessage.includes("prisma") &&
      serverMessage.length < 200
    ) {
      return serverMessage;
    }
  }

  // 4. Known status code
  if (STATUS_MESSAGES[status]) {
    return STATUS_MESSAGES[status];
  }

  // 4. Server errors
  if (status >= 500) {
    return DEFAULT_SERVER_ERROR;
  }

  return DEFAULT_ERROR;
}

// ---------------------------------------------------------------------------
// Public utilities
// ---------------------------------------------------------------------------

/**
 * Parse any error into an ApiError with a human-readable message.
 * Handles: ApiError, Error with "HTTP NNN: ..." message, plain Error, string.
 */
export function parseApiError(err: unknown): ApiError {
  // Already structured
  if (err instanceof ApiError) {
    return err;
  }

  // Error with "HTTP NNN: {body}" format (from apiClient or raw fetch)
  if (err instanceof Error) {
    const httpMatch = err.message.match(/^HTTP (\d+):\s*([\s\S]*)$/);
    if (httpMatch) {
      const status = Number(httpMatch[1]);
      const body = httpMatch[2] ?? "";
      return ApiError.fromResponse(status, body);
    }

    // Try to extract a known error code from the message
    const codeMatch = err.message.match(/\b([A-Z][A-Z_]{2,}[A-Z])\b/);
    const matchedCode = codeMatch?.[1];
    const matchedMessage = matchedCode ? ERROR_MESSAGES[matchedCode] : undefined;
    if (matchedCode && matchedMessage) {
      return new ApiError(0, matchedCode, matchedMessage);
    }

    // Plain error with a reasonable message (not JSON, not "HTTP NNN")
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

  // String error
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
 * Shortcut: extract a user-friendly error message from any error type.
 */
export function getErrorMessage(err: unknown): string {
  return parseApiError(err).message;
}

/**
 * Check if an error is a 403 permission denied error.
 */
export function isPermissionDenied(err: unknown): boolean {
  return parseApiError(err).isPermissionDenied;
}

/**
 * Check if an error is a 404 not found error.
 */
export function isNotFoundError(err: unknown): boolean {
  return parseApiError(err).isNotFound;
}
