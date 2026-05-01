/**
 * @file HttpClientPort.ts
 * @description Application-layer port for outbound HTTP requests. Lets
 *              services like `TriggerIntegrationEventService` issue
 *              webhooks without depending on the global `fetch` (or any
 *              specific HTTP client). Adapter implementations live in
 *              `infrastructure/adapters/` (e.g. `FetchHttpClient`).
 *
 *              Surface intentionally narrow — only `post()` is needed by
 *              current consumers. Add `get`/`put`/etc. when a real use
 *              case appears.
 * @layer domain
 */

import type { Result } from "@shared/types";

export interface HttpResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

export type HttpError = "TIMEOUT" | "NETWORK" | "BAD_RESPONSE";

export interface HttpPostOptions {
  headers?: Record<string, string>;
  /** Default 10 seconds. Adapter MUST honour this via AbortSignal/timeout. */
  timeoutMs?: number;
}

export interface HttpClientPort {
  post(
    url: string,
    body: string,
    options?: HttpPostOptions
  ): Promise<Result<HttpResponse, HttpError>>;
}
