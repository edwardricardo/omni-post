/**
 * @file FetchHttpClient.ts
 * @description `HttpClientPort` adapter implemented on top of the global
 *              `fetch` API. Uses `AbortSignal.timeout(ms)` for the timeout
 *              guarantee and maps native errors to the port's discrete
 *              error union (`TIMEOUT` / `NETWORK` / `BAD_RESPONSE`).
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type {
  HttpClientPort,
  HttpResponse,
  HttpError,
  HttpPostOptions,
} from "../../domain/repositories/HttpClientPort.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export class FetchHttpClient implements HttpClientPort {
  async post(
    url: string,
    body: string,
    options?: HttpPostOptions
  ): Promise<Result<HttpResponse, HttpError>> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options?.headers ?? {}),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseBody = await response.text().catch(() => undefined);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return ok({
        status: response.status,
        ...(responseBody !== undefined && { body: responseBody }),
        headers,
      });
    } catch (e: unknown) {
      if (e instanceof Error) {
        if (e.name === "TimeoutError" || e.name === "AbortError") {
          return err("TIMEOUT");
        }
        if (
          e.message.toLowerCase().includes("network") ||
          e.message.toLowerCase().includes("fetch failed")
        ) {
          return err("NETWORK");
        }
      }
      return err("BAD_RESPONSE");
    }
  }
}
