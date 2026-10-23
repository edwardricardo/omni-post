/**
 * @file providerSpanAttributes.ts
 * @description Recognises the social provider an outgoing HTTP request talks to from the host it
 *              is addressed to, and sets the provider's span attributes on the request's span. A
 *              host is recognised only when it equals, case-insensitively and without its port, a
 *              host name of an explicit map: a substring test on a URL accepts any host that merely
 *              contains the provider's name, such as `api.twitter.com.evil.example`. An incoming
 *              request is never tagged: its `Host` header is chosen by the client, so an attribute
 *              read from it would be a label the caller writes on our own server span.
 * @layer infrastructure
 */

/** The span attributes that name the social provider an HTTP request talks to. */
export type ProviderSpanAttributes = {
  readonly "social.provider": string;
  readonly "social.api.version": string;
};

/** The parts of an outgoing `http.ClientRequest` that name the host it is addressed to. */
export interface OutgoingRequestDestination {
  readonly host?: unknown;
  readonly getHeader?: (name: string) => unknown;
}

/** An incoming `http.IncomingMessage`. Its headers are never read for a provider host. */
export interface IncomingRequest {
  readonly headers: unknown;
}

/** The request the HTTP instrumentation hands its request hook: outgoing or incoming. */
export type InstrumentedHttpRequest = OutgoingRequestDestination | IncomingRequest;

/** The part of a span the provider attributes are written through. */
export interface ProviderAttributeSpan {
  setAttributes(attributes: ProviderSpanAttributes): unknown;
}

const X_API_ATTRIBUTES: ProviderSpanAttributes = Object.freeze({
  "social.provider": "x",
  "social.api.version": "2",
});

const FACEBOOK_GRAPH_API_ATTRIBUTES: ProviderSpanAttributes = Object.freeze({
  "social.provider": "instagram",
  "social.api.version": "v18.0",
});

// Keys are lower-case host names without a port, the form `providerSpanAttributes` reduces a host to.
const PROVIDER_SPAN_ATTRIBUTES_BY_HOST_NAME: ReadonlyMap<string, ProviderSpanAttributes> = new Map([
  ["api.twitter.com", X_API_ATTRIBUTES],
  ["api.x.com", X_API_ATTRIBUTES],
  ["graph.facebook.com", FACEBOOK_GRAPH_API_ATTRIBUTES],
]);

// A host name followed by an optional numeric port, and nothing else: a value with anything but a
// port after its colon, such as `api.x.com:443@evil.example`, stays whole and equals no key.
const HOST_NAME_WITH_OPTIONAL_PORT = /^([^:]+)(?::\d{1,5})?$/;

/**
 * @description Returns the span attributes of the social provider whose API is served at `host`.
 *              The host is lower-cased and its port dropped, then compared by equality with the
 *              known provider host names.
 * @param host - The host an outgoing request is addressed to, as `ClientRequest.host` or the
 *               request's `Host` header holds it
 * @returns The provider's span attributes, or `undefined` when `host` is no known provider host
 */
export function providerSpanAttributes(host: string): ProviderSpanAttributes | undefined {
  const hostName = HOST_NAME_WITH_OPTIONAL_PORT.exec(host.toLowerCase())?.[1];
  return hostName === undefined ? undefined : PROVIDER_SPAN_ATTRIBUTES_BY_HOST_NAME.get(hostName);
}

/**
 * @description Returns the host an outgoing HTTP request is addressed to: its `host`, or its `Host`
 *              header when `host` is not a string. An incoming request yields no host, because the
 *              client chooses its `Host` header.
 * @param request - The outgoing or incoming request
 * @returns The host, possibly with a port, or `undefined` for an incoming request or an outgoing
 *          one that names no host
 */
export function requestHost(request: InstrumentedHttpRequest): string | undefined {
  if ("host" in request && typeof request.host === "string") {
    return request.host;
  }
  if ("getHeader" in request && typeof request.getHeader === "function") {
    const header = request.getHeader("host");
    return typeof header === "string" ? header : undefined;
  }
  return undefined;
}

/**
 * @description Sets the social provider's span attributes on the span of an outgoing request
 *              addressed to a known provider host, and leaves the span untouched for any other host
 *              and for every incoming request.
 * @param span - The request's span
 * @param request - The outgoing or incoming request
 */
export function tagProviderSpan(
  span: ProviderAttributeSpan,
  request: InstrumentedHttpRequest
): void {
  const host = requestHost(request);
  const attributes = host === undefined ? undefined : providerSpanAttributes(host);
  if (attributes !== undefined) {
    span.setAttributes(attributes);
  }
}
