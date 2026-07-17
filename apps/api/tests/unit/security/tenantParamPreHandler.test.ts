/**
 * @file tenantParamPreHandler.test.ts
 * @description Unit tests for the param-derived tenant-context preHandler factory.
 *   Proves the OUTCOME (not the call): a present param binds a real tenant context
 *   observable via `getTenantContext()` synchronously after the handler, and an
 *   absent/empty param fails closed with 400 while leaving any prior context
 *   untouched — so no enrolled-model query can run context-less behind a pre-auth
 *   boundary.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { enterTenantContext, getTenantContext } from "../../../src/security/tenantContext.js";
import { makeTenantParamPreHandler } from "../../../src/security/tenantParamPreHandler.js";

function fakeReq(params: Record<string, unknown>): FastifyRequest {
  return { params } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { statusCode?: number; body?: unknown } {
  const reply = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    code(n: number) {
      this.statusCode = n;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return reply as unknown as FastifyReply & { statusCode?: number; body?: unknown };
}

describe("makeTenantParamPreHandler", () => {
  it("binds the accountId from the named param — observable via getTenantContext", async () => {
    const handler = makeTenantParamPreHandler("accountId");
    const reply = fakeReply();

    await handler(fakeReq({ accountId: "acct-123" }), reply);

    // Outcome, not implementation: the real context is bound synchronously.
    expect(getTenantContext()?.accountId).toBe("acct-123");
    expect(reply.statusCode).toBeUndefined();
  });

  it("reads the account id from a differently-named param (tenantId)", async () => {
    const handler = makeTenantParamPreHandler("tenantId");
    const reply = fakeReply();

    await handler(fakeReq({ tenantId: "tenant-abc" }), reply);

    expect(getTenantContext()?.accountId).toBe("tenant-abc");
  });

  it("returns 400 and binds no new context when the param is absent", async () => {
    // Seed a known context; the fail-closed path must leave it untouched.
    enterTenantContext({ accountId: "sentinel-untouched" });
    const handler = makeTenantParamPreHandler("accountId");
    const reply = fakeReply();

    await handler(fakeReq({}), reply);

    expect(reply.statusCode).toBe(400);
    expect(getTenantContext()?.accountId).toBe("sentinel-untouched");
  });

  it("returns 400 and binds no new context when the param is an empty string", async () => {
    enterTenantContext({ accountId: "sentinel-untouched" });
    const handler = makeTenantParamPreHandler("accountId");
    const reply = fakeReply();

    await handler(fakeReq({ accountId: "" }), reply);

    expect(reply.statusCode).toBe(400);
    expect(getTenantContext()?.accountId).toBe("sentinel-untouched");
  });
});
