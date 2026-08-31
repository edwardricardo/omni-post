/**
 * @file customerOrAdminAuth.test.ts
 * @description Unit tests for requireCustomerOrAdminAuth — the composed authentication preHandler
 *   that lets a single route be reached by EITHER a customer (owner) token OR an admin token, used
 *   by the restore endpoints ("admin-or-owner"). Proves a valid customer token populates
 *   request.customerUser, a valid admin token populates request.auth, and an unauthenticated or
 *   junk token is rejected 401. The two token kinds use different secrets/audiences, so there is no
 *   confusion path: a customer token never verifies as admin and vice versa.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ok, err } from "@shared/types";
import { signCustomerAccessToken } from "../../../src/auth/customerJwt.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { requireCustomerOrAdminAuth } from "../../../src/auth/customerOrAdminAuth.js";

function makeReply(): FastifyReply & { statusCode?: number; payload?: unknown } {
  const reply = {
    code(status: number) {
      reply.statusCode = status;
      return reply;
    },
    status(status: number) {
      reply.statusCode = status;
      return reply;
    },
    send(payload: unknown) {
      reply.payload = payload;
      return reply;
    },
  } as unknown as FastifyReply & { statusCode?: number; payload?: unknown };
  return reply;
}

/**
 * Build a request with an Authorization header and a server container that
 * resolves a stub AdminAuthService with the given verifier.
 */
function makeRequest(
  authorization: string | undefined,
  adminVerify?: (token: string) => ReturnType<typeof ok> | ReturnType<typeof err>
): FastifyRequest {
  return {
    headers: authorization !== undefined ? { authorization } : {},
    server: {
      container: {
        resolve: (token: symbol) =>
          token === TOKENS.AdminAuthService && adminVerify
            ? { verifyAccessToken: adminVerify }
            : undefined,
      },
    },
  } as unknown as FastifyRequest;
}

describe("requireCustomerOrAdminAuth", () => {
  it("authenticates a valid customer token onto request.customerUser", async () => {
    const token = signCustomerAccessToken({
      sub: "customer-1",
      accountId: "account-1",
      roleId: "role-owner",
      roleName: "OWNER",
      permissions: ["account:delete"],
    });
    const request = makeRequest(`Bearer ${token}`);
    const reply = makeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBeUndefined();
    expect(request.customerUser?.accountId).toBe("account-1");
    expect(request.customerUser?.permissions).toContain("account:delete");
    // A customer token must NOT be treated as an admin principal.
    expect(request.auth).toBeUndefined();
  });

  it("authenticates a valid admin token onto request.auth when the token is not a customer token", async () => {
    const adminVerify = vi.fn(() =>
      ok({ sub: "admin-1", email: "a@x.com", name: "Admin", role: "ADMIN" })
    );
    const request = makeRequest("Bearer some-admin-token", adminVerify);
    const reply = makeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBeUndefined();
    expect(request.auth?.user.id).toBe("admin-1");
    expect(request.auth?.user.role).toBe("ADMIN");
    expect(request.customerUser).toBeUndefined();
  });

  it("rejects with 401 when neither a customer nor an admin token verifies", async () => {
    const adminVerify = vi.fn(() => err("INVALID_TOKEN"));
    const request = makeRequest("Bearer garbage", adminVerify);
    const reply = makeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.customerUser).toBeUndefined();
    expect(request.auth).toBeUndefined();
  });

  it("rejects with 401 when no Authorization header is present", async () => {
    const request = makeRequest(undefined);
    const reply = makeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBe(401);
  });
});
