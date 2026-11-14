/**
 * @file spanQueryRedaction.ts
 * @description Applies the query redaction of `queryRedaction.ts` to spans: the span processor that
 *              rewrites every span the telemetry set-up ends, before any exporter receives it, the
 *              exporter guard that lets through only the spans that processor processed, and the
 *              reporter that tells an operator, once, when the guard dropped a span. It loads the
 *              OpenTelemetry SDK, so only the tracing set-up imports it; the pure list and
 *              functions it uses stay in `queryRedaction.ts`.
 * @layer infrastructure
 */
import { diag, type Attributes, type Context } from "@opentelemetry/api";
import { core, type tracing } from "@opentelemetry/sdk-node";
import { redactSensitiveQueryAttribute, redactSensitiveQueryParameters } from "./queryRedaction.js";

/** Redacts, in place, every string and string-array value of one attribute set. */
const redactAttributesInPlace = (attributes: Attributes): void => {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    const redacted = redactSensitiveQueryAttribute(key, value);
    if (redacted !== value) attributes[key] = redacted;
  }
};

/**
 * Redacts sensitive query values on every span while it is ending, before the span becomes
 * read-only and before any processor hands it to an exporter: its attributes, its name, its status
 * message, and the name and attributes of each of its events. Registered with the other span
 * processors of a tracer provider, it covers every exporter of that provider and every
 * instrumentation, including one added later. It remembers each span it processed, so that
 * `RedactionGuardedSpanExporter` can refuse a span it never saw. Span links are not rewritten: the one
 * instrumentation of the set-up that sets a link attribute, `@opentelemetry/instrumentation-aws-lambda`,
 * does so only inside a Lambda runtime, and the value is a message id, not a URL.
 */
export class QueryParameterRedactionSpanProcessor implements tracing.SpanProcessor {
  private readonly redactedSpans = new WeakSet<tracing.ReadableSpan>();

  /**
   * @method onStart
   * @description Does nothing: attributes may still change until the span ends.
   * @param _span - The span that started
   * @param _parentContext - The context it started in
   */
  onStart(_span: tracing.Span, _parentContext: Context): void {
    // The redaction runs once, when the span ends, over the values it ends with.
  }

  /**
   * @method onEnding
   * @description Replaces every sensitive query value of the ending span's attributes, name, status
   *              message, and each event's name and attributes, then marks the span as processed.
   *              Only strings and arrays of strings are rewritten; a value of any other type, such as
   *              the missing name of an event an untyped caller added, is left as it is and never
   *              makes the span fail to end.
   *              The SDK calls it on every processor before it marks the span ended, so the span's
   *              own setters still apply, and before any processor's `onEnd`. An event is the plain
   *              object `Span.addEvent` stored, whose `name` and `attributes` the SDK's `TimedEvent`
   *              declares writable; no span method changes an event once it was added.
   * @param span - The span that is ending
   */
  onEnding(span: tracing.Span): void {
    for (const [key, value] of Object.entries(span.attributes)) {
      if (value === undefined) continue;
      const redacted = redactSensitiveQueryAttribute(key, value);
      if (redacted !== value) span.setAttribute(key, redacted);
    }
    const name = redactSensitiveQueryParameters(span.name);
    if (name !== span.name) span.updateName(name);
    const { code, message } = span.status;
    if (message !== undefined) {
      const redactedMessage = redactSensitiveQueryParameters(message);
      if (redactedMessage !== message) span.setStatus({ code, message: redactedMessage });
    }
    for (const event of span.events) {
      // An untyped caller can add an event with no string name; only strings are rewritten, and a
      // value of any other type must not make `span.end()` throw.
      if (typeof event.name === "string") event.name = redactSensitiveQueryParameters(event.name);
      if (event.attributes !== undefined) redactAttributesInPlace(event.attributes);
    }
    this.redactedSpans.add(span);
  }

  /**
   * @method hasRedacted
   * @description Tells whether this processor's `onEnding` processed the span.
   * @param span - A span on its way to an exporter
   * @returns `true` when the span went through `onEnding`
   */
  hasRedacted(span: tracing.ReadableSpan): boolean {
    return this.redactedSpans.has(span);
  }

