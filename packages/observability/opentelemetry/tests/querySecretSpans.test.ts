/**
 * @file querySecretSpans.test.ts
 * @description Proves that no span the package's telemetry set-up exports carries the value of a
 *              sensitive query parameter, on each channel measured: the server span of the HTTP
 *              instrumentation (`url.query`), the `request` span of `@fastify/otel` (`url.path`,
 *              which holds the whole query), the client span of the HTTP instrumentation
 *              (`url.full`), the client span of the undici instrumentation that traces `fetch`
 *              (`url.full` and `url.query`, including the `key` of the Gemini connection test), the
 *              error spans of both clients, the exception event of a Fastify handler error (message
 *              and stack trace), and a span from a tracer no instrumentation of the set-up
 *              configures, which stands for an instrumentation added later, with an event of its own.
 *              The SDK is built the way `SocialMediaTelemetry` builds
 *              it, from `createTelemetryInstrumentations()` and `createTelemetrySpanProcessors()`,
 *              with an in-memory exporter in place of the OTLP one. Every test reads every string
 *              of every exported span, its name, attributes, events and status message, and checks
 *              that the names and the harmless parameters stay. Every value is fake and every
 *              request goes to a loopback server. `node:http` is required after the SDK starts,
 *              the way a CommonJS provider client loads it, which is what lets the instrumentation
 *              patch it; Fastify is imported before the SDK starts, the order of the API.
 * @layer infrastructure
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import Fastify, { type FastifyInstance } from "fastify";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { SpanKind, SpanStatusCode, trace, type AttributeValue } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetryInstrumentations, createTelemetrySpanProcessors } from "../src/index.js";

const LOOPBACK = "127.0.0.1";
const HTTP_SCOPE = "@opentelemetry/instrumentation-http";
const UNDICI_SCOPE = "@opentelemetry/instrumentation-undici";
const FASTIFY_SCOPE = "@fastify/otel";

const FAKE_CODE = "FAKE_CODE_7f3a";
const FAKE_STATE = "FAKE_STATE_9c1e";
const FAKE_TOKEN = "FAKE_TOKEN_4b2d";
const FAKE_KEY = "FAKE_KEY_61a0";
const FAKE_SECRETS = [FAKE_CODE, FAKE_STATE, FAKE_TOKEN, FAKE_KEY];

/** An OAuth callback query: the three values the request names, and one harmless parameter. */
const CALLBACK_QUERY = `code=${FAKE_CODE}&state=${FAKE_STATE}&access_token=${FAKE_TOKEN}&page=2`;
const REDACTED_CALLBACK_QUERY = "code=REDACTED&state=REDACTED&access_token=REDACTED&page=2";

/** A provider read the way the Graph API clients send it: the token in the query. */
const PROVIDER_PATH = `/v23.0/me?fields=id,name&access_token=${FAKE_TOKEN}`;
const REDACTED_PROVIDER_PATH = "/v23.0/me?fields=id,name&access_token=REDACTED";
/** The same path as the HTTP instrumentation writes it: it re-serializes every query it reads. */
const REDACTED_PROVIDER_PATH_REENCODED = "/v23.0/me?fields=id%2Cname&access_token=REDACTED";

const exporter = new tracing.InMemorySpanExporter();
const processors = createTelemetrySpanProcessors([exporter]);
let sdk: NodeSDK;
let server: Server;
let port: number;
let closedPort: number;
let app: FastifyInstance;

/** Waits until every span that has ended reaches the exporter. */
const flush = async (): Promise<void> => {
  await Promise.all(processors.map((processor) => processor.forceFlush()));
};

/** Sends one GET for `path` to `targetPort` on the loopback address through `node:http`. */
const httpGet = async (targetPort: number, path: string): Promise<void> => {
  const http = createRequire(import.meta.url)("node:http") as typeof import("node:http");
  await new Promise<void>((resolve, reject) => {
    const request = http.request(
      { host: LOOPBACK, port: targetPort, path, method: "GET" },
      (response) => {
        response.resume();
        response.on("end", resolve);
      }
    );
    request.on("error", reject);
    request.end();
  });
};

const spansOf = (scope: string, kind: SpanKind): tracing.ReadableSpan[] =>
  exporter
    .getFinishedSpans()
    .filter((span) => span.instrumentationScope.name === scope && span.kind === kind);

/** Every string an attribute value holds: the value itself, or each string of an array. */
const stringsOf = (value: AttributeValue | undefined): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  return [];
};

/** Every string of every exported span: its name, attributes, events and status message. */
const exportedStrings = (): string[] =>
  exporter
    .getFinishedSpans()
    .flatMap((span) => [
      span.name,
      ...Object.values(span.attributes).flatMap(stringsOf),
      ...span.events.flatMap((event) => [
        event.name,
        ...Object.values(event.attributes ?? {}).flatMap(stringsOf),
      ]),
      ...(span.status.message === undefined ? [] : [span.status.message]),
    ]);

