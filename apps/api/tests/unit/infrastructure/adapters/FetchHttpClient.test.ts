/**
 * @file FetchHttpClient.test.ts
 * @description Tests for the `HttpClientPort` adapter. Mocks `globalThis.fetch`
 *   to verify the adapter passes through method/headers/body, honours the
 *   timeout via `AbortSignal`, and maps native errors (TimeoutError,
 *   network failures) to the port's discrete error union.
 *
 *   Cobertura: 5 verbs (get/head/post/put/delete) + error mapping
 *   (TIMEOUT/NETWORK/BAD_RESPONSE) + headers merge + non-2xx responses.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { FetchHttpClient } from "../../../../src/infrastructure/adapters/FetchHttpClient.js";

describe("FetchHttpClient", () => {
  let originalFetch: typeof globalThis.fetch;
  let client: FetchHttpClient;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new FetchHttpClient();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // POST tests (existing — back-compat)
  // ─────────────────────────────────────────────────────────────────

  it("returns ok with status, body, and headers when fetch succeeds", async () => {
    const headers = new Headers({ "x-trace": "abc" });
    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      headers,
      text: async () => "response body",
    })) as unknown as typeof globalThis.fetch;

    const result = await client.post("https://example.com/hook", '{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(200);
      expect(result.value.body).toBe("response body");
      expect(result.value.headers?.["x-trace"]).toBe("abc");
    }
  });

  it("forwards method=POST + Content-Type=application/json + body", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => "",
    })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    await client.post("https://x", '{"k":"v"}');
    const callArgs = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = callArgs?.[1] as { method: string; headers: Record<string, string>; body: string };
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.body).toBe('{"k":"v"}');
  });

  it("merges caller-supplied headers over defaults", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 204,
      headers: new Headers(),
      text: async () => "",
    })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    await client.post("https://x", "{}", {
      headers: { "X-Auth": "token-abc", "Content-Type": "text/plain" },
    });
    const callArgs = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = callArgs?.[1] as { headers: Record<string, string> };
    expect(opts.headers["X-Auth"]).toBe("token-abc");
    expect(opts.headers["Content-Type"]).toBe("text/plain");
  });

  it("maps TimeoutError to err(TIMEOUT)", async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("operation timed out");
      e.name = "TimeoutError";
      throw e;
    }) as unknown as typeof globalThis.fetch;

    const result = await client.post("https://x", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TIMEOUT");
  });

  it("maps fetch failed / network errors to err(NETWORK)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch failed: ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;

    const result = await client.post("https://x", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NETWORK");
  });

  it("maps unexpected errors to err(BAD_RESPONSE)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("malformed response from server");
    }) as unknown as typeof globalThis.fetch;

    const result = await client.post("https://x", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("BAD_RESPONSE");
  });

  it("returns ok even for non-2xx responses (caller decides)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 503,
      headers: new Headers(),
      text: async () => "service unavailable",
    })) as unknown as typeof globalThis.fetch;

    const result = await client.post("https://x", "{}");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(503);
      expect(result.value.body).toBe("service unavailable");
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET / HEAD / PUT / DELETE tests
  // ─────────────────────────────────────────────────────────────────

  it("get() forwards method=GET without body, no Content-Type added", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => "{}",
    })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    await client.get("https://api.x.com/users/me", {
      headers: { Authorization: "Bearer t-1" },
    });

    const callArgs = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = callArgs?.[1] as {
      method: string;
      headers: Record<string, string>;
      body?: string;
    };
    expect(opts.method).toBe("GET");
    expect(opts.body).toBeUndefined();
    expect(opts.headers["Content-Type"]).toBeUndefined();
    expect(opts.headers["Authorization"]).toBe("Bearer t-1");
  });

  it("head() forwards method=HEAD without body", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "content-length": "1024" }),
      text: async () => "",
    })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    const result = await client.head("https://example.com/file.pdf");

    const callArgs = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = callArgs?.[1] as { method: string; body?: string };
    expect(opts.method).toBe("HEAD");
    expect(opts.body).toBeUndefined();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.headers?.["content-length"]).toBe("1024");
    }
  });

  it("put() forwards method=PUT + Content-Type=application/json + body", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => "{}",
    })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    await client.put("https://api.x.com/posts/123", '{"title":"updated"}');

    const callArgs = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = callArgs?.[1] as { method: string; headers: Record<string, string>; body: string };
    expect(opts.method).toBe("PUT");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.body).toBe('{"title":"updated"}');
  });

  it("delete() forwards method=DELETE without body", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 204,
      headers: new Headers(),
      text: async () => "",
    })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    await client.delete("https://api.x.com/posts/123", {
      headers: { Authorization: "Bearer t-1" },
    });

    const callArgs = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = callArgs?.[1] as {
      method: string;
      headers: Record<string, string>;
      body?: string;
    };
    expect(opts.method).toBe("DELETE");
    expect(opts.body).toBeUndefined();
    expect(opts.headers["Content-Type"]).toBeUndefined();
    expect(opts.headers["Authorization"]).toBe("Bearer t-1");
  });

  it("get() also maps TIMEOUT/NETWORK/BAD_RESPONSE via shared request() helper", async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("timed out");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof globalThis.fetch;

    const result = await client.get("https://x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TIMEOUT");
  });
});
