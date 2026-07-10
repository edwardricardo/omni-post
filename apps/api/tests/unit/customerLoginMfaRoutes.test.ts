/**
 * @file customerLoginMfaRoutes.test.ts
 * @description Route-level tests for customer login step 2 (`POST
 *   /auth/customer/login/mfa`) and the step-1 MFA branches. Drives the REAL
 *   Fastify handler + the REAL error contract (no mocked response body): asserts
 *   the top-level `code` string the portal discriminates on, the byte-identical
 *   anti-oracle 401, the fail-closed 503 + WARN, and that the trusted client IP
 *   (`resolveClientIp`) — never `request.ip` — feeds the use case.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const warn = vi.fn();
  const noopLogger = {
    info: noop,
    warn,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

const Fastify = (await import("fastify")).default;
const { customerAuthRoutes } = await import("../../src/auth/customerAuthRoutes.js");
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
const { authLogger } = await import("../../src/lib/logger.js");

// Mutable holders so each test drives the stub use-case outcome.
let loginResult: unknown;
let completeResult: unknown;
let capturedCompleteInput: { ip?: string; userAgent?: string; code?: string } = {};

const loginStub = { execute: vi.fn(async () => loginResult) };
const completeStub = {
  execute: vi.fn(async (input: { ip?: string }) => {
    capturedCompleteInput = input;
    return completeResult;
  }),
};
const noopStub = { execute: vi.fn(async () => ok({})) };

function buildApp() {
  const app = Fastify({ logger: false });
  const container = new Container();
  container.registerInstance(TOKENS.RegisterCustomerUseCase, noopStub);
  container.registerInstance(TOKENS.LoginCustomerUseCase, loginStub);
  container.registerInstance(TOKENS.CompleteCustomerMfaLoginUseCase, completeStub);
  container.registerInstance(TOKENS.RefreshCustomerTokenUseCase, noopStub);
  container.registerInstance(TOKENS.LogoutCustomerUseCase, noopStub);
  container.registerInstance(TOKENS.RequestPasswordResetUseCase, noopStub);
  container.registerInstance(TOKENS.ResetPasswordUseCase, noopStub);
  app.decorate("container", container);
  app.register(customerAuthRoutes);
  return app;
}

const STEP2_BODY = { challengeToken: "challenge-jwt-token", code: "123456" };

describe("POST /auth/customer/login/mfa — step-2 error contract", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedCompleteInput = {};
    app = buildApp();
    await app.ready();
  });

  it("emits a top-level code:INVALID_MFA_CODE (401) on a wrong TOTP/backup code", async () => {
    completeResult = err("INVALID_MFA_CODE");
    const res = await app.inject({
      method: "POST",
      url: "/auth/customer/login/mfa",
      payload: STEP2_BODY,
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("INVALID_MFA_CODE");
    expect(body.error).toBe("Invalid MFA code.");
    await app.close();
  });

  it("maps INVALID_CHALLENGE to a generic 401", async () => {
    completeResult = err("INVALID_CHALLENGE");
    const res = await app.inject({
      method: "POST",
      url: "/auth/customer/login/mfa",
      payload: STEP2_BODY,
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("INVALID_CHALLENGE");
    expect(body.error).toBe("MFA challenge is invalid or expired. Please sign in again.");
    await app.close();
  });

  it("returns a BYTE-IDENTICAL 401 for binding mismatch (anti-oracle) + emits the WARN", async () => {
    completeResult = err("INVALID_CHALLENGE");
    const invalid = await app.inject({
      method: "POST",
      url: "/auth/customer/login/mfa",
      payload: STEP2_BODY,
    });

    completeResult = err("CHALLENGE_BINDING_MISMATCH");
    const binding = await app.inject({
      method: "POST",
      url: "/auth/customer/login/mfa",
      payload: STEP2_BODY,
    });

    expect(binding.statusCode).toBe(invalid.statusCode);
    expect(binding.body).toBe(invalid.body); // byte-identical wire — no oracle
    expect(authLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ threat_type: "mfa_challenge_binding_mismatch" }),
      expect.any(String)
    );
    await app.close();
  });

  it("fails CLOSED with 503 + WARN on a store outage (MFA_UNAVAILABLE)", async () => {
    completeResult = err("MFA_UNAVAILABLE");
    const res = await app.inject({
      method: "POST",
      url: "/auth/customer/login/mfa",
      payload: STEP2_BODY,
    });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("MFA_UNAVAILABLE");
    expect(authLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ threat_type: "mfa_challenge_store_unavailable" }),
      expect.any(String)
    );
    await app.close();
  });

  it("mints a session (200) on success", async () => {
    completeResult = ok({ user: {}, account: {}, accessToken: "a-token", refreshToken: "r-token" });
    const res = await app.inject({
      method: "POST",
      url: "/auth/customer/login/mfa",
      payload: STEP2_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.accessToken).toBe("a-token");
    await app.close();
  });

  it("feeds the TRUSTED client IP (resolveClientIp), never request.ip", async () => {
    completeResult = ok({ user: {}, account: {}, accessToken: "a", refreshToken: "r" });
    await app.inject({
      method: "POST",
      url: "/auth/customer/login/mfa",
      headers: { "x-forwarded-for": "203.0.113.99" },
      payload: STEP2_BODY,
    });
    // request.ip (no trustProxy) would be the socket peer (127.0.0.1); the
    // handler passes the resolved XFF entry instead.
    expect(capturedCompleteInput.ip).toBe("203.0.113.99");
    await app.close();
  });
});

describe("POST /auth/customer/login — step-1 MFA branches", () => {
  let app: ReturnType<typeof buildApp>;
  const LOGIN_BODY = { email: "user@example.com", password: "some-password-123" };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    await app.ready();
  });

  it("passes a challenge body through (mfaRequired, no session tokens)", async () => {
    loginResult = ok({
      mfaRequired: true,
      challengeToken: "ct",
      expiresInSeconds: 180,
      methods: ["totp", "backup_code"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/customer/login",
      payload: LOGIN_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.mfaRequired).toBe(true);
    expect(body.data.challengeToken).toBe("ct");
    expect(body.data.accessToken).toBeUndefined();
    await app.close();
  });

  it("fails CLOSED with 503 + WARN when the challenge store is down at login", async () => {
    loginResult = err("MFA_UNAVAILABLE");
    const res = await app.inject({
      method: "POST",
      url: "/auth/customer/login",
      payload: LOGIN_BODY,
    });
    expect(res.statusCode).toBe(503);
    expect(authLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ threat_type: "mfa_challenge_store_unavailable" }),
      expect.any(String)
    );
    await app.close();
  });
});
