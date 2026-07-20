/**
 * @file customerLoginMfaE2e.integration.test.ts
 * @description End-to-end integration test for the two-step customer login MFA
 *              flow, driven over REAL HTTP against a live API booted from the
 *              production composition root. Unlike the route-level unit tests
 *              (which STUB every use case) and the challenge-store test (Redis
 *              only), this is the ONLY layer that exercises the real DI wiring,
 *              real challenge-token sign/verify (dedicated audience + single-use
 *              jti), and the real `MfaVerificationPort` end to end — so a wiring
 *              regression (wrong ctor arg order, a missing
 *              `TOKENS.MfaChallengeStore` registration, a JWT audience mismatch
 *              between sign and verify) fails HERE instead of passing a suite of
 *              green stubs. Cycle covered:
 *                1. seed a customer with a KNOWN password + enroll MFA via
 *                   `/auth/mfa/setup` + `/auth/mfa/verify-setup` (real TOTP)
 *                2. `POST /auth/customer/login` (password) → `mfaRequired` +
 *                   challenge token, NO session leaked
 *                3. `POST /auth/customer/login/mfa` (challenge + fresh TOTP) →
 *                   real access + refresh tokens
 *                4. replay the SAME challenge → 401 (jti single-use)
 *                5. malformed + forged challenge tokens → 401
 *
 *              Rate limiting is ON (the boot command sets
 *              `ENABLE_RATE_LIMITING=true`): the AUTH preset caps
 *              `/auth/customer/login` at 5 / 15 min per `ip:url` bucket, and
 *              `/auth/customer/login/mfa` is a DISTINCT url → its own 5 / 15 min
 *              bucket. This suite issues 1 request to the login bucket and 4 to
 *              the login/mfa bucket (happy-path cycle folded into one test to
 *              avoid re-issuing challenges), staying under both caps with
 *              headroom. The API MUST be up on 3000; the suite fails loud if it
 *              is not, per repo canon.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";
import { hashPassword } from "../../src/auth/passwordHashing.js";

const API_URL = getBaseUrl();
// A single, stable user-agent — the challenge token binds `uah = sha256(UA)` at
// step 1, so step 2 MUST present the identical UA or the binding check rejects
// it. Sending it explicitly removes any dependence on the fetch default.
const USER_AGENT = "omnipost-mfa-e2e/1.0";
const KNOWN_PASSWORD = "Correct-Horse-Battery-9!";

interface Fixture {
  accountId: string;
  customerId: string;
  email: string;
  secret: string;
  backupCodes: string[];
}

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<JsonResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, ...headers },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => ({}));
  return { status: response.status, body: (parsed ?? {}) as Record<string, unknown> };
}

interface SetupResponseBody {
  data: { setup: { manualEntryKey: string; backupCodes: string[] } };
}

describe("Customer login MFA — full HTTP E2E (integration)", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — boot it with dev:test on port 3000 before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `mfa-login-e2e-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Customer Login MFA E2E Account" },
    });
    const email = `customer-${tag}@test.com`;
    const customer = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email,
        passwordHash: await hashPassword(KNOWN_PASSWORD),
        firstName: "Login",
        lastName: "Tester",
      },
    });

    // Enroll MFA through the real HTTP setup routes with a minted access token —
    // exactly how the client portal enrolls a customer.
    const authHeader = `Bearer ${signCustomerAccessToken({
      sub: customer.id,
      accountId: account.id,
      roleId: "role-e2e",
      roleName: "OWNER",
      permissions: [],
    })}`;
    const setup = await post("/auth/mfa/setup", {}, { Authorization: authHeader });
    assert.strictEqual(setup.status, 200, "MFA setup must succeed");
    const setupData = (setup.body as unknown as SetupResponseBody).data.setup;
    const verifySetup = await post(
      "/auth/mfa/verify-setup",
      { token: authenticator.generate(setupData.manualEntryKey) },
      { Authorization: authHeader }
    );
    assert.strictEqual(verifySetup.status, 200, "MFA verify-setup must enable MFA");

    fixture = {
      accountId: account.id,
      customerId: customer.id,
      email,
      secret: setupData.manualEntryKey,
      backupCodes: setupData.backupCodes,
    };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.auditLog.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.account.deleteMany({ where: { id: fixture.accountId } });
    await prisma.$disconnect();
  });

  it("completes the two-step login, then rejects a replay of the consumed challenge (jti single-use)", async () => {
    // Step 1 — password. An MFA-enabled customer gets a challenge, never a
    // session: no access token may leak before the second factor.
    const step1 = await post("/auth/customer/login", {
      email: fixture.email,
      password: KNOWN_PASSWORD,
    });
    assert.strictEqual(step1.status, 200, "password step returns 200 with a challenge");
    const step1Data = step1.body.data as Record<string, unknown>;
    assert.strictEqual(step1Data.mfaRequired, true, "MFA is required");
    assert.strictEqual(typeof step1Data.challengeToken, "string", "a challenge token is issued");
    assert.ok((step1Data.challengeToken as string).length > 0, "challenge token is non-empty");
    assert.strictEqual(step1Data.accessToken, undefined, "no access token leaks at step 1");
    assert.strictEqual(step1Data.refreshToken, undefined, "no refresh token leaks at step 1");
    const challengeToken = step1Data.challengeToken as string;

    // Step 2 — challenge + a fresh TOTP mints the real session. The first TOTP
    // claim always wins (verify-setup does not consume a step), so no window race.
    const step2 = await post("/auth/customer/login/mfa", {
      challengeToken,
      code: authenticator.generate(fixture.secret),
    });
    assert.strictEqual(step2.status, 200, "valid challenge + TOTP mints a session");
    const step2Data = step2.body.data as Record<string, unknown>;
    assert.strictEqual(typeof step2Data.accessToken, "string", "a real access token is minted");
    assert.ok((step2Data.accessToken as string).length > 0, "access token is non-empty");
    assert.strictEqual(typeof step2Data.refreshToken, "string", "a real refresh token is minted");
    assert.strictEqual(step2Data.mfaRequired, undefined, "the session body is not a challenge");

    // Step 2 replay — the challenge jti was consumed, so the SAME token cannot
    // mint a second session even with a still-valid (unused) backup code. The
    // code verifies, but the jti consume finds nothing → byte-identical 401.
    const replay = await post("/auth/customer/login/mfa", {
      challengeToken,
      code: fixture.backupCodes[0],
    });
    assert.strictEqual(replay.status, 401, "a consumed challenge cannot be replayed");
    assert.strictEqual(
      replay.body.code,
      "INVALID_CHALLENGE",
      "replay collapses to INVALID_CHALLENGE"
    );
  });

  it("rejects a malformed challenge token with a generic 401", async () => {
    const res = await post("/auth/customer/login/mfa", {
      challengeToken: "not-a-jwt-at-all",
      code: "123456",
    });
    assert.strictEqual(res.status, 401, "a malformed challenge is invalid");
    assert.strictEqual(res.body.code, "INVALID_CHALLENGE");
  });

  it("rejects a forged/expired challenge token with a generic 401", async () => {
    // A structurally-valid JWT with the right issuer/audience/type but signed by
    // the WRONG secret (stand-in for a forged or expired token). The algorithm is
    // pinned to HS256 — the SAME algorithm the real verifier accepts — so the
    // rejection is unambiguously a signature failure (wrong secret), never an
    // algorithm mismatch. Collapses to INVALID_CHALLENGE.
    const forged = jwt.sign(
      {
        sub: fixture.customerId,
        accountId: fixture.accountId,
        jti: "forged",
        iph: "x",
        uah: "y",
        type: "customer-mfa-challenge",
      },
      "not-the-real-customer-jwt-secret",
      {
        algorithm: "HS256",
        expiresIn: 180,
        issuer: "omnipost-customer",
        audience: "omnipost-customer-mfa",
      }
    );
    const res = await post("/auth/customer/login/mfa", { challengeToken: forged, code: "123456" });
    assert.strictEqual(res.status, 401, "a forged challenge is invalid");
    assert.strictEqual(res.body.code, "INVALID_CHALLENGE");
  });
});
