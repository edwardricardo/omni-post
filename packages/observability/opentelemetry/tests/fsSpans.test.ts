/**
 * @file fsSpans.test.ts
 * @description Proves that the file-system instrumentation the package's NodeSDK bootstrap
 *              registers emits exactly one span for one synchronous read. The auto-instrumentations
 *              map leaves its `fs` entry disabled by default, so the span exists only while the
 *              package's configuration enables that entry. The read runs inside a parent span and
 *              only the spans of that trace are counted, because the instrumentation also records
 *              the file reads the test runner makes in the same process. `node:fs` is required
 *              after the SDK starts, the way a CommonJS module loads it.
 * @layer infrastructure
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetryInstrumentations } from "../src/index.js";

const READ_SPAN_NAME = "fs readFileSync";

const exporter = new tracing.InMemorySpanExporter();
const processor = new tracing.SimpleSpanProcessor(exporter);
let sdk: NodeSDK;

interface ParentSpanIds {
  traceId: string;
  spanId: string;
}

/** Reads this test file once inside a parent span and waits for the spans to be exported. */
const readInsideParentSpan = async (): Promise<ParentSpanIds> => {
  const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
  const ids = trace.getTracer("fs-spans-test").startActiveSpan("parent", (parent) => {
    fs.readFileSync(fileURLToPath(import.meta.url));
    parent.end();
    return { traceId: parent.spanContext().traceId, spanId: parent.spanContext().spanId };
  });
  await processor.forceFlush();
  return ids;
};

beforeAll(() => {
  vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "none");
  sdk = new NodeSDK({
    instrumentations: createTelemetryInstrumentations(),
    spanProcessors: [processor],
  });
  sdk.start();
});

afterAll(async () => {
  await sdk.shutdown();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  exporter.reset();
});

describe("file-system spans", () => {
  it("emits exactly one span, child of the active span, for one synchronous file read", async () => {
    const parent = await readInsideParentSpan();

    const reads = exporter
      .getFinishedSpans()
      .filter((span) => span.spanContext().traceId === parent.traceId)
      .filter((span) => span.name === READ_SPAN_NAME);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.parentSpanContext?.spanId).toBe(parent.spanId);
  });
});
