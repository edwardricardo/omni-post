/**
 * @file refreshTokenHash.test.ts
 * @description Verifies the SHA-256 hashing helper for AdminSession.refreshTokenHash.
 *   The hash must be deterministic (same input → same output, enabling DB lookup),
 *   irreversible (can't recover the JWT from the digest), and 64-char hex.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { hashRefreshToken } from "../../../src/auth/refreshTokenHash.js";

describe("hashRefreshToken", () => {
  it("returns a 64-character hex string (SHA-256 digest)", () => {
    const hash = hashRefreshToken("any-jwt-string");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always produces the same hash", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashRefreshToken("token-a")).not.toBe(hashRefreshToken("token-b"));
  });

  it("is sensitive to single-character changes (avalanche effect)", () => {
    const a = hashRefreshToken("eyJhbGciOiJIUzI1NiJ9.payload.signature");
    const b = hashRefreshToken("eyJhbGciOiJIUzI1NiJ9.payload.Signature"); // capital S
    expect(a).not.toBe(b);
  });

  it("matches a known SHA-256 vector (test fixture, NOT a real secret)", () => {
    // Sanity check: the well-known SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.
    expect(hashRefreshToken("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("handles empty string input without throwing", () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hashRefreshToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});
