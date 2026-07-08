/**
 * @file forwardedFor.test.ts
 * @description Unit tests for the admin portal's inbound→outbound client-IP
 *              relay helper. Verifies it copies `x-forwarded-for` when present,
 *              falls back to `x-real-ip`, returns `{}` when neither is present
 *              (no regression), and never rewrites the relayed value (RELAY,
 *              not append — the backend's trusted-hop selection stays intact).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { forwardedForHeaders } from "./forwardedFor";

describe("forwardedForHeaders", () => {
  it("relays x-forwarded-for verbatim when present", () => {
    const inbound = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });

    expect(forwardedForHeaders(inbound)).toEqual({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const inbound = new Headers({ "x-real-ip": "198.51.100.42" });

    expect(forwardedForHeaders(inbound)).toEqual({
      "x-real-ip": "198.51.100.42",
    });
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const inbound = new Headers({
      "x-forwarded-for": "203.0.113.7",
      "x-real-ip": "198.51.100.42",
    });

    expect(forwardedForHeaders(inbound)).toEqual({
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("returns an empty object when neither header is present (no regression)", () => {
    const inbound = new Headers({ "content-type": "application/json" });

    expect(forwardedForHeaders(inbound)).toEqual({});
  });

  it("does not trust, trim, or rewrite the chain beyond copying it (spoofable leftmost preserved for the backend to ignore)", () => {
    // RELAY, not append: the exact inbound chain is copied so the backend
    // selects the trusted hop at len - TRUSTED_PROXY_HOP_COUNT unchanged. The
    // spoofable leftmost entry is preserved on the wire precisely because the
    // backend — not this helper — is responsible for ignoring it.
    const inbound = new Headers({
      "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.42",
    });

    expect(forwardedForHeaders(inbound)).toEqual({
      "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.42",
    });
  });
});
