/**
 * @file querySecretExport.test.ts
 * @description Proves that `SocialMediaTelemetry` sends its OTLP exporter spans whose sensitive
 *              query parameter values are already redacted: what leaves the process is checked,
 *              not a copy held in memory. The SDK exports over OTLP/HTTP to a local server that
 *              records each JSON body, so nothing leaves the machine, and `shutdown()` flushes the
 *              batch before the test reads it. The span comes from a tracer no instrumentation of
 *              the set-up configures, as a span of an instrumentation added later would. Every
 *              value is fake.
 * @layer infrastructure
 */
import { createServer, type Server } from "node:http";
import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SocialMediaTelemetry } from "../src/index.js";

const LOOPBACK = "127.0.0.1";
const FAKE_CODE = "FAKE_CODE_e5d0";
const FAKE_TOKEN = "FAKE_TOKEN_a81c";
const SPAN_NAME = "query-secret-export-probe";

let server: Server;
let endpoint: string;
const receivedBodies: string[] = [];

beforeAll(async () => {
  vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "none");

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
  endpoint = `http://${LOOPBACK}:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("the OTLP export of SocialMediaTelemetry", () => {
  it("sends the span with its sensitive query values redacted and its other values as they were set", async () => {
    const telemetry = new SocialMediaTelemetry({
      serviceName: "query-secret-export-test",
      serviceVersion: "1.2.3",
      environment: "test",
      otlpEndpoint: endpoint,
    });
    await telemetry.start();

    trace
      .getTracer("instrumentation-added-later")
      .startSpan(SPAN_NAME, {
        attributes: {
          "url.full": `https://graph.provider.test/v23.0/me?fields=id&access_token=${FAKE_TOKEN}`,
          "url.query": `code=${FAKE_CODE}&page=4`,
        },
      })
      .end();
    await telemetry.shutdown();

    const sent = receivedBodies.join("\n");
    expect(sent).toContain(SPAN_NAME);
    expect(sent).toContain("https://graph.provider.test/v23.0/me?fields=id&access_token=REDACTED");
    expect(sent).toContain("code=REDACTED&page=4");
    expect(sent).not.toContain(FAKE_TOKEN);
    expect(sent).not.toContain(FAKE_CODE);
  });
});
