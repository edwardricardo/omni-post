/**
 * @file fastifyRouteSpans.test.ts
 * @description Proves that the instrumentation set the package's NodeSDK bootstrap registers emits
 *              one Fastify request span per request, carrying the matched route pattern. The
 *              Fastify module is imported before the SDK starts and the instance is created after
 *              it, the order of apps/api/src/index.ts, whose static imports are evaluated before
 *              its top-level `telemetry.start()`. The SDK is built with the instrumentations of
 *              `createTelemetryInstrumentations()` and an in-memory span processor in place of the
 *              OTLP exporter, with the metric and log exporters off as the bootstrap sets them.
 * @layer infrastructure
 */
import Fastify, { type FastifyInstance } from "fastify";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { SpanKind } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetryInstrumentations } from "../src/index.js";

const ROUTE_PATTERN = "/posts/:postId";
const FASTIFY_OTEL_SCOPE = "@fastify/otel";
const DEPRECATED_FASTIFY_SCOPE = "@opentelemetry/instrumentation-fastify";

interface PostParams {
  postId: string;
}

const exporter = new tracing.InMemorySpanExporter();
const processor = new tracing.SimpleSpanProcessor(exporter);
let sdk: NodeSDK;
let app: FastifyInstance;

/** Sends one request and waits for its spans: the export waits for the resource's async attributes. */
const send = async (url: string): Promise<number> => {
  const response = await app.inject({ method: "GET", url });
  await processor.forceFlush();
  return response.statusCode;
};

const finishedSpans = (): tracing.ReadableSpan[] => exporter.getFinishedSpans();

const requestSpans = (): tracing.ReadableSpan[] =>
  finishedSpans().filter((span) => span.attributes["fastify.root"] === FASTIFY_OTEL_SCOPE);

const handlerSpans = (): tracing.ReadableSpan[] =>
  finishedSpans().filter((span) => span.attributes["fastify.type"] === "request-handler");

beforeAll(async () => {
  vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "none");
  sdk = new NodeSDK({
    instrumentations: createTelemetryInstrumentations(),
    spanProcessors: [processor],
  });
  sdk.start();

  app = Fastify();
  app.get<{ Params: PostParams }>(ROUTE_PATTERN, async function getPost(request) {
    return { postId: request.params.postId };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await sdk.shutdown();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  exporter.reset();
});

describe("Fastify route spans through the SDK-side @fastify/otel registration", () => {
  it("emits one request span with the route pattern for one request to a parameterised route", async () => {
    const statusCode = await send("/posts/42");

    expect(statusCode).toBe(200);
    const spans = requestSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.name).toBe("request");
    expect(span?.instrumentationScope.name).toBe(FASTIFY_OTEL_SCOPE);
    expect(span?.kind).toBe(SpanKind.SERVER);
    expect(span?.attributes["http.route"]).toBe(ROUTE_PATTERN);
    expect(span?.attributes["http.request.method"]).toBe("GET");
    expect(span?.attributes["url.path"]).toBe("/posts/42");
    expect(span?.attributes["http.response.status_code"]).toBe(200);
  });

  it("nests one handler span named after the route handler under the request span", async () => {
    await send("/posts/7");

    const [request] = requestSpans();
    const handlers = handlerSpans();
    expect(handlers).toHaveLength(1);
    const [handler] = handlers;
    expect(handler?.name).toBe("handler - getPost");
    expect(handler?.attributes["http.route"]).toBe(ROUTE_PATTERN);
    expect(handler?.parentSpanContext?.spanId).toBe(request?.spanContext().spanId);
    expect(handler?.spanContext().traceId).toBe(request?.spanContext().traceId);
  });

  it("emits one request span per request, each in its own trace", async () => {
    await send("/posts/1");
    await send("/posts/2");

    const spans = requestSpans();
    expect(spans.map((span) => span.attributes["url.path"])).toEqual(["/posts/1", "/posts/2"]);
    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(2);
  });

  it("emits no span from the deprecated @opentelemetry/instrumentation-fastify", async () => {
    await send("/posts/3");

    const deprecated = finishedSpans().filter(
      (span) => span.instrumentationScope.name === DEPRECATED_FASTIFY_SCOPE
    );
    expect(deprecated).toHaveLength(0);
    expect(requestSpans()).toHaveLength(1);
  });
});
