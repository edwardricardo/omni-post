/**
 * @file telemetryResource.test.ts
 * @description Proves that `SocialMediaTelemetry` exports its spans under a resource carrying the
 *              configured service name and version as the semantic-convention attributes
 *              `service.name` and `service.version`. The SDK exports over OTLP/HTTP to a local
 *              server that records each JSON body, so nothing leaves the machine, and `shutdown()`
 *              flushes the batch before the test reads it. `OTEL_SERVICE_NAME` and
 *              `OTEL_RESOURCE_ATTRIBUTES` are removed for the test, because the SDK's environment
 *              detector replaces the configured values with theirs.
 * @layer infrastructure
 */
import { createServer, type Server } from "node:http";
import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialMediaTelemetry } from "../src/index.js";

const LOOPBACK = "127.0.0.1";
const SERVICE_NAME = "telemetry-resource-test";
const SERVICE_VERSION = "9.8.7";

/** The part of an OTLP/HTTP JSON trace export this suite reads. */
interface OtlpTraceExport {
  resourceSpans: { resource: { attributes: { key: string; value: { stringValue?: string } }[] } }[];
}

let server: Server;
let endpoint: string;
let receivedExports: OtlpTraceExport[];

/** The value of one attribute in every resource the local server received. */
const exportedResourceValues = (key: string): Set<string | undefined> =>
  new Set(
    receivedExports
      .flatMap((body) => body.resourceSpans)
      .map(({ resource }) => resource.attributes.find((attribute) => attribute.key === key))
      .map((attribute) => attribute?.value.stringValue)
  );

beforeAll(async () => {
  vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "none");
  vi.stubEnv("OTEL_SERVICE_NAME", undefined);
  vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", undefined);

  server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      receivedExports.push(JSON.parse(body) as OtlpTraceExport);
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  endpoint = `http://${LOOPBACK}:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

beforeEach(() => {
  receivedExports = [];
});

describe("the service resource of SocialMediaTelemetry", () => {
  it("exports the configured service name and version as service.name and service.version", async () => {
    const telemetry = new SocialMediaTelemetry({
      serviceName: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION,
      environment: "test",
      otlpEndpoint: endpoint,
    });
    await telemetry.start();

    trace.getTracer("telemetry-resource-test").startSpan("probe").end();
    await telemetry.shutdown();

    expect(exportedResourceValues("service.name")).toEqual(new Set([SERVICE_NAME]));
    expect(exportedResourceValues("service.version")).toEqual(new Set([SERVICE_VERSION]));
  });
});
