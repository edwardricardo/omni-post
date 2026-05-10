/**
 * @file apiClient.ts
 * @description Thin HTTP wrapper for integration tests. Centralizes baseURL,
 *              auth header, JSON serialization, and assertion helpers so
 *              every smoke test stays focused on the flow under test
 *              instead of fetch boilerplate.
 * @layer infrastructure
 */

import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

export interface ApiResponse<T = unknown> {
  status: number;
  body: T | null;
  headers: Headers;
}

async function parseJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildHeaders(authHeader?: string, extra?: Record<string, string>): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(authHeader && { Authorization: authHeader }),
    ...extra,
  };
}

export async function apiGet<T = unknown>(
  path: string,
  authHeader?: string
): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: buildHeaders(authHeader),
  });
  return {
    status: response.status,
    body: (await parseJson(response)) as T | null,
    headers: response.headers,
  };
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown,
  authHeader?: string
): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: buildHeaders(authHeader),
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await parseJson(response)) as T | null,
    headers: response.headers,
  };
}

export async function apiPatch<T = unknown>(
  path: string,
  body: unknown,
  authHeader?: string
): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: buildHeaders(authHeader),
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await parseJson(response)) as T | null,
    headers: response.headers,
  };
}

export async function apiDelete<T = unknown>(
  path: string,
  authHeader?: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(authHeader),
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: (await parseJson(response)) as T | null,
    headers: response.headers,
  };
}

/**
 * Assert that a response is an error with the expected status and (optionally)
 * a specific error code. Surfaces the actual body in the assertion message so
 * test failures point straight at the cause without manual inspection.
 */
export function expectError(
  response: ApiResponse,
  expectedStatus: number,
  expectedCode?: string
): void {
  if (response.status !== expectedStatus) {
    assert.fail(
      `Expected status ${expectedStatus}, got ${response.status}. Body: ${JSON.stringify(response.body)}`
    );
  }
  if (expectedCode) {
    const code = (response.body as { error?: { code?: string } | string } | null)?.error;
    const codeStr = typeof code === "object" ? code?.code : code;
    if (codeStr !== expectedCode) {
      assert.fail(
        `Expected error code "${expectedCode}", got "${codeStr}". Body: ${JSON.stringify(response.body)}`
      );
    }
  }
}

/**
 * Poll a saga's status endpoint until terminal (COMPLETED / FAILED /
 * COMPENSATED) or maxMs elapses. Used by every smoke that exercises a
 * saga-routed flow (publishing, scheduling). 200ms tick matches the saga
 * test convention.
 */
export async function pollSagaUntilTerminal(
  sagaId: string,
  authHeader: string,
  maxMs = 15_000
): Promise<{ status: string; data: Record<string, unknown> }> {
  const TERMINAL = new Set(["COMPLETED", "FAILED", "COMPENSATED"]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    const result = await apiGet<{ data?: { status?: string } }>(`/sagas/${sagaId}`, authHeader);
    if (result.status === 200) {
      const sagaStatus = result.body?.data?.status;
      if (sagaStatus && TERMINAL.has(sagaStatus)) {
        return {
          status: sagaStatus,
          data: result.body.data as Record<string, unknown>,
        };
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Saga ${sagaId} did not reach terminal state within ${maxMs}ms`);
}

export const API_BASE_URL = BASE_URL;
