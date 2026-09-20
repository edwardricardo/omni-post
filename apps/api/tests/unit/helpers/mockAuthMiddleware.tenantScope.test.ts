/**
 * @file mockAuthMiddleware.tenantScope.test.ts
 * @description Pins the TENANT SCOPE of the shared customer-auth double. The double
 *   binds the tenant exactly as production's `requireClientAuth` does, through
 *   `enterTenantContext`, and that call uses `AsyncLocalStorage.enterWith`: it binds
 *   for the remainder of the current async resource rather than for a scoped callback.
 *   In production that is correct — a Fastify preHandler has no callback to wrap the
 *   rest of the request in — but in a TEST process it raises a question no suite was
 *   asking: does the binding outlive the request that made it? If it does, a future
 *   case that asserts a SCOPE REFUSAL would pass for the wrong reason, because the
 *   refusal would never fire and nothing would say why.
 *
 *   These cases answer it by measurement rather than by argument, and they stay as the
 *   regression guard: the day the binding starts to escape, this file is what says so.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createCustomerAuthMock } from "./mockAuthMiddleware.js";
import { getTenantContext } from "../../../src/security/tenantContext.js";

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A token the double can decode: header and signature are never read. */
function tokenFor(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: `user-${accountId}`, accountId, roleName: "OWNER", permissions: [] })
  ).toString("base64url");
  return `header.${payload}.signature`;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const { requireClientAuth } = createCustomerAuthMock();
  app.get("/scope", { preHandler: requireClientAuth }, async () => {
    // Read INSIDE the request, which is where production reads it too.
    return { accountId: getTenantContext()?.accountId ?? null };
  });
  await app.ready();
  return app;
}

describe("createCustomerAuthMock — the tenant binding's scope", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it("binds the request's own account for the handler to read", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/scope",
      headers: { authorization: `Bearer ${tokenFor(ACCOUNT_A)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accountId: ACCOUNT_A });
  });

  it("leaves the test's own context unbound once the request completed", async () => {
    await app.inject({
      method: "GET",
      url: "/scope",
      headers: { authorization: `Bearer ${tokenFor(ACCOUNT_A)}` },
    });

    expect(getTenantContext()).toBeUndefined();
  });

  it("does not carry one request's account into the next", async () => {
    await app.inject({
      method: "GET",
      url: "/scope",
      headers: { authorization: `Bearer ${tokenFor(ACCOUNT_A)}` },
    });

    const second = await app.inject({
      method: "GET",
      url: "/scope",
      headers: { authorization: `Bearer ${tokenFor(ACCOUNT_B)}` },
    });

    expect(second.json()).toEqual({ accountId: ACCOUNT_B });
  });

  it("leaves an UNAUTHENTICATED request with no tenant at all, so a scope refusal can fire", async () => {
    // This is the case the residual was written for: a suite that exercises a
    // refusal needs the store to be genuinely empty when no one authenticated.
    await app.inject({
      method: "GET",
      url: "/scope",
      headers: { authorization: `Bearer ${tokenFor(ACCOUNT_A)}` },
    });

    const unauthenticated = await app.inject({ method: "GET", url: "/scope" });

    expect(unauthenticated.statusCode).toBe(401);
    expect(getTenantContext()).toBeUndefined();
  });
});
