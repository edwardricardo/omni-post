/**
 * @file httpProviderSpans.test.ts
 * @description Proves the two hooks of the HTTP instrumentation the package's NodeSDK bootstrap
 *              registers. Its request hook sets the social provider's attributes on the client span
 *              of a real outgoing request to a provider host, on no client span of a request to
 *              another host, and on no server span, even when the client's `Host` header names a
 *              provider host. Its outgoing-request filter starts no client span for a request to a
 *              health or metrics path, while the local server's span of the same request shows that
 *              the request was sent. Every host resolves to the local server through the request's
 *              `lookup` option, so no request leaves the machine. `node:http` is required after the
 *              SDK starts, the way a CommonJS provider client loads it, which is what lets the
 *              instrumentation patch it. The entry's `enabled: true` keeps the instrumentation when
 *              `OTEL_NODE_DISABLED_INSTRUMENTATIONS` names it, as the explicit instance it replaced did.
 * @layer infrastructure
 */
import { createServer, type Server } from "node:http";
import type { LookupFunction } from "node:net";
import { createRequire } from "node:module";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { SpanKind } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetryInstrumentations } from "../src/index.js";

const LOOPBACK = "127.0.0.1";
const PROVIDER_PATH = "/2/tweets";
const OTHER_HOST = "internal.example";

const exporter = new tracing.InMemorySpanExporter();
const processor = new tracing.SimpleSpanProcessor(exporter);
let sdk: NodeSDK;
let server: Server;
let port: number;
let receivedHostHeader: string | undefined;

/**
 * Resolves every host name to the loopback address, so the request reaches the local server. Node
 * asks for every address (`all`) when it races address families, and then reads an array.
 */
const loopbackLookup: LookupFunction = (_hostname, options, callback) => {
  if (options.all === true) {
    callback(null, [{ address: LOOPBACK, family: 4 }]);
    return;
  }
  callback(null, LOOPBACK, 4);
};

/** Sends one GET for `path` to `host` on the local server and waits for its spans to be exported. */
const send = async (host: string, path: string = PROVIDER_PATH): Promise<void> => {
  const http = createRequire(import.meta.url)("node:http") as typeof import("node:http");
  await new Promise<void>((resolve, reject) => {
    const request = http.request(
      { host, port, path, method: "GET", lookup: loopbackLookup },
      (response) => {
        response.resume();
        response.on("end", resolve);
      }
    );
    request.on("error", reject);
    request.end();
  });
  await processor.forceFlush();
};

const clientSpans = (): tracing.ReadableSpan[] =>
  exporter.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT);

const serverSpans = (): tracing.ReadableSpan[] =>
  exporter.getFinishedSpans().filter((span) => span.kind === SpanKind.SERVER);

beforeAll(async () => {
  vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "none");
  sdk = new NodeSDK({
    instrumentations: createTelemetryInstrumentations(),
    spanProcessors: [processor],
  });
  sdk.start();

  server = createServer((request, response) => {
    receivedHostHeader = request.headers.host;
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const address = server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sdk.shutdown();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  exporter.reset();
  receivedHostHeader = undefined;
});

describe("social provider attributes on HTTP spans", () => {
  it("sets the provider attributes on the client span of a request to a provider host", async () => {
    await send("api.twitter.com");

    const spans = clientSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes["social.provider"]).toBe("x");
    expect(span?.attributes["social.api.version"]).toBe("2");
  });

  it("sets no provider attribute on the client span of a host that only starts with a provider host", async () => {
    await send("api.twitter.com.evil.example");

    const spans = clientSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes["social.provider"]).toBeUndefined();
    expect(span?.attributes["social.api.version"]).toBeUndefined();
  });

  it("sets no provider attribute on the server span of a request whose Host header names a provider host", async () => {
    await send("api.twitter.com");

    expect(receivedHostHeader).toBe(`api.twitter.com:${port}`);
    const spans = serverSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes["social.provider"]).toBeUndefined();
    expect(span?.attributes["social.api.version"]).toBeUndefined();
  });
});

describe("client spans of outgoing requests, by path", () => {
  it("starts exactly one client span for an outgoing request to a path other than /health and /metrics", async () => {
    await send(OTHER_HOST, "/v1/items");

    expect(clientSpans()).toHaveLength(1);
    expect(serverSpans()).toHaveLength(1);
  });

  it("suppresses the client span of an outgoing /health request", async () => {
    await send(OTHER_HOST, "/health");

    expect(clientSpans()).toHaveLength(0);
    expect(serverSpans()).toHaveLength(1);
  });

  it("suppresses the client span of an outgoing /metrics request", async () => {
    await send(OTHER_HOST, "/metrics");

    expect(clientSpans()).toHaveLength(0);
    expect(serverSpans()).toHaveLength(1);
  });
});

describe("enablement of the HTTP instrumentation", () => {
  it("keeps the HTTP instrumentation when OTEL_NODE_DISABLED_INSTRUMENTATIONS names it", () => {
    const previous = process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS;
    vi.stubEnv("OTEL_NODE_DISABLED_INSTRUMENTATIONS", "http");
    try {
      const names = (createTelemetryInstrumentations() ?? [])
        .flat()
        .map((instrumentation) => instrumentation.instrumentationName);

      expect(names).toContain("@opentelemetry/instrumentation-http");
    } finally {
      // Restores this one variable: `vi.unstubAllEnvs()` would also undo the `beforeAll` stubs.
      vi.stubEnv("OTEL_NODE_DISABLED_INSTRUMENTATIONS", previous);
    }
  });
});
