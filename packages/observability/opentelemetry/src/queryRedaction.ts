/**
 * @file queryRedaction.ts
 * @description The one place where telemetry redacts the values of sensitive URL query parameters:
 *              the list of their names, the function that replaces their values in any string, its
 *              variant for one attribute value, the span processor that applies it to every span the
 *              telemetry set-up ends, before any exporter receives the span, the exporter guard
 *              that lets through only the spans that processor processed, and the reporter that
 *              tells an operator, once, when the guard dropped a span. A span carries a
 *              query in `url.full`, `url.query`, `url.path` or `http.target`, and an OAuth callback's
 *              query carries the authorization code and the state that redeem it; an exported span is
 *              read by whoever reads the tracing backend, so these values must never reach it.
 * @layer infrastructure
 */
import { diag, type AttributeValue, type Attributes, type Context } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { tracing } from "@opentelemetry/sdk-node";

/** The value written in place of a sensitive one: the form `@opentelemetry/instrumentation-http` writes. */
export const REDACTED_QUERY_VALUE = "REDACTED";

/**
 * The query parameter names whose values telemetry never exports. A name matches exactly, as a
 * whole name, after the percent and `+` decoding a query parser applies. To add a name, add it here
 * with the place in this product that receives or sends it in a query string, or hands it out in a
 * link; every channel reads this list, so nothing else needs to change.
 */
export const SENSITIVE_QUERY_PARAMETERS = [
  // An OAuth authorization code: the provider and OIDC callbacks receive it
  // (`apps/api/src/auth/providerOAuthFlow.ts`, `apps/api/src/auth/oidcRoutes.ts`), and the Facebook
  // token exchange of `apps/api/src/auth/providerOAuthConfigs.ts` sends it.
  "code",
  // The OAuth state that binds a callback to the flow that started it; the same callbacks receive it.
  "state",
  // A provider access token: the Graph API clients send it in the query
  // (`packages/providers/{facebook,instagram,threads}`, `apps/api/src/auth/providerOAuthConfigs.ts`).
  "access_token",
  // The seven names `@opentelemetry/instrumentation-http` redacts by default, kept so that handing it
  // this list as its own option replaces none of them: signed cloud storage and AWS request URLs.
  "sig",
  "Signature",
  "AWSAccessKeyId",
  "X-Goog-Signature",
  "X-Amz-Signature",
  "X-Amz-Credential",
  "X-Amz-Security-Token",
  // The Facebook app secret: the token exchanges of `packages/providers/facebook/src/apiClient.ts`
  // and `apps/api/src/auth/providerOAuthConfigs.ts` send it in the query.
  "client_secret",
  // A short-lived Facebook user token, exchanged for a long-lived one in
  // `packages/providers/facebook/src/apiClient.ts`.
  "fb_exchange_token",
  // The page access token sent to Facebook's `debug_token` in `packages/providers/facebook/src/apiClient.ts`.
  "input_token",
  // The GA4 Measurement Protocol secret, sent by `apps/api/src/infrastructure/adapters/GA4TrackingAdapter.ts`.
  "api_secret",
  // A Google API key: the Gemini connection test of `packages/core/settings/src/SettingsService.ts`
  // sends it through `fetch`.
  "key",
  // Handed out in a link, not a request this product traces today: a password-reset token
  // (`apps/api/src/admin/adminUserRoutes.ts`, `apps/api/src/admin/auth/adminAuthRoutes.ts`,
  // `packages/core/customer-auth/src/RequestPasswordResetUseCase.ts`), a team invitation token
  // (`packages/core/team/src/InviteTeamMemberUseCase.ts`) and a Paddle customer-portal token
  // (`apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts`).
  "token",
  // Handed out in a link, not a request this product traces today: the Paddle checkout token
  // (`apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts`).
  "customer_token",
] as const;

const SENSITIVE_NAMES: ReadonlySet<string> = new Set(SENSITIVE_QUERY_PARAMETERS);

