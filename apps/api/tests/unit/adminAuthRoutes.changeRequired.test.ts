/**
 * @file adminAuthRoutes.changeRequired.test.ts
 * @description Route-level boundary for `POST /admin/auth/password/change-required`. Drives the
 *   real Fastify handler, its schema and its status map over a stubbed service, so what a caller
 *   without a session receives is pinned: the schema's refusals, the status of every code, the
 *   success body, the sign-in's rate limit, and that neither password reaches a response or a
 *   logged object.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { err, ok } from "@shared/types";

const { logged } = vi.hoisted(() => ({ logged: [] as unknown[] }));

vi.mock("../../src/lib/logger.js", () => {
  const record = (...args: unknown[]) => {
    logged.push(args);
  };
  const capturingLogger = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    trace: record,
    fatal: record,
    child: () => capturingLogger,
  };
  return {
    logger: capturingLogger,
    authLogger: capturingLogger,
    createLogger: () => capturingLogger,
  };
});

const Fastify = (await import("fastify")).default;
const { adminAuthRoutes } = await import("../../src/admin/auth/adminAuthRoutes.js");
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");

const ROUTE = "/admin/auth/password/change-required";
const TYPED_EMAIL = "First.Admin@Route-Change.TEST";
const STORED_EMAIL = "first.admin@route-change.test";
const CURRENT_PASSWORD = "fixture-route-current-K2";
const NEW_PASSWORD = "Fixture-Route-New-Pw-5r!";
const MFA_CODE = "135792";
const USER_AGENT = "fixture-route-agent/1.0";

/** Drives the stubbed service outcome for the case under test. */
let changeResult: unknown;
let loginResult: unknown;
let limiterAllows = true;

const adminAuthStub = {
  changeRequiredPassword: vi.fn(async () => changeResult),
  login: vi.fn(async () => loginResult),
};
const credentialStub = { getCredential: vi.fn(async () => err("NOT_FOUND")) };
const emailStub = { send: vi.fn(async () => ok(undefined)) };
const limiterStub = {
  tryConsume: vi.fn(async () =>
    limiterAllows ? { allowed: true } : { allowed: false, retryAfterMs: 30_000 }
  ),
};

function buildApp() {
  const app = Fastify({ logger: false });
  const container = new Container();
  container.registerInstance(TOKENS.AdminAuthService, adminAuthStub);
  container.registerInstance(TOKENS.PlatformCredentialService, credentialStub);
  container.registerInstance(TOKENS.EmailPort, emailStub);
  container.registerInstance(TOKENS.HttpRateLimiter, limiterStub);
  app.decorate("container", container);
  app.register(adminAuthRoutes);
  return app;
}

/** A complete, well-formed body: the e-mail as typed and both passwords. */
const VALID_BODY = {
  email: TYPED_EMAIL,
  currentPassword: CURRENT_PASSWORD,
  newPassword: NEW_PASSWORD,
};

