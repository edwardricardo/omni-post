/**
 * @file HttpClientPort.contract.test.ts
 * @description Type-level + runtime contract test del HttpClientPort. El port
 *              es solo interface — los tests funcionales del adapter viven en
 *              `FetchHttpClient.test.ts`. Este file verifica que el interface
 *              declara los 5 verbos canon (get/head/post/put/delete) y que
 *              FetchHttpClient los implementa correctamente.
 *
 *              Ubicado en `tests/unit/infrastructure/` (no en `src/domain/
 *              repositories/`) porque el contract test cruza el boundary
 *              dominio→infraestructura, y la regla arquitectural prohíbe
 *              imports de infrastructure desde domain — incluso en tests.
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
