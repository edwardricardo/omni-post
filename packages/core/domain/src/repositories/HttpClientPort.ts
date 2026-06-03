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
  /** Issue an HTTP GET. Returns the response, or a discrete error for timeout/network/bad-response. */
  get(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>>;
  /** Issue an HTTP HEAD — headers only, no body. Same error contract as `get`. */
  head(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>>;
  /** Issue an HTTP POST with a string body. Caller is responsible for serialising JSON beforehand. */
  post(
    url: string,
    body: string,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>>;
  /** Issue an HTTP PUT with a string body. */
  put(
    url: string,
    body: string,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>>;
  /** Issue an HTTP DELETE. */
  delete(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>>;
}