describe("POST /admin/auth/password/change-required", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    logged.length = 0;
    changeResult = ok(undefined);
    loginResult = err("INVALID_CREDENTIALS");
    limiterAllows = true;
    app = buildApp();
    await app.ready();
  });

  async function post(payload: unknown) {
    return app.inject({
      method: "POST",
      url: ROUTE,
      headers: { "user-agent": USER_AGENT },
      payload: payload as Record<string, unknown>,
    });
  }

  it("answers 200 with a message, without a session, and hands the service the normalized e-mail and both passwords", async () => {
    const res = await post(VALID_BODY);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      data: { message: "Password changed. Sign in with the new password." },
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(adminAuthStub.changeRequiredPassword).toHaveBeenCalledTimes(1);
    expect(adminAuthStub.changeRequiredPassword).toHaveBeenCalledWith(
      { email: STORED_EMAIL, currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD },
      { deviceId: "", userAgent: USER_AGENT, ipAddress: "127.0.0.1" }
    );
    await app.close();
  });

  it("hands the service the second factor's code when one is given", async () => {
    await post({ ...VALID_BODY, mfaToken: MFA_CODE });

    expect(adminAuthStub.changeRequiredPassword).toHaveBeenCalledWith(
      {
        email: STORED_EMAIL,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        mfaToken: MFA_CODE,
      },
      expect.anything()
    );
    await app.close();
  });

  it.each([
    ["no body", undefined, ""],
    ["a missing e-mail", { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD }, "email"],
    ["a malformed e-mail", { ...VALID_BODY, email: "not-an-address" }, "email"],
    ["an empty current password", { ...VALID_BODY, currentPassword: "" }, "currentPassword"],
    [
      "a missing new password",
      { email: TYPED_EMAIL, currentPassword: CURRENT_PASSWORD },
      "newPassword",
    ],
    ["an empty new password", { ...VALID_BODY, newPassword: "" }, "newPassword"],
    ["a malformed second-factor code", { ...VALID_BODY, mfaToken: "12ab56" }, "mfaToken"],
  ])("refuses %s with 400 before the service runs", async (_case, payload, path) => {
    const res = await post(payload);

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Validation failed");
    expect(body.details.issues.map((issue: { path: string }) => issue.path)).toContain(path);
    expect(adminAuthStub.changeRequiredPassword).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ["INVALID_CREDENTIALS", 401],
    ["ACCOUNT_LOCKED", 403],
    ["ACCOUNT_INACTIVE", 403],
    ["MFA_INVALID", 401],
    ["PASSWORD_CHANGE_NOT_REQUIRED", 409],
    ["PASSWORD_TOO_WEAK", 400],
    ["PASSWORD_REUSED", 400],
    ["CONCURRENT_MODIFICATION", 409],
    ["RATE_LIMIT_EXCEEDED", 429],
    ["MFA_REQUIRED", 401],
  ])("answers %s with %i and the code", async (code, status) => {
    changeResult = err(code);

    const res = await post(VALID_BODY);

    expect(res.statusCode).toBe(status);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: code });
    await app.close();
  });

  it.each(["INVALID_CREDENTIALS", "ACCOUNT_LOCKED", "ACCOUNT_INACTIVE", "MFA_INVALID"])(
    "answers %s with the status the sign-in gives it",
    async (code) => {
      changeResult = err(code);
      loginResult = err(code);

      const change = await post(VALID_BODY);
      const signIn = await app.inject({
        method: "POST",
        url: "/admin/auth/login",
        payload: { email: TYPED_EMAIL, password: CURRENT_PASSWORD },
      });

      expect(change.statusCode).toBe(signIn.statusCode);
      await app.close();
    }
  );

  it("answers the brute-force gate's refusal with 429, the one code whose status differs from the sign-in's 500", async () => {
    changeResult = err("RATE_LIMIT_EXCEEDED");
    loginResult = err("RATE_LIMIT_EXCEEDED");

    const change = await post(VALID_BODY);
    const signIn = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: TYPED_EMAIL, password: CURRENT_PASSWORD },
    });

    expect([change.statusCode, signIn.statusCode]).toEqual([429, 500]);
    await app.close();
  });

  it("answers a missing second factor as an error, since nothing changed", async () => {
    changeResult = err("MFA_REQUIRED");

    const res = await post(VALID_BODY);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: "MFA_REQUIRED" });
    await app.close();
  });

  it("applies the sign-in's rate limit, in a bucket of its own", async () => {
    await post(VALID_BODY);
    await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: TYPED_EMAIL, password: CURRENT_PASSWORD },
    });

    const [changeCall, signInCall] = limiterStub.tryConsume.mock.calls as unknown as [
      [string, unknown],
      [string, unknown],
    ];
    expect(changeCall[0].endsWith(`:${ROUTE}`)).toBe(true);
    expect(signInCall[0].endsWith(":/admin/auth/login")).toBe(true);
    expect(changeCall[1]).toEqual(signInCall[1]);
    await app.close();
  });

  it("answers 429 and does not run the service when the rate limit refuses", async () => {
    limiterAllows = false;

    const res = await post(VALID_BODY);

    expect(res.statusCode).toBe(429);
    expect(adminAuthStub.changeRequiredPassword).not.toHaveBeenCalled();
    await app.close();
  });

  it("writes neither password into a response or a logged object", async () => {
    const responses: string[] = [];
    for (const code of ["INVALID_CREDENTIALS", "PASSWORD_REUSED", "CONCURRENT_MODIFICATION"]) {
      changeResult = err(code);
      responses.push((await post(VALID_BODY)).body);
    }
    responses.push((await post({ ...VALID_BODY, mfaToken: "12ab56" })).body);
    responses.push((await post({ ...VALID_BODY, email: "not-an-address" })).body);
    changeResult = ok(undefined);
    responses.push((await post(VALID_BODY)).body);

    const written = JSON.stringify(logged) + responses.join("\n");
    expect(logged.length).toBeGreaterThan(0);
    expect(written.includes(CURRENT_PASSWORD)).toBe(false);
    expect(written.includes(NEW_PASSWORD)).toBe(false);
    await app.close();
  });
});