/** The exported strings that still hold one of the fake values; empty when nothing leaked. */
const leakedStrings = (): string[] =>
  exportedStrings().filter((text) => FAKE_SECRETS.some((secret) => text.includes(secret)));

beforeAll(async () => {
  vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "none");
  sdk = new NodeSDK({
    instrumentations: createTelemetryInstrumentations(),
    spanProcessors: processors,
  });
  sdk.start();

  server = createServer((_request, response) => {
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const address = server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;

  // A port that was free a moment ago and is closed again: a request to it is refused.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const probeAddress = probe.address();
  closedPort = typeof probeAddress === "object" && probeAddress !== null ? probeAddress.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  app = Fastify();
  app.get("/auth/callback/:provider", async function handleCallback() {
    return { ok: true };
  });
  app.get("/provider/sync", async function syncProvider() {
    throw new Error(
      `upstream GET https://graph.provider.test/v23.0/me?access_token=${FAKE_TOKEN} failed`
    );
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sdk.shutdown();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  exporter.reset();
});

describe("query secrets on inbound spans", () => {
  it("exports the HTTP server span with code, state and access_token redacted in url.query", async () => {
    await httpGet(port, `/oauth/callback?${CALLBACK_QUERY}`);
    await flush();

    const spans = spansOf(HTTP_SCOPE, SpanKind.SERVER);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes["url.query"]).toBe(REDACTED_CALLBACK_QUERY);
    expect(span?.attributes["url.path"]).toBe("/oauth/callback");
    expect(span?.attributes["http.request.method"]).toBe("GET");
    expect(span?.attributes["http.response.status_code"]).toBe(200);
    expect(leakedStrings()).toEqual([]);
  });

  it("exports the Fastify request span with code, state and access_token redacted in url.path", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/auth/callback/facebook?${CALLBACK_QUERY}`,
    });
    await flush();

    expect(response.statusCode).toBe(200);
    const spans = spansOf(FASTIFY_SCOPE, SpanKind.SERVER).filter(
      (span) => span.attributes["fastify.root"] === FASTIFY_SCOPE
    );
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.name).toBe("request");
    expect(span?.attributes["url.path"]).toBe(`/auth/callback/facebook?${REDACTED_CALLBACK_QUERY}`);
    expect(span?.attributes["http.route"]).toBe("/auth/callback/:provider");
    expect(span?.attributes["http.response.status_code"]).toBe(200);
    expect(leakedStrings()).toEqual([]);
  });

  it("exports the exception event of a Fastify handler error with access_token redacted in its message and stack trace", async () => {
    const response = await app.inject({ method: "GET", url: "/provider/sync" });
    await flush();

    expect(response.statusCode).toBe(500);
    const spans = spansOf(FASTIFY_SCOPE, SpanKind.SERVER).filter(
      (span) => span.attributes["fastify.root"] === FASTIFY_SCOPE
    );
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "upstream GET https://graph.provider.test/v23.0/me?access_token=REDACTED failed",
    });
    const exceptions = span?.events.filter((event) => event.name === "exception") ?? [];
    expect(exceptions).toHaveLength(1);
    const [exception] = exceptions;
    expect(exception?.attributes?.["exception.type"]).toBe("Error");
    expect(exception?.attributes?.["exception.message"]).toBe(
      "upstream GET https://graph.provider.test/v23.0/me?access_token=REDACTED failed"
    );
    expect(exception?.attributes?.["exception.stacktrace"]).toEqual(
      expect.stringContaining(
        "Error: upstream GET https://graph.provider.test/v23.0/me?access_token=REDACTED failed\n"
      )
    );
    expect(leakedStrings()).toEqual([]);
  });
});

describe("query secrets on outbound spans", () => {
  it("exports the HTTP client span with access_token redacted in url.full", async () => {
    await httpGet(port, PROVIDER_PATH);
    await flush();

    const spans = spansOf(HTTP_SCOPE, SpanKind.CLIENT);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes["url.full"]).toBe(
      `http://${LOOPBACK}:${port}${REDACTED_PROVIDER_PATH_REENCODED}`
    );
    expect(span?.attributes["http.response.status_code"]).toBe(200);
    expect(leakedStrings()).toEqual([]);
  });

  it("exports the fetch client span with access_token redacted in url.full and url.query", async () => {
    const response = await fetch(`http://${LOOPBACK}:${port}${PROVIDER_PATH}`);
    await response.text();
    await flush();

    const spans = spansOf(UNDICI_SCOPE, SpanKind.CLIENT);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes["url.full"]).toBe(
      `http://${LOOPBACK}:${port}${REDACTED_PROVIDER_PATH}`
    );
    expect(span?.attributes["url.query"]).toBe("?fields=id,name&access_token=REDACTED");
    expect(span?.attributes["url.path"]).toBe("/v23.0/me");
    expect(span?.attributes["http.response.status_code"]).toBe(200);
    expect(leakedStrings()).toEqual([]);
  });

  it("exports the fetch client span with key redacted, the form of the Gemini connection test", async () => {
    const response = await fetch(`http://${LOOPBACK}:${port}/v1/models?key=${FAKE_KEY}`);
    await response.text();
    await flush();

    const spans = spansOf(UNDICI_SCOPE, SpanKind.CLIENT);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes["url.full"]).toBe(`http://${LOOPBACK}:${port}/v1/models?key=REDACTED`);
    expect(span?.attributes["url.query"]).toBe("?key=REDACTED");
    expect(span?.attributes["url.path"]).toBe("/v1/models");
    expect(leakedStrings()).toEqual([]);
  });

  it("exports the error spans of a refused request and a refused fetch with access_token redacted", async () => {
    await expect(httpGet(closedPort, PROVIDER_PATH)).rejects.toThrow();
    await expect(fetch(`http://${LOOPBACK}:${closedPort}${PROVIDER_PATH}`)).rejects.toThrow();
    await flush();

    const httpSpans = spansOf(HTTP_SCOPE, SpanKind.CLIENT);
    const fetchSpans = spansOf(UNDICI_SCOPE, SpanKind.CLIENT);
    expect(httpSpans).toHaveLength(1);
    expect(fetchSpans).toHaveLength(1);
    expect(httpSpans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(fetchSpans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(httpSpans[0]?.attributes["url.full"]).toBe(
      `http://${LOOPBACK}:${closedPort}${REDACTED_PROVIDER_PATH_REENCODED}`
    );
    expect(fetchSpans[0]?.attributes["url.full"]).toBe(
      `http://${LOOPBACK}:${closedPort}${REDACTED_PROVIDER_PATH}`
    );
    expect(leakedStrings()).toEqual([]);
  });
});