  /**
   * @method onEnd
   * @description Does nothing: the span is read-only by now.
   * @param _span - The span that ended
   */
  onEnd(_span: tracing.ReadableSpan): void {
    // Every change happened in `onEnding`, while the span still accepted it.
  }

  /**
   * @method forceFlush
   * @description Resolves at once: this processor holds no span.
   * @returns A resolved promise
   */
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * @method shutdown
   * @description Resolves at once: this processor holds no resource.
   * @returns A resolved promise
   */
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Receives the number of spans an exporter guard dropped, every time it drops some. The reporter
 * built by `createDroppedSpanReporter` is shared by every guard of one telemetry set-up and speaks
 * once.
 */
export type DroppedSpanReporter = (count: number) => void;

/**
 * @description Builds the reporter that every `RedactionGuardedSpanExporter` of one telemetry set-up
 *              shares, so that the whole set-up reports a drop once, not once per exporter. The first
 *              drop is written at error level to the OpenTelemetry diagnostics logger and to
 *              `write`; later drops are not reported again, because they would repeat the same cause.
 *              The OpenTelemetry diagnostics logger prints nothing unless a diag logger is
 *              registered, and by default none is, so `write` is what makes the drop visible with
 *              default settings. The text is fixed wording and the count of spans: it never holds a
 *              span name, an attribute value or a URL, so it is safe to log.
 * @param write - Receives the one line, for example a logger's error method
 * @returns The reporter to hand to every guard of the set-up
 */
export function createDroppedSpanReporter(write: (message: string) => void): DroppedSpanReporter {
  let reported = false;
  return (count) => {
    if (reported) return;
    reported = true;
    const message =
      `Telemetry export guard: ${count} span(s) not processed by the query redaction were dropped ` +
      "and not exported, because the SDK did not call the span processor hook onEnding or the " +
      "query redaction processor is not registered on the tracer provider. Later drops are not " +
      "reported.";
    diag.error(message);
    write(message);
  };
}

/**
 * Wraps one exporter and forwards to it only the spans the query redaction processed, the same
 * span objects it received; it drops every other span. The redaction runs in `onEnding`, a hook
 * upstream marks experimental: an SDK that stopped calling it would hand the exporter spans that
 * were never redacted. The guard turns that into spans that are not exported, reported through the
 * shared `DroppedSpanReporter` it was given, instead of a silent leak. It reports success for a
 * batch it dropped entirely, so the span processor does not report each batch again.
 */
export class RedactionGuardedSpanExporter implements tracing.SpanExporter {
  /**
   * @param exporter - The exporter that receives the redacted spans
   * @param redaction - The processor whose `onEnding` marks each span it redacted
   * @param reportDropped - The reporter shared by every guard of the set-up, called with the number
   *                        of spans each time this guard drops some
   */
  constructor(
    private readonly exporter: tracing.SpanExporter,
    private readonly redaction: QueryParameterRedactionSpanProcessor,
    private readonly reportDropped: DroppedSpanReporter
  ) {}

  /**
   * @method export
   * @description Forwards the spans the redaction processed and drops the others.
   * @param spans - The spans the span processor hands over
   * @param resultCallback - Receives the result of the export
   */
  export(spans: tracing.ReadableSpan[], resultCallback: (result: core.ExportResult) => void): void {
    const redacted = spans.filter((span) => this.redaction.hasRedacted(span));
    if (redacted.length < spans.length) this.reportDropped(spans.length - redacted.length);
    if (redacted.length === 0) {
      resultCallback({ code: core.ExportResultCode.SUCCESS });
      return;
    }
    this.exporter.export(redacted, resultCallback);
  }

  /**
   * @method forceFlush
   * @description Flushes the wrapped exporter, when it can flush.
   * @returns A promise that settles when the wrapped exporter has flushed
   */
  forceFlush(): Promise<void> {
    return this.exporter.forceFlush?.() ?? Promise.resolve();
  }

  /**
   * @method shutdown
   * @description Shuts the wrapped exporter down.
   * @returns A promise that settles when the wrapped exporter has shut down
   */
  shutdown(): Promise<void> {
    return this.exporter.shutdown();
  }
}
