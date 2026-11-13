/**
 * @file queryRedaction.ts
 * @description The one place where telemetry redacts the values of sensitive URL query parameters:
 *              the list of their names, the function that replaces their values in any string, its
 *              variant for one attribute value, and the span processor that applies it to every span
 *              the telemetry set-up ends, before any exporter receives the span. A span carries a
 *              query in `url.full`, `url.query`, `url.path` or `http.target`, and an OAuth callback's
 *              query carries the authorization code and the state that redeem it; an exported span is
 *              read by whoever reads the tracing backend, so these values must never reach it.
 * @layer infrastructure
 */
import type { AttributeValue, Context } from "@opentelemetry/api";
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
  // Handed out in a link, not a request this product traces today: a password-reset token
  // (`apps/api/src/admin/adminUserRoutes.ts`, `apps/api/src/admin/auth/adminAuthRoutes.ts`) and a
  // Paddle customer-portal token (`apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts`).
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
 *              `?`, an `&` or a `#`; every other parameter, the rest of the URL and any text around
 *              it stay exactly as written, encoding included. A string with no such parameter comes
 *              back unchanged, and no input makes it throw.
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

/**
 * Redacts sensitive query values on every span while it is ending, before the span becomes
 * read-only and before any processor hands it to an exporter: its attributes, its name and its
 * status message. Registered with the other span processors of a tracer provider, it covers every
 * exporter of that provider and every instrumentation, including one added later. Event attributes
 * are not rewritten: a span exposes no method that changes an event once it was added.
 */
export class QueryParameterRedactionSpanProcessor implements tracing.SpanProcessor {
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
   * @description Replaces every sensitive query value of the ending span's attributes, name and
   *              status message. The SDK calls it on every processor before it marks the span ended,
   *              so the span's own setters still apply, and before any processor's `onEnd`.
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
