/**
 * @file HttpClientPort.contract.test.ts
 * @description Type-level + runtime contract test for the HttpClientPort. The
 *              port is interface-only — the adapter's functional tests live in
 *              `FetchHttpClient.test.ts`. This file verifies that the interface
 *              declares the 5 canonical verbs (get/head/post/put/delete) and
 *              that FetchHttpClient implements them correctly.
 *
 *              It lives in `tests/unit/infrastructure/` (not in `src/domain/
 *              repositories/`) because the contract test crosses the
 *              domain-to-infrastructure boundary, and the architectural rule
 *              forbids infrastructure imports from domain — even in tests.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import type {
  HttpClientPort,
  HttpRequestOptions,
  HttpPostOptions,
} from "@core/domain/repositories/HttpClientPort.js";
import { FetchHttpClient } from "../../../src/infrastructure/adapters/FetchHttpClient.js";

describe("HttpClientPort contract", () => {
  it("declares 5 HTTP verbs (get/head/post/put/delete)", () => {
    // FetchHttpClient implements the port — this verifies the contract at runtime.
    const adapter: HttpClientPort = new FetchHttpClient();
    expect(typeof adapter.get).toBe("function");
    expect(typeof adapter.head).toBe("function");
    expect(typeof adapter.post).toBe("function");
    expect(typeof adapter.put).toBe("function");
    expect(typeof adapter.delete).toBe("function");
  });

  it("HttpPostOptions is back-compat alias of HttpRequestOptions", () => {
    // Type-level assertion — both must accept the same shape.
    const opts: HttpRequestOptions = { headers: { "X-A": "1" }, timeoutMs: 5000 };
    const legacy: HttpPostOptions = opts;
    expect(legacy.headers?.["X-A"]).toBe("1");
    expect(legacy.timeoutMs).toBe(5000);
  });
});
