/**
 * @file redactionGuard.test.ts
 * @description Proves that the exporters of the telemetry set-up receive only spans the query
 *              redaction processed. The redaction runs in the span processor hook `onEnding`, which
 *              upstream marks experimental; an SDK that stopped calling it would otherwise export
 *              every span unredacted, with no error. The test emulates such an SDK by registering
 *              the redaction processor with every method but `onEnding`: no span reaches the
 *              exporter, and the fact is reported once for the whole set-up, across exporters and
 *              flushes, through the injected reporter (the line an operator sees with default
 *              settings, with no span data in it) and through the OpenTelemetry diagnostics logger. In normal operation every span still reaches every exporter, and
 *              shutting the tracer provider down still shuts every exporter down; the guard passes
 *              `forceFlush` and `shutdown` through to the exporter it wraps. The spans come
 *              from a `BasicTracerProvider`, which registers no global API, and the exporter is a
 *              recorder of what it receives. Every value is fake.
 * @layer infrastructure
 */
import { diag, DiagLogLevel, type DiagLogger } from "@opentelemetry/api";
import { core, tracing } from "@opentelemetry/sdk-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetrySpanProcessors } from "../src/index.js";
import {
  QueryParameterRedactionSpanProcessor,
  RedactionGuardedSpanExporter,
} from "../src/spanQueryRedaction.js";

const FAKE_TOKEN = "FAKE_TOKEN_93bb";
const SENSITIVE_URL = `https://graph.provider.test/v23.0/me?access_token=${FAKE_TOKEN}`;

/** An exporter that records every span it receives and every flush and shutdown it is asked for. */
class RecordingExporter implements tracing.SpanExporter {
  readonly exported: tracing.ReadableSpan[] = [];
  flushes = 0;
  shutdowns = 0;

  export(spans: tracing.ReadableSpan[], resultCallback: (result: core.ExportResult) => void): void {
    this.exported.push(...spans);
    resultCallback({ code: core.ExportResultCode.SUCCESS });
  }

  forceFlush(): Promise<void> {
    this.flushes += 1;
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.shutdowns += 1;
    return Promise.resolve();
  }
}

const diagLogger: DiagLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
};

/** Ends one span per name, each carrying a sensitive query value, on the provider's tracer. */
const endSpans = (provider: tracing.BasicTracerProvider, names: readonly string[]): void => {
  const tracer = provider.getTracer("redaction-guard-test");
  for (const name of names) {
    tracer.startSpan(name, { attributes: { "url.full": SENSITIVE_URL } }).end();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  diag.setLogger(diagLogger, DiagLogLevel.ERROR);
});

afterEach(() => {
  diag.disable();
});

