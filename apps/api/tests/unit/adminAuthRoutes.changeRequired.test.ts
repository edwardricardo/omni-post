/**
 * @file adminAuthRoutes.changeRequired.test.ts
 * @description Route-level boundary for the two routes that run the administrators' sign-in
 *   checks without a session, `POST /admin/auth/password/change-required` and
 *   `POST /admin/auth/login`. Drives the real Fastify handlers, their schemas and their status
 *   maps over a stubbed service, so what a caller without a session receives is pinned: for the
 *   change, the schema's refusals, the status of every code, the success body, the sign-in's rate
 *   limit, and that neither password reaches a response or a logged object; for the sign-in, the
 *   status and body of every code its map names, the answer that asks for the second factor, the
 *   success body, and the one rate-limit bucket both routes spend.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
const fastifySwagger = (await import("@fastify/swagger")).default;
const { jsonSchemaTransform, serializerCompiler, validatorCompiler } =
  await import("fastify-type-provider-zod");
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

/**
 * The routes over the stubs, registered under `prefix` when one is given, on an app with the Zod
 * compilers `createApp()` sets.
 */
function buildApp(options: { prefix?: string } = {}) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const container = new Container();
  container.registerInstance(TOKENS.AdminAuthService, adminAuthStub);
  container.registerInstance(TOKENS.PlatformCredentialService, credentialStub);
  container.registerInstance(TOKENS.EmailPort, emailStub);
  container.registerInstance(TOKENS.HttpRateLimiter, limiterStub);
  app.decorate("container", container);
  app.register(adminAuthRoutes, options);
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

  // Closed here rather than at the end of each case, so a failed assertion does not leave it open.
  afterEach(async () => {
    await app.close();
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
    [
      "a new password of 129 characters",
      { ...VALID_BODY, newPassword: "N".repeat(129) },
      "newPassword",
    ],
    ["a malformed second-factor code", { ...VALID_BODY, mfaToken: "12ab56" }, "mfaToken"],
  ])("refuses %s with 400 before the service runs", async (_case, payload, path) => {
    const res = await post(payload);

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Validation failed");
    expect(body.details.issues.map((issue: { path: string }) => issue.path)).toContain(path);
    expect(adminAuthStub.changeRequiredPassword).not.toHaveBeenCalled();
  });

  it("hands the service a new password of 128 characters, the longest the schema takes", async () => {
    const longest = "N".repeat(128);

    const res = await post({ ...VALID_BODY, newPassword: longest });

    expect(res.statusCode).toBe(200);
    expect(adminAuthStub.changeRequiredPassword).toHaveBeenCalledWith(
      expect.objectContaining({ newPassword: longest }),
      expect.anything()
    );
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
  });

  // MFA_REQUIRED and RATE_LIMIT_EXCEEDED are left out: this route answers both with statuses of
  // its own, which the table above pins, while the sign-in answers MFA_REQUIRED as a success that
  // asks for the code, which the sign-in's block below pins.
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
    }
  );

  it("spends the sign-in's rate-limit bucket, with the sign-in's allowance", async () => {
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
    expect(signInCall[0]).toBe("admin:127.0.0.1:/admin/auth/login");
    expect(changeCall).toEqual(signInCall);
  });

  it("spends the sign-in's rate-limit bucket on a body the schema refuses, before the handler answers it", async () => {
    const res = await post({ ...VALID_BODY, email: "not-an-address" });

    expect(res.statusCode).toBe(400);
    expect(limiterStub.tryConsume).toHaveBeenCalledTimes(1);
    expect(limiterStub.tryConsume).toHaveBeenCalledWith(
      "admin:127.0.0.1:/admin/auth/login",
      expect.anything()
    );
  });

  it("answers 429 and does not run the service when the rate limit refuses", async () => {
    limiterAllows = false;

    const res = await post(VALID_BODY);

    expect(res.statusCode).toBe(429);
    expect(adminAuthStub.changeRequiredPassword).not.toHaveBeenCalled();
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
  });
});

