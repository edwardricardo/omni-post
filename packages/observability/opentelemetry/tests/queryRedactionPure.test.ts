/**
 * @file queryRedactionPure.test.ts
 * @description Pins that the pure redaction module, `queryRedaction.ts`, loads and works with no
 *              OpenTelemetry package: the API's Sentry initializer imports it at boot whether or not
 *              tracing is on, and the tracing stack must start only when `TRACING_ENABLED` is. The
 *              three packages the span processor needs are mocked with factories that throw when
 *              anything loads them, so an import of any of them, direct or through another module,
 *              rejects the import of the module under test.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => {
  throw new Error("@opentelemetry/api must not load with the pure redaction module");
});
vi.mock("@opentelemetry/core", () => {
  throw new Error("@opentelemetry/core must not load with the pure redaction module");
});
vi.mock("@opentelemetry/sdk-node", () => {
  throw new Error("@opentelemetry/sdk-node must not load with the pure redaction module");
});

describe("the pure query redaction module", () => {
  it("loads without the OpenTelemetry packages and redacts a string and an attribute", async () => {
    const redaction = await import("../src/queryRedaction.js");

    expect(redaction.redactSensitiveQueryParameters("/cb?code=FAKE_CODE&page=2")).toBe(
      "/cb?code=REDACTED&page=2"
    );
    expect(redaction.redactSensitiveQueryAttribute("url.query", "state=FAKE_STATE&page=2")).toBe(
      "state=REDACTED&page=2"
    );
  });
});