describe("the export guard of the telemetry set-up", () => {
  it("forwards no span the redaction did not process and reports that once, at error level", async () => {
    const recorder = new RecordingExporter();
    const processors = createTelemetrySpanProcessors([recorder]);
    const redaction = processors.find(
      (processor) => processor instanceof QueryParameterRedactionSpanProcessor
    );
    expect(redaction).toBeInstanceOf(QueryParameterRedactionSpanProcessor);
    // An SDK that never calls the experimental hook: every processor method but `onEnding`.
    const withoutHook = processors.map((processor): tracing.SpanProcessor =>
      processor === redaction
        ? {
            onStart: (span, parentContext) => processor.onStart(span, parentContext),
            onEnd: (span) => processor.onEnd(span),
            forceFlush: () => processor.forceFlush(),
            shutdown: () => processor.shutdown(),
          }
        : processor
    );
    const provider = new tracing.BasicTracerProvider({ spanProcessors: withoutHook });

    endSpans(provider, ["first", "second"]);
    await provider.forceFlush();
    endSpans(provider, ["third"]);
    await provider.forceFlush();

    expect(recorder.exported).toEqual([]);
    expect(diagLogger.error).toHaveBeenCalledTimes(1);
    expect(diagLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("not processed by the query redaction")
    );
    await provider.shutdown();
  });

  it("reports the drop once for the whole set-up, across exporters and flushes, with no span data", async () => {
    const recorders = [new RecordingExporter(), new RecordingExporter()];
    const reporter = vi.fn<(message: string) => void>();
    const processors = createTelemetrySpanProcessors(recorders, reporter);
    const redaction = processors.find(
      (processor) => processor instanceof QueryParameterRedactionSpanProcessor
    );
    const withoutHook = processors.map((processor): tracing.SpanProcessor =>
      processor === redaction
        ? {
            onStart: (span, parentContext) => processor.onStart(span, parentContext),
            onEnd: (span) => processor.onEnd(span),
            forceFlush: () => processor.forceFlush(),
            shutdown: () => processor.shutdown(),
          }
        : processor
    );
    const provider = new tracing.BasicTracerProvider({ spanProcessors: withoutHook });

    endSpans(provider, ["span-alpha-name", "span-beta-name"]);
    await provider.forceFlush();
    endSpans(provider, ["span-gamma-name"]);
    await provider.forceFlush();

    expect(recorders.map((recorder) => recorder.exported)).toEqual([[], []]);
    expect(reporter).toHaveBeenCalledTimes(1);
    const [message] = reporter.mock.calls[0] ?? [];
    expect(message).toEqual(expect.stringContaining("not processed by the query redaction"));
    for (const secret of [FAKE_TOKEN, "access_token", "graph.provider.test", "span-"]) {
      expect(message).not.toContain(secret);
    }
    await provider.shutdown();
  });

  it("never calls the reporter when the SDK calls the hook", async () => {
    const reporter = vi.fn<(message: string) => void>();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: createTelemetrySpanProcessors([new RecordingExporter()], reporter),
    });

    endSpans(provider, ["first", "second"]);
    await provider.forceFlush();

    expect(reporter).not.toHaveBeenCalled();
    await provider.shutdown();
  });

  it("ends and exports a span whose event has no string name, and still redacts its other events", async () => {
    const recorder = new RecordingExporter();
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: createTelemetrySpanProcessors([recorder], vi.fn()),
    });
    const span = provider.getTracer("redaction-guard-test").startSpan("untyped-event-span");
    // canon-exception: test-fixture
    span.addEvent(undefined as unknown as string);
    span.addEvent(`redirect to /cb?access_token=${FAKE_TOKEN}`);

    expect(() => span.end()).not.toThrow();
    await provider.forceFlush();

    expect(recorder.exported.map((exported) => exported.name)).toEqual(["untyped-event-span"]);
    expect(recorder.exported[0]?.events.map((event) => event.name)).toContain(
      "redirect to /cb?access_token=REDACTED"
    );
    await provider.shutdown();
  });

  it("forwards every span to every exporter, redacted, when the SDK calls the hook", async () => {
    const recorders = [new RecordingExporter(), new RecordingExporter()];
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: createTelemetrySpanProcessors(recorders),
    });

    endSpans(provider, ["first", "second", "third"]);
    await provider.forceFlush();

    for (const recorder of recorders) {
      expect(recorder.exported.map((span) => span.name)).toEqual(["first", "second", "third"]);
      expect(recorder.exported.map((span) => span.attributes["url.full"])).toEqual([
        "https://graph.provider.test/v23.0/me?access_token=REDACTED",
        "https://graph.provider.test/v23.0/me?access_token=REDACTED",
        "https://graph.provider.test/v23.0/me?access_token=REDACTED",
      ]);
    }
    expect(diagLogger.error).not.toHaveBeenCalled();
    await provider.shutdown();
  });

  it("shuts every exporter down when the tracer provider shuts down", async () => {
    const recorders = [new RecordingExporter(), new RecordingExporter()];
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: createTelemetrySpanProcessors(recorders),
    });

    await provider.shutdown();

    expect(recorders.map((recorder) => recorder.shutdowns)).toEqual([1, 1]);
  });

  it("passes forceFlush and shutdown through to the exporter it wraps", async () => {
    const recorder = new RecordingExporter();
    const guard = new RedactionGuardedSpanExporter(
      recorder,
      new QueryParameterRedactionSpanProcessor(),
      vi.fn()
    );

    await guard.forceFlush();
    await guard.shutdown();

    expect(recorder.flushes).toBe(1);
    expect(recorder.shutdowns).toBe(1);
  });
});
