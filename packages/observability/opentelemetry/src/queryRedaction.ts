/**
 * @file queryRedaction.ts
 * @description The pure half of the telemetry query redaction: the list of the sensitive query
 *              parameter names, the function that replaces their values in any string, and its
 *              variant for one attribute value. It imports no OpenTelemetry package at run time, so
 *              the API's Sentry initializer can use it at boot with tracing off; the span processor,
 *              the exporter guard and the reporter that apply it to spans live in
 *              `spanQueryRedaction.ts`. A span carries a query in `url.full`, `url.query`,
 *              `url.path` or `http.target`, and an OAuth callback's query carries the authorization
 *              code and the state that redeem it; an exported span is read by whoever reads the
 *              tracing backend, so these values must never reach it.
 * @layer infrastructure
 */
import type { AttributeValue } from "@opentelemetry/api";

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
