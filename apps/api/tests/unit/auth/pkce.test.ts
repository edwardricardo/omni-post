/**
 * @file pkce.test.ts
 * @description Unit tests for the RFC 7636 PKCE helper: the Appendix-B S256
 *              reference vector, verifier length/charset bounds, and pair
 *              uniqueness.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import {
  createPkcePair,
  deriveCodeChallenge,
  PKCE_METHOD_S256,
} from "../../../src/auth/oauth/pkce.js";

describe("PKCE helper", () => {
  it("derives the RFC 7636 Appendix-B S256 reference challenge", () => {
    // RFC 7636 §Appendix B canonical vector.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = deriveCodeChallenge(verifier);
    assert.strictEqual(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("produces an S256 pair whose challenge matches the verifier", () => {
    const pair = createPkcePair();
    assert.strictEqual(pair.codeChallengeMethod, PKCE_METHOD_S256);
    assert.strictEqual(pair.codeChallenge, deriveCodeChallenge(pair.codeVerifier));
  });

  it("emits a verifier within the RFC length and character bounds", () => {
    const { codeVerifier } = createPkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    // Unreserved subset actually emitted by base64url.
    assert.match(codeVerifier, /^[A-Za-z0-9\-_]+$/);
  });

  it("generates a unique verifier per call", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    assert.notStrictEqual(a.codeVerifier, b.codeVerifier);
    assert.notStrictEqual(a.codeChallenge, b.codeChallenge);
  });
});