/**
 * Attributes that hold a query without the rest of its URL. The HTTP instrumentation writes
 * `url.query` without its `?` and the undici instrumentation with it; Sentry writes `http.query`
 * without it.
 */
const QUERY_ONLY_ATTRIBUTES: ReadonlySet<string> = new Set(["url.query", "http.query"]);

/**
 * One `name=value` parameter that follows a `?`, an `&` or a `#`: the delimiter, the name and the
 * value. The value ends at the next delimiter or at white space, so each URL of a free-text string,
 * such as an error message, is read on its own; `#` counts as a delimiter because an OAuth
 * implicit-grant redirect carries its token in the fragment.
 */
const PARAMETER = /([?&#])([^=&#?\s]+)=([^&#?\s]*)/g;

/**
 * Reads a parameter name the way a query parser does: `+` is a space, then percent escapes are
 * decoded. A name whose escapes do not decode is compared as written.
 */
const decodeParameterName = (name: string): string => {
  const spaced = name.replaceAll("+", " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
};

/**
 * @description Replaces the value of every sensitive query parameter a string holds with
 *              `REDACTED` and keeps its name, as written. A parameter is a `name=value` pair after a
 *              `?`, an `&` or a `#`; every other parameter and the rest of the URL stay exactly as
 *              written, encoding included. A value runs to the next `&`, `#`, `?` or white space, so
 *              punctuation attached after a sensitive value in free text, such as a closing
 *              parenthesis or quote, is replaced with it: an over-redaction, never a leak. A string
 *              with no such parameter comes back unchanged, and no input makes it throw.
 * @param value - Any string: a URL, a path, a query with its `?`, a span name or a message
 * @returns The string with every sensitive value replaced
 */
export function redactSensitiveQueryParameters(value: string): string {
  return value.replace(PARAMETER, (parameter, delimiter: string, name: string) =>
    SENSITIVE_NAMES.has(decodeParameterName(name))
      ? `${delimiter}${name}=${REDACTED_QUERY_VALUE}`
      : parameter
  );
}

/** Redacts one string attribute: an attribute that holds a query alone is read as one. */
const redactStringAttribute = (key: string, value: string): string =>
  QUERY_ONLY_ATTRIBUTES.has(key) && !value.startsWith("?")
    ? redactSensitiveQueryParameters(`?${value}`).slice(1)
    : redactSensitiveQueryParameters(value);

/** Whether an attribute value is an array whose items are strings or empty. */
const isStringArray = (value: AttributeValue): value is (string | null | undefined)[] =>
  Array.isArray(value) &&
  value.every((item) => item === null || item === undefined || typeof item === "string");

/**
 * @description Redacts one attribute value of a span: a string, or each string of a string array.
 *              `url.query` and `http.query` are read as a query even without their leading `?`.
 *              Numbers and booleans, and a value with nothing to redact, come back as the very value
 *              given, so a caller can tell a change by identity.
 * @param key - The attribute's key
 * @param value - The attribute's value
 * @returns The value with every sensitive query value replaced
 */
export function redactSensitiveQueryAttribute(key: string, value: AttributeValue): AttributeValue {
  if (typeof value === "string") return redactStringAttribute(key, value);
  if (!isStringArray(value)) return value;
  const redacted = value.map((item) =>
    typeof item === "string" ? redactStringAttribute(key, item) : item
  );
  return redacted.some((item, index) => item !== value[index]) ? redacted : value;
}

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
 * `RedactionGuardedSpanExporter` can refuse a span it never saw. Span links are not rewritten: no
 * instrumentation of the set-up sets link attributes.
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
      event.name = redactSensitiveQueryParameters(event.name);
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
      "and not exported, because the SDK did not call the span processor hook onEnding. Later " +
      "drops are not reported.";
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
  export(spans: tracing.ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const redacted = spans.filter((span) => this.redaction.hasRedacted(span));
    if (redacted.length < spans.length) this.reportDropped(spans.length - redacted.length);
    if (redacted.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
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
