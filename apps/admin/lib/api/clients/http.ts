/**
 * @file http.ts
 * @description Shared HTTP transport for the admin app's API clients. Wraps
 *              `fetch` with JSON defaults, sends credentials so the proxy can
 *              forward the admin session cookie, and unwraps the standard
 *              `{ ok, data }` envelope produced by the backend's
 *              BaseRouteHandler. On non-OK responses, throws the structured
 *              `ApiError` from `parseApiError` (single source of truth for
 *              admin error parsing).
 * @layer infrastructure
 */

import { ApiError } from "../../parseApiError";

export const ADMIN_API_BASE = "/api/backend";

/**
 * @function http
 * @description Performs a JSON request through the admin proxy and returns
 *              the unwrapped envelope. The backend always returns
 *              `{ ok, data: T }`; this helper merges `ok` with the spread of
 *              `data` so callers receive `{ ok, ...fields }` typed as the
 *              caller-declared generic.
 * @param path - Endpoint path beginning with `/`
 * @param init - Standard fetch options
 * @returns Unwrapped response with `ok` and the spread payload
 */
export async function http<T>(path: string, init?: RequestInit): Promise<{ ok: boolean } & T> {
  const res = await fetch(ADMIN_API_BASE + path, {
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw ApiError.fromResponse(res.status, body);
  }
  const json: { ok: boolean; data?: T } = await res.json();
  return { ok: json.ok, ...(json.data as T) } as { ok: boolean } & T;
}
