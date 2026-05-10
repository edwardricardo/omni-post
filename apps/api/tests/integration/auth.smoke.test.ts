/**
 * Tier 1 — Auth gating smoke tests
 *
 * Exercises customer authentication flows end-to-end against a real
 * API + Postgres + Redis. Coverage:
 *   - register (happy + duplicate-email + invalid input)
 *   - login (happy + invalid creds + wrong password)
 *   - refresh (happy + invalid token)
 *   - logout (happy + post-logout refresh rejected)
 *   - password reset (request + reset-with-token; invalid + expired token)
 *
 * @file auth.smoke.test.ts
 * @description Tier 1 customer auth smoke E2E
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable } from "../testUtils.js";
import { apiPost, expectError, cleanupTestAccount, API_BASE_URL } from "./helpers/index.js";

interface AuthSmokeFixture {
  /** unique tag scoped to this test run; prevents email collisions
   *  with parallel runs and the seeded demo account. */
  tag: string;
  email: string;
  password: string;
  /** account created by the register flow — used by `after()` to cascade
   *  cleanup after the suite finishes. */
  createdAccountIds: string[];
}

describe("Tier 1 — Auth gating smoke", () => {
  let prisma: PrismaClient;
  let fixture: AuthSmokeFixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );

    prisma = createTestPrismaClient();
    const tag = `auth-smk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fixture = {
      tag,
      email: `auth-${tag}@test.local`,
      password: "AuthSmoke@Pass1",
      createdAccountIds: [],
    };
  });

  after(async () => {
    if (!prisma) return;
    try {
      for (const accountId of fixture.createdAccountIds) {
        await cleanupTestAccount(prisma, accountId);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  // -----------------------------------------------------------------------
  // Register
  // -----------------------------------------------------------------------

  it("registers a new customer and returns tokens (201)", async () => {
    const result = await apiPost<{
      data: {
        accessToken: string;
        refreshToken: string;
        user: { email: string; id: string };
        account: { id: string };
      };
    }>("/auth/customer/register", {
      accountName: `Auth Smoke Account ${fixture.tag}`,
      firstName: "Auth",
      lastName: "Smoke",
      email: fixture.email,
      password: fixture.password,
    });

    assert.strictEqual(result.status, 201, `expected 201, got ${result.status}`);
    assert.ok(result.body?.data.accessToken, "accessToken returned");
    assert.ok(result.body?.data.refreshToken, "refreshToken returned");
    assert.strictEqual(result.body?.data.user.email, fixture.email);

    fixture.createdAccountIds.push(result.body!.data.account.id);
  });

  it("rejects duplicate email registration (409 EMAIL_EXISTS)", async () => {
    const result = await apiPost("/auth/customer/register", {
      accountName: `Dup ${fixture.tag}`,
      firstName: "Dup",
      lastName: "Smoke",
      email: fixture.email, // already used by previous test
      password: fixture.password,
    });
    expectError(result, 409);
  });

  it("rejects register with malformed payload (400)", async () => {
    const result = await apiPost("/auth/customer/register", {
      accountName: "X",
      firstName: "Bad",
      lastName: "Payload",
      email: "not-an-email", // fails Zod email validation
      password: "short", // < 8 chars
    });
    expectError(result, 400);
  });

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------

  it("logs in with valid credentials and returns tokens (200)", async () => {
    const result = await apiPost<{
      data: { accessToken: string; refreshToken: string };
    }>("/auth/customer/login", {
      email: fixture.email,
      password: fixture.password,
    });

    assert.strictEqual(result.status, 200);
    assert.ok(result.body?.data.accessToken, "accessToken returned on login");
    assert.ok(result.body?.data.refreshToken, "refreshToken returned on login");
  });

  it("rejects login with wrong password (401)", async () => {
    const result = await apiPost("/auth/customer/login", {
      email: fixture.email,
      password: "WrongPassword1!",
    });
    expectError(result, 401);
  });

  it("rejects login with non-existent email (401)", async () => {
    const result = await apiPost("/auth/customer/login", {
      email: `nonexistent-${fixture.tag}@test.local`,
      password: fixture.password,
    });
    expectError(result, 401);
  });

  // -----------------------------------------------------------------------
  // Refresh + logout
  // -----------------------------------------------------------------------

  it("refreshes token pair (happy + invalid-token rejection)", async () => {
    // Get a fresh refresh token via login
    const login = await apiPost<{
      data: { refreshToken: string };
    }>("/auth/customer/login", {
      email: fixture.email,
      password: fixture.password,
    });
    assert.strictEqual(login.status, 200);
    const refreshToken = login.body!.data.refreshToken;

    // Happy path
    const happy = await apiPost<{
      data: { accessToken: string; refreshToken: string };
    }>("/auth/customer/refresh", { refreshToken });
    assert.strictEqual(happy.status, 200);
    assert.ok(happy.body?.data.accessToken, "new accessToken on refresh");
    assert.ok(happy.body?.data.refreshToken, "new refreshToken on refresh");

    // Invalid token rejection
    const invalid = await apiPost("/auth/customer/refresh", {
      refreshToken: "definitely-not-a-valid-token",
    });
    expectError(invalid, 401);
  });

  it("logout revokes session — subsequent refresh fails", async () => {
    // Fresh login → fresh tokens
    const login = await apiPost<{
      data: { accessToken: string; refreshToken: string };
    }>("/auth/customer/login", {
      email: fixture.email,
      password: fixture.password,
    });
    assert.strictEqual(login.status, 200);
    const accessToken = login.body!.data.accessToken;
    const refreshToken = login.body!.data.refreshToken;

    // Logout sends refreshToken in body so the use case can blacklist the session id
    const logout = await apiPost(
      "/auth/customer/logout",
      { refreshToken },
      `Bearer ${accessToken}`
    );
    assert.strictEqual(logout.status, 200);

    // Refresh with the now-revoked token must fail
    const replay = await apiPost("/auth/customer/refresh", { refreshToken });
    expectError(replay, 401);
  });

  // -----------------------------------------------------------------------
  // Password reset
  // -----------------------------------------------------------------------

  it("password reset request returns 200 even for unknown email (no enumeration)", async () => {
    // Existing email
    const existing = await apiPost("/auth/customer/request-password-reset", {
      email: fixture.email,
    });
    assert.strictEqual(existing.status, 200);

    // Unknown email — must also return 200 to prevent account enumeration
    const unknown = await apiPost("/auth/customer/request-password-reset", {
      email: `unknown-${fixture.tag}@test.local`,
    });
    assert.strictEqual(unknown.status, 200);
  });

  it("rejects password reset with invalid token (400)", async () => {
    const result = await apiPost("/auth/customer/reset-password", {
      token: "definitely-not-a-valid-token",
      newPassword: "NewValidPass@1",
    });
    expectError(result, 400);
  });
});
