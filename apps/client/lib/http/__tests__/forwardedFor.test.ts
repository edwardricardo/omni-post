/**
 * @file forwardedFor.test.ts
 * @description Unit tests for the client-portal client-IP relay helper. Verifies
 *              verbatim relay of the inbound X-Forwarded-For chain (no appended
 *              portal hop), the X-Real-IP fallback, XFF precedence, and the empty
 *              result when neither header is present.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { forwardedForHeaders } from "../forwardedFor";

describe("forwardedForHeaders (client)", () => {
  it("relays the inbound X-Forwarded-For chain verbatim (no added entry)", () => {
    const inbound = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(forwardedForHeaders(inbound)).toEqual({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
  });

  it("falls back to X-Real-IP when no X-Forwarded-For is present", () => {
    const inbound = new Headers({ "x-real-ip": "9.9.9.9" });
    expect(forwardedForHeaders(inbound)).toEqual({ "x-real-ip": "9.9.9.9" });
  });

  it("prefers X-Forwarded-For over X-Real-IP when both are present", () => {
    const inbound = new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" });
    expect(forwardedForHeaders(inbound)).toEqual({ "x-forwarded-for": "1.2.3.4" });
  });

  it("returns an empty object when neither header is present", () => {
    expect(forwardedForHeaders(new Headers())).toEqual({});
  });

  it("treats an empty header value as absent", () => {
    const inbound = new Headers({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" });
    expect(forwardedForHeaders(inbound)).toEqual({ "x-real-ip": "9.9.9.9" });
  });
});
