/**
 * @file FetchHttpClient.ts
 * @description `HttpClientPort` adapter implemented on top of the global
 *              `fetch` API. Uses `AbortSignal.timeout(ms)` for the timeout
 *              guarantee and maps native errors to the port's discrete
 *              error union (`TIMEOUT` / `NETWORK` / `BAD_RESPONSE`).
 *
 *              Implements 5 verbs (get/head/post/put/delete) via private
 *              `request()` helper — DRY core that centralises timeout +
 *              error mapping. POST/PUT default Content-Type to JSON;
 *              GET/HEAD/DELETE send no body.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type {
  HttpClientPort,
  HttpResponse,
  HttpError,
  HttpRequestOptions,
} from "../../domain/repositories/HttpClientPort.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export class FetchHttpClient implements HttpClientPort {
  private async request(
    method: string,
    url: string,
    body: string | undefined,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const hasJsonBody = body !== undefined && (method === "POST" || method === "PUT");
    const headers: Record<string, string> = {
      ...(hasJsonBody && { "Content-Type": "application/json" }),
      ...(options?.headers ?? {}),
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined && { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseBody = await response.text().catch(() => undefined);
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return ok({
        status: response.status,
        ...(responseBody !== undefined && { body: responseBody }),
        headers: responseHeaders,
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

  async get(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>> {
    return this.request("GET", url, undefined, options);
  }

  async head(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>> {
    return this.request("HEAD", url, undefined, options);
  }

  async post(
    url: string,
    body: string,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>> {
    return this.request("POST", url, body, options);
  }

  async put(
    url: string,
    body: string,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>> {
    return this.request("PUT", url, body, options);
  }

  async delete(
    url: string,
    options?: HttpRequestOptions
  ): Promise<Result<HttpResponse, HttpError>> {
    return this.request("DELETE", url, undefined, options);
  }
}