describe("query secrets on a span no instrumentation of the set-up configures", () => {
  it("exports the span with every sensitive value redacted and every other value as it was set", async () => {
    const span = trace
      .getTracer("instrumentation-added-later")
      .startSpan(`GET /cb?code=${FAKE_CODE}`, { kind: SpanKind.CLIENT });
    span.setAttributes({
      "url.full": `https://provider.test/oauth/token?client_id=app-1&code=${FAKE_CODE}`,
      "url.query": `state=${FAKE_STATE}&page=3`,
      "http.target": `/me?access_token=${FAKE_TOKEN}`,
      "http.request.header.referer": [`https://app.test/cb?state=${FAKE_STATE}`, "no query"],
      "http.response.status_code": 200,
      "app.cached": false,
      "app.note": "plain text with no query",
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `GET /me?access_token=${FAKE_TOKEN} failed`,
    });
    span.end();
    await flush();

    const spans = exporter
      .getFinishedSpans()
      .filter((exported) => exported.instrumentationScope.name === "instrumentation-added-later");
    expect(spans).toHaveLength(1);
    const [exported] = spans;
    expect(exported?.name).toBe("GET /cb?code=REDACTED");
    expect(exported?.attributes).toEqual({
      "url.full": "https://provider.test/oauth/token?client_id=app-1&code=REDACTED",
      "url.query": "state=REDACTED&page=3",
      "http.target": "/me?access_token=REDACTED",
      "http.request.header.referer": ["https://app.test/cb?state=REDACTED", "no query"],
      "http.response.status_code": 200,
      "app.cached": false,
      "app.note": "plain text with no query",
    });
    expect(exported?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "GET /me?access_token=REDACTED failed",
    });
    expect(leakedStrings()).toEqual([]);
  });

  it("exports an event with its name and its string attributes redacted and its other attributes as set", async () => {
    const span = trace.getTracer("instrumentation-added-later").startSpan("event-carrier");
    span.addEvent(`redirect to /cb?state=${FAKE_STATE}`, {
      "url.full": `https://provider.test/me?access_token=${FAKE_TOKEN}&fields=id`,
      "url.query": `code=${FAKE_CODE}&page=5`,
      "http.request.header.referer": [`https://app.test/cb?state=${FAKE_STATE}`, "no query"],
      "http.response.status_code": 302,
    });
    span.end();
    await flush();

    const [exported] = exporter
      .getFinishedSpans()
      .filter((candidate) => candidate.name === "event-carrier");
    expect(exported?.events).toHaveLength(1);
    expect(exported?.events[0]?.name).toBe("redirect to /cb?state=REDACTED");
    expect(exported?.events[0]?.attributes).toEqual({
      "url.full": "https://provider.test/me?access_token=REDACTED&fields=id",
      "url.query": "code=REDACTED&page=5",
      "http.request.header.referer": ["https://app.test/cb?state=REDACTED", "no query"],
      "http.response.status_code": 302,
    });
    expect(leakedStrings()).toEqual([]);
  });
});
