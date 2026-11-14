/**
 * @file telemetryWithoutEndpoint.test.ts
 * @description Proves that `SocialMediaTelemetry` built without `otlpEndpoint` exports no span,
 *              even when the environment names an exporter. Given no span processor, the NodeSDK
 *              builds its own exporters from `OTEL_TRACES_EXPORTER` when it starts, and those sit
 *              behind no redaction; the set-up therefore always hands the SDK its own span
 *              processors, the query redaction alone when no endpoint is configured. The environment
 *              names the OTLP/HTTP JSON exporter and points it at a local server that records each
 *              body, so a span the fallback exported would be read here; `shutdown()` flushes every
 *              processor before the test reads the server. `OTEL_SERVICE_NAME` and
 *              `OTEL_RESOURCE_ATTRIBUTES` are removed for the test, as the resource test removes
 *              them. Every value is fake.
 * @layer infrastructure
 */
import { createServer, type Server } from "node:http";
import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SocialMediaTelemetry } from "../src/index.js";

const LOOPBACK = "127.0.0.1";
const FAKE_TOKEN = "FAKE_TOKEN_0d7e";
const SPAN_NAME = "telemetry-without-endpoint-probe";

let server: Server;
const receivedBodies: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      receivedBodies.push(body);
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "none");
  vi.stubEnv("OTEL_SERVICE_NAME", undefined);
  vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", undefined);
  vi.stubEnv("OTEL_TRACES_EXPORTER", "otlp");
  vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "http/json");
  vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", `http://${LOOPBACK}:${port}/v1/traces`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("SocialMediaTelemetry without an OTLP endpoint", () => {
  it("exports no span through the exporter OTEL_TRACES_EXPORTER names, while spans are still recorded", async () => {
    const telemetry = new SocialMediaTelemetry({
      serviceName: "telemetry-without-endpoint-test",
      serviceVersion: "1.2.3",
      environment: "test",
    });
    await telemetry.start();

    const span = trace.getTracer("instrumentation-added-later").startSpan(SPAN_NAME, {
      attributes: { "url.full": `https://graph.provider.test/v23.0/me?access_token=${FAKE_TOKEN}` },
    });
    const recording = span.isRecording();
    span.end();
    await telemetry.shutdown();

    expect(recording).toBe(true);
    expect(receivedBodies).toEqual([]);
  });
});
