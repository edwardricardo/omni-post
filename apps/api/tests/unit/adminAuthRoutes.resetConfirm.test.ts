/**
 * @file adminAuthRoutes.resetConfirm.test.ts
 * @description Route-level boundary for `POST /admin/auth/password/reset/confirm`.
 *   Drives the REAL Fastify handler and the REAL `statusMap` so the HTTP status a
 *   portal branches on is pinned by a test rather than inferred from the service
 *   contract. `CONCURRENT_MODIFICATION` is the case that needs it: it is the only
 *   reset outcome that means "present the SAME token again", and a portal cannot
 *   tell it from `INVALID_TOKEN` unless the status differs — 409 against 400.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { err, ok } from "@shared/types";

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

const Fastify = (await import("fastify")).default;
const { adminAuthRoutes } = await import("../../src/admin/auth/adminAuthRoutes.js");
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");

/** Drives the stubbed service outcome for the case under test. */
let confirmResult: unknown;

const adminAuthStub = {
  confirmPasswordReset: vi.fn(async () => confirmResult),
};

/** No Turnstile secret configured, so the handler skips the challenge entirely. */
const credentialStub = { getCredential: vi.fn(async () => err("NOT_FOUND")) };
const emailStub = { send: vi.fn(async () => ok(undefined)) };
/** Always allows: the limiter is registered so `rateLimit` resolves, not to be tested. */
const limiterStub = { tryConsume: vi.fn(async () => ({ allowed: true })) };

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

/** A syntactically valid token — the route's schema demands a UUID. */
const VALID_TOKEN = "11111111-2222-4333-8444-555555555555";
const STRONG_PASSWORD = "W1nner-Str0ng-P@ss!";

describe("POST /admin/auth/password/reset/confirm — claim verdict to HTTP status", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    await app.ready();
  });

  it("maps CONCURRENT_MODIFICATION to 409, not to the 400 a bad token gets", async () => {
    confirmResult = err("CONCURRENT_MODIFICATION");

    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/password/reset/confirm",
      payload: { token: VALID_TOKEN, newPassword: STRONG_PASSWORD },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe("CONCURRENT_MODIFICATION");
    await app.close();
  });

  it("maps INVALID_TOKEN to 400, so the two refusals are distinguishable over HTTP", async () => {
    confirmResult = err("INVALID_TOKEN");

    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/password/reset/confirm",
      payload: { token: VALID_TOKEN, newPassword: STRONG_PASSWORD },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
