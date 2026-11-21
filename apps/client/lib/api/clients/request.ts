/**
 * @file request.ts
 * @description Shared HTTP request helper for the client app's API layer.
 *              All per-domain clients delegate to `request<T>` for typed JSON
 *              calls and `uploadRequest` for multipart uploads. Routes through
 *              the Next.js proxy so authentication is handled via httpOnly
 *              cookies — no tokens are read in the browser.
 * @layer infrastructure
 */

import { ApiError } from "@packages/api-errors";
import type { ErrorResponse } from "../types";

export const PROXY_BASE = "/api/backend";

/**
 * A failed response's body when it is a JSON object; any other body, unparsable or not an object,
 * an array included, gives the body this helper builds, whose message names the status.
 */
async function readErrorBody(response: Response, unreadable: string): Promise<ErrorResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as ErrorResponse;
  }
  return {
    ok: false,
    error: unreadable,
    message: `HTTP ${response.status}: ${response.statusText}`,
  };
}

/**
 * The `ApiError` a failed response's body stands for: a problem body gives its code and its
 * `detail`; a legacy route's body gives its `message`, else its `error`, with its code and details.
 */
function apiErrorOf(status: number, body: ErrorResponse): ApiError {
  if ("detail" in body) {
    return new ApiError(status, body.code, body.detail);
  }
  return new ApiError(status, body.code ?? null, body.message || body.error, body.details);
}

/**
 * @function request
 * @description Performs a JSON HTTP request through the Next.js proxy and
 *              returns the typed response. Throws `ApiError` when the response
 *              status is not OK, preserving the backend error code, message,
 *              and details when present.
 * @param baseUrl - Proxy base URL (defaults to `/api/backend`)
 * @param endpoint - Endpoint path beginning with `/`
 * @param options - Standard `fetch` options (method, body, headers)
 * @returns Parsed JSON response typed as `T`
 */
export async function request<T>(
  baseUrl: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw apiErrorOf(response.status, await readErrorBody(response, "Unknown error occurred"));
  }

  return response.json();
}

/**
 * @function uploadRequest
 * @description Performs a multipart `FormData` upload through the proxy. The
 *              browser sets the `Content-Type` boundary automatically, so the
 *              caller MUST NOT set the header manually. Throws `ApiError` on
 *              non-OK responses with the same shape as `request<T>`.
 * @param baseUrl - Proxy base URL
 * @param endpoint - Endpoint path beginning with `/`
 * @param formData - FormData payload to upload
 * @returns Parsed JSON response typed as `T`
 */
export async function uploadRequest<T>(
  baseUrl: string,
  endpoint: string,
  formData: FormData
): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    throw apiErrorOf(response.status, await readErrorBody(response, "Upload failed"));
  }

  return response.json();
}
