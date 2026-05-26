/**
 * @file CustomerTokenServiceAdapter.test.ts
 * @description Tests the customer token-service adapter: sign→verify round-trip,
 *              typed failure on garbage, decode-without-verify, and the RFC 8725
 *              algorithm-pin (tokens signed with a non-HS256 algorithm or "none"
 *              are rejected even when the shared secret is correct).
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { CustomerTokenServiceAdapter } from "../../../../src/infrastructure/adapters/CustomerTokenServiceAdapter.js";
import { env } from "../../../../src/config/env.js";

describe("CustomerTokenServiceAdapter", () => {
  const adapter = new CustomerTokenServiceAdapter();

  it("verifies a refresh token it signed (round-trip)", () => {
    const token = adapter.signRefreshToken("user-1", "session-1");
    const result = adapter.verifyRefreshToken(token);

    assert.ok(result.ok, "Expected a valid refresh token to verify");
    assert.strictEqual(result.value.sub, "user-1");
    assert.strictEqual(result.value.sessionId, "session-1");
  });

  it("returns INVALID_TOKEN for a garbage refresh token", () => {
    const result = adapter.verifyRefreshToken("not-a-jwt");

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_TOKEN");
  });

  it("decodes a valid refresh token without verifying", () => {
    const token = adapter.signRefreshToken("user-2", "session-2");
    const claims = adapter.decodeRefreshToken(token);

    assert.ok(claims !== null);
    assert.strictEqual(claims.sub, "user-2");
    assert.strictEqual(claims.sessionId, "session-2");
  });

  it("returns null when decoding a garbage refresh token", () => {
    assert.strictEqual(adapter.decodeRefreshToken("not-a-jwt"), null);
  });

  it("rejects a refresh token signed with a non-HS256 algorithm (RFC 8725)", () => {
    // Correct shared secret + valid type, but HS512 instead of the pinned HS256.
    const forged = jwt.sign(
      { sub: "attacker", sessionId: "s", type: "customer-refresh" },
      env.CUSTOMER_JWT_SECRET,
      { algorithm: "HS512" }
    );

    const result = adapter.verifyRefreshToken(forged);

    assert.ok(!result.ok, "Algorithm-confused token must be rejected");
    assert.strictEqual(result.error, "INVALID_TOKEN");
  });

  it('rejects a refresh token with alg:"none" (RFC 8725)', () => {
    const forged = jwt.sign({ sub: "attacker", sessionId: "s", type: "customer-refresh" }, "", {
      algorithm: "none",
    });

    const result = adapter.verifyRefreshToken(forged);

    assert.ok(!result.ok, 'alg:"none" token must be rejected');
    assert.strictEqual(result.error, "INVALID_TOKEN");
  });
});
