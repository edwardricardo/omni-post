/**
 * @file customerJwt.test.ts
 * @description Unit tests for the customer JWT helpers, focused on the 4th token
 *   kind (the login MFA challenge) and token-kind confusion in BOTH directions:
 *   a challenge token must never pass an access/refresh verifier, and an
 *   access/refresh token must never pass the challenge verifier. Rejection is
 *   layered: a DEDICATED audience (`omnipost-customer-mfa`) fails cryptographically
 *   before the payload `type` check even runs.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import {
  signCustomerAccessToken,
  verifyCustomerToken,
  signCustomerRefreshToken,
  verifyCustomerRefreshToken,
  signCustomerMfaChallengeToken,
  verifyCustomerMfaChallengeToken,
} from "../../src/auth/customerJwt.js";

const CLAIMS = {
  sub: "cust-001",
  accountId: "acc-001",
  jti: "0123456789abcdef0123456789abcdef",
  iph: "a".repeat(64),
  uah: "b".repeat(64),
};

function makeAccessToken(): string {
  return signCustomerAccessToken({
    sub: "cust-001",
    accountId: "acc-001",
    roleId: "role-owner",
    roleName: "OWNER",
    permissions: ["post:read"],
  });
}

describe("customer MFA challenge JWT", () => {
  it("round-trips claims and pins the challenge type", () => {
    const token = signCustomerMfaChallengeToken(CLAIMS);
    const decoded = verifyCustomerMfaChallengeToken(token);

    expect(decoded.type).toBe("customer-mfa-challenge");
    assert.strictEqual(decoded.sub, CLAIMS.sub);
    assert.strictEqual(decoded.accountId, CLAIMS.accountId);
    assert.strictEqual(decoded.jti, CLAIMS.jti);
    assert.strictEqual(decoded.iph, CLAIMS.iph);
    assert.strictEqual(decoded.uah, CLAIMS.uah);
  });

  describe("token-kind confusion — challenge verifier rejects other kinds", () => {
    it("rejects a customer ACCESS token (audience + type mismatch)", () => {
      const access = makeAccessToken();
      assert.throws(() => verifyCustomerMfaChallengeToken(access));
    });

    it("rejects a customer REFRESH token (missing challenge audience)", () => {
      const refresh = signCustomerRefreshToken("cust-001", "session-1");
      assert.throws(() => verifyCustomerMfaChallengeToken(refresh));
    });
  });

  describe("token-kind confusion — access/refresh verifiers reject the challenge", () => {
    it("verifyCustomerToken rejects a challenge token", () => {
      const challenge = signCustomerMfaChallengeToken(CLAIMS);
      assert.throws(() => verifyCustomerToken(challenge));
    });

    it("verifyCustomerRefreshToken rejects a challenge token", () => {
      const challenge = signCustomerMfaChallengeToken(CLAIMS);
      assert.throws(() => verifyCustomerRefreshToken(challenge));
    });
  });
});
