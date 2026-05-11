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
    const errorData: ErrorResponse = await response.json().catch(() => ({
      ok: false as const,
      error: "Unknown error occurred",
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));

    throw new ApiError(
      response.status,
      errorData.code ?? null,
      errorData.message || errorData.error,
      errorData.details
    );
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
    const errorData: ErrorResponse = await response.json().catch(() => ({
      ok: false as const,
      error: "Upload failed",
      message: `HTTP ${response.status}: ${response.statusText}`,
    }));

    throw new ApiError(
      response.status,
      errorData.code ?? null,
      errorData.message || errorData.error,
      errorData.details
    );
  }

  return response.json();
}