describe("POST /admin/auth/password/change-required in the published contract", () => {
  it("declares its body in the OpenAPI document the generated API types are made from: the e-mail and both passwords required, the second factor's code optional", async () => {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifySwagger, {
      transform: jsonSchemaTransform,
      openapi: { info: { title: "Contract test API", version: "1.0.0" } },
    });
    const container = new Container();
    container.registerInstance(TOKENS.AdminAuthService, adminAuthStub);
    container.registerInstance(TOKENS.PlatformCredentialService, credentialStub);
    container.registerInstance(TOKENS.EmailPort, emailStub);
    container.registerInstance(TOKENS.HttpRateLimiter, limiterStub);
    app.decorate("container", container);
    await app.register(adminAuthRoutes);
    await app.ready();

    // The document is OpenAPI 3, the only version whose operations carry `requestBody`.
    const operation = app.swagger().paths?.[ROUTE]?.post ?? {};
    const body = "requestBody" in operation ? operation.requestBody : undefined;
    await app.close();

    expect(body).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              email: { type: "string" },
              currentPassword: { type: "string", minLength: 1 },
              newPassword: { type: "string", minLength: 1, maxLength: 128 },
              mfaToken: { type: "string" },
            },
            required: ["email", "currentPassword", "newPassword"],
          },
        },
      },
    });
  });
});

describe("POST /admin/auth/login", () => {
  const SIGN_IN_ROUTE = "/admin/auth/login";
  const SIGN_IN_BODY = { email: TYPED_EMAIL, password: CURRENT_PASSWORD };

  /** A completed sign-in, in the shape the service returns it. */
  const SIGNED_IN = {
    user: { id: "admin-route-sign-in", email: STORED_EMAIL, role: "SUPER_ADMIN" },
    tokens: {
      accessToken: "fixture-access-token",
      refreshToken: "fixture-refresh-token",
      expiresIn: 900,
      csrfToken: "fixture-csrf-token",
    },
    requiresMfa: false,
  };

  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    loginResult = ok(SIGNED_IN);
    limiterAllows = true;
    app = buildApp();
    await app.ready();
  });

  // Closed here rather than at the end of each case, so a failed assertion does not leave it open.
  afterEach(async () => {
    await app.close();
  });

  async function signIn() {
    return app.inject({
      method: "POST",
      url: SIGN_IN_ROUTE,
      headers: { "user-agent": USER_AGENT },
      payload: SIGN_IN_BODY,
    });
  }

  it("answers 200 with the profile and the tokens, and hands the service the normalized e-mail", async () => {
    const res = await signIn();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, data: SIGNED_IN });
    expect(adminAuthStub.login).toHaveBeenCalledTimes(1);
    expect(adminAuthStub.login).toHaveBeenCalledWith(
      { email: STORED_EMAIL, password: CURRENT_PASSWORD, rememberMe: false },
      { deviceId: "", userAgent: USER_AGENT, ipAddress: "127.0.0.1" }
    );
  });

  it.each([
    ["INVALID_CREDENTIALS", 401],
    ["ACCOUNT_LOCKED", 403],
    ["ACCOUNT_INACTIVE", 403],
    ["MFA_INVALID", 401],
    ["PASSWORD_CHANGE_REQUIRED", 403],
  ])("answers %s with %i and the code", async (code, status) => {
    loginResult = err(code);

    const res = await signIn();

    expect(res.statusCode).toBe(status);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: code });
  });

  it("answers a missing second factor with 200 and a body that asks for it", async () => {
    loginResult = err("MFA_REQUIRED");

    const res = await signIn();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, data: { requiresMfa: true } });
  });

  it("keys the sign-in and the change by the sign-in's pattern when the routes are registered under a prefix", async () => {
    const prefixed = buildApp({ prefix: "/v1" });
    try {
      await prefixed.ready();
      await prefixed.inject({ method: "POST", url: `/v1${SIGN_IN_ROUTE}`, payload: SIGN_IN_BODY });
      await prefixed.inject({ method: "POST", url: `/v1${ROUTE}`, payload: VALID_BODY });
    } finally {
      await prefixed.close();
    }

    const keys = (limiterStub.tryConsume.mock.calls as unknown as [string, unknown][]).map(
      ([key]) => key
    );
    expect(keys).toEqual([
      "admin:127.0.0.1:/admin/auth/login",
      "admin:127.0.0.1:/admin/auth/login",
    ]);
  });
});
