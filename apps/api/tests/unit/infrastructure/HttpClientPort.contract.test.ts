/**
 * @file HttpClientPort.contract.test.ts
 * @description Type-level + runtime contract test for the HttpClientPort. The
 *              port is interface-only — the adapter's functional tests live in
 *              `FetchHttpClient.test.ts`. This file verifies that `HttpPostOptions`
 *              stays a back-compat alias of `HttpRequestOptions`, both types
 *              accepting the same shape.
 *
 *              It loads no adapter: beside vitest, it imports only the port's
 *              two option types, from `@core/domain`; the adapter that
 *              implements the port is exercised in the `FetchHttpClient.test.ts`
 *              suite named above.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import type {
  HttpRequestOptions,
  HttpPostOptions,
} from "@core/domain/repositories/HttpClientPort.js";

describe("HttpClientPort contract", () => {
  it("HttpPostOptions is back-compat alias of HttpRequestOptions", () => {
    // Type-level assertion — both must accept the same shape.
    const opts: HttpRequestOptions = { headers: { "X-A": "1" }, timeoutMs: 5000 };
    const legacy: HttpPostOptions = opts;
    expect(legacy.headers?.["X-A"]).toBe("1");
    expect(legacy.timeoutMs).toBe(5000);
  });
});
