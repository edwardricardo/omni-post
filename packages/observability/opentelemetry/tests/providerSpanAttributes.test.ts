/**
 * @file providerSpanAttributes.test.ts
 * @description Pins how the HTTP instrumentation's request hook recognises a social provider: by
 *              equality of an outgoing request's host name with a known provider host,
 *              case-insensitive and without the port, never by a substring of the URL, and never
 *              from an incoming request, whose `Host` header the client chooses. Covers the host
 *              resolution, the host derivation from an outgoing and an incoming request, and the
 *              hook itself with a plain request object and a span double.
 * @layer infrastructure
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  providerSpanAttributes,
  requestHost,
  tagProviderSpan,
  type ProviderSpanAttributes,
} from "../src/providerSpanAttributes.js";

const X_ATTRIBUTES: ProviderSpanAttributes = {
  "social.provider": "x",
  "social.api.version": "2",
};

const FACEBOOK_GRAPH_ATTRIBUTES: ProviderSpanAttributes = {
  "social.provider": "instagram",
  "social.api.version": "v18.0",
};

const makeSpan = () => ({ setAttributes: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("providerSpanAttributes", () => {
  it.each([
    ["api.twitter.com", X_ATTRIBUTES],
    ["api.x.com", X_ATTRIBUTES],
    ["graph.facebook.com", FACEBOOK_GRAPH_ATTRIBUTES],
  ])("returns the provider attributes when the host is %s", (host, expected) => {
    const attributes = providerSpanAttributes(host);

    expect(attributes).toEqual(expected);
  });

  it("returns the provider attributes when the host differs from a provider host only in case", () => {
    const attributes = providerSpanAttributes("API.Twitter.COM");

    expect(attributes).toEqual(X_ATTRIBUTES);
  });

  it("returns the provider attributes when the host carries a port", () => {
    const attributes = providerSpanAttributes("api.x.com:443");

    expect(attributes).toEqual(X_ATTRIBUTES);
  });

  it.each([
    ["a provider host followed by another domain", "api.twitter.com.evil.example"],
    ["a provider host in the path of another host", "evil.example/api.twitter.com"],
    ["a provider host behind a prefix", "evil-api.x.com"],
    [
      "a provider host followed by a non-numeric suffix after its colon",
      "api.x.com:443@evil.example",
    ],
    ["an unrelated host", "example.com"],
    ["an empty host", ""],
  ])("returns undefined when the host is %s", (_case, host) => {
    const attributes = providerSpanAttributes(host);

    expect(attributes).toBeUndefined();
  });
});

describe("requestHost", () => {
  it("returns the host of an outgoing request when it is a string", () => {
    const request = { host: "api.x.com", getHeader: vi.fn(() => "example.com") };

    const host = requestHost(request);

    expect(host).toBe("api.x.com");
  });

  it("returns the Host header of an outgoing request when its host is not a string", () => {
    const request = { host: undefined, getHeader: vi.fn(() => "api.twitter.com:443") };

    const host = requestHost(request);

    expect(host).toBe("api.twitter.com:443");
  });

  it("returns undefined when an incoming request's Host header names a provider host", () => {
    const request = { headers: { host: "api.twitter.com" } };

    const host = requestHost(request);

    expect(host).toBeUndefined();
  });

  it("returns undefined when an outgoing request names no host", () => {
    const request = { getHeader: vi.fn(() => undefined) };

    const host = requestHost(request);

    expect(host).toBeUndefined();
  });
});

describe("tagProviderSpan", () => {
  it("sets the provider attributes when an outgoing request's host is a provider host", () => {
    const span = makeSpan();
    const request = { host: "api.twitter.com", getHeader: vi.fn(() => undefined) };

    tagProviderSpan(span, request);

    expect(span.setAttributes).toHaveBeenCalledExactlyOnceWith(X_ATTRIBUTES);
  });

  it("sets the provider attributes when an outgoing request's Host header is a provider host", () => {
    const span = makeSpan();
    const request = { getHeader: vi.fn(() => "API.X.COM:443") };

    tagProviderSpan(span, request);

    expect(span.setAttributes).toHaveBeenCalledExactlyOnceWith(X_ATTRIBUTES);
  });

  it("leaves the span untouched when an incoming request's Host header names a provider host", () => {
    const span = makeSpan();
    const request = { headers: { host: "api.twitter.com" } };

    tagProviderSpan(span, request);

    expect(span.setAttributes).not.toHaveBeenCalled();
  });

  it("leaves the span untouched when the host only starts with a provider host", () => {
    const span = makeSpan();
    const request = { host: "api.twitter.com.evil.example" };

    tagProviderSpan(span, request);

    expect(span.setAttributes).not.toHaveBeenCalled();
  });

  it("leaves the span untouched when only the path names a provider host", () => {
    const span = makeSpan();
    const request = { host: "evil.example", path: "/api.twitter.com/2/tweets" };

    tagProviderSpan(span, request);

    expect(span.setAttributes).not.toHaveBeenCalled();
  });
});
