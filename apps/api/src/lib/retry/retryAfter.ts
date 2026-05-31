/**
 * @file retryAfter.ts
 * @description Parser + duck-type extractor for the HTTP `Retry-After` header
 *              (RFC 9110 §10.2.3). Two forms: `delta-seconds` (a non-negative
 *              integer) and an HTTP-date. The extractor walks common SDK
 *              error shapes (OpenAI `APIError`, Anthropic `APIError`, fetch
 *              `Response`, generic objects carrying `headers` or
 *              `retryAfter*` fields) so callers do not need to know the
 *              concrete provider client to recover the hint.
 * @layer infrastructure
 */

/** Hard ceiling for honoured Retry-After. Caps malicious / misconfigured
 *  servers from forcing arbitrarily long pauses. */
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * @function parseRetryAfterMs
 * @description Parses a `Retry-After` header value into milliseconds. Accepts
 *   delta-seconds (string or number) or an HTTP-date string. Returns null on
 *   unrecognised input. Clamps the result to [0, MAX_RETRY_AFTER_MS].
 * @param value - Raw header value.
 * @returns Milliseconds to wait, or `null` if the value cannot be parsed.
 */
export function parseRetryAfterMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return clamp(Math.floor(value * 1000));
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return clamp(seconds * 1000);
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const deltaMs = parsedDate - Date.now();
    if (deltaMs <= 0) return 0;
    return clamp(deltaMs);
  }

  return null;
}

function clamp(ms: number): number {
  if (ms < 0) return 0;
  if (ms > MAX_RETRY_AFTER_MS) return MAX_RETRY_AFTER_MS;
  return ms;
}

/**
 * @function extractRetryAfterMs
 * @description Walks an unknown error/response and tries to recover a
 *   Retry-After hint without depending on a specific SDK type. Inspection
 *   order, first match wins: (a) `retryAfterMs: number`, (b) `retryAfter:
 *   number | string`, (c) `headers["retry-after"]`, (d) `response.headers`
 *   either as a Headers instance or a record, (e) `cause` recursive.
 * @param error - Unknown error/response object.
 * @returns Milliseconds to wait, or `null` if no hint is discoverable.
 */
export function extractRetryAfterMs(error: unknown, depth: number = 0): number | null {
  if (error === null || typeof error !== "object" || depth > 3) return null;

  const obj = error as Record<string, unknown>;

  if (typeof obj.retryAfterMs === "number") {
    const ms = obj.retryAfterMs;
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.min(Math.floor(ms), MAX_RETRY_AFTER_MS);
  }

  if (typeof obj.retryAfter === "number" || typeof obj.retryAfter === "string") {
    const parsed = parseRetryAfterMs(obj.retryAfter as string | number);
    if (parsed !== null) return parsed;
  }

  const headerValue = readHeader(obj.headers);
  if (headerValue !== null) {
    const parsed = parseRetryAfterMs(headerValue);
    if (parsed !== null) return parsed;
  }

  const responseHeaderValue = readHeader(
    (obj.response as Record<string, unknown> | undefined)?.headers
  );
  if (responseHeaderValue !== null) {
    const parsed = parseRetryAfterMs(responseHeaderValue);
    if (parsed !== null) return parsed;
  }

  if (obj.cause !== undefined) {
    return extractRetryAfterMs(obj.cause, depth + 1);
  }

  return null;
}

function readHeader(headers: unknown): string | null {
  if (headers === null || headers === undefined) return null;

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get("retry-after");
  }

  if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const direct = record["retry-after"] ?? record["Retry-After"];
    if (typeof direct === "string" || typeof direct === "number") {
      return String(direct);
    }
  }

  return null;
}
