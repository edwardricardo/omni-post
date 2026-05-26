/**
 * @file HttpClientPort.ts
 * @description Application-layer port for outbound HTTP requests. Lets
 *              services issue webhooks/API calls without depending on the
 *              global `fetch` (or any specific HTTP client). Adapter
 *              implementations live in `infrastructure/adapters/` (e.g.
 *              `FetchHttpClient`).
 *
 *              5 verbs: get/head/post/put/delete. All return
 *              `Result<HttpResponse, HttpError>` with the same discrete
 *              error union (TIMEOUT/NETWORK/BAD_RESPONSE).
 * @layer domain
 */

import type { Result } from "@shared/types";

export interface HttpResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

export type HttpError = "TIMEOUT" | "NETWORK" | "BAD_RESPONSE";

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  /** Default 10 seconds. Adapter MUST honour this via AbortSignal/timeout. */
  timeoutMs?: number;
}

/** @deprecated Alias kept for back-compat. Use HttpRequestOptions. */
export type HttpPostOptions = HttpRequestOptions;

export interface HttpClientPort {
  get(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>>;
  head(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>>;
  post(
    url: string,
    body: string,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>>;
  put(
    url: string,
    body: string,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>>;
  delete(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>>;
}
