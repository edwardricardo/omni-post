/**
 * @file customerRbacMiddleware.test.ts
 * @description Unit tests for requireCustomerPermission — the customer-side owner-level permission
 *   gate. Proves it reads the JWT permission snapshot on `request.customerUser`, denies a caller
 *   that lacks the permission (403), allows one that holds it, and rejects an unauthenticated
 *   request (401). This is the gate that stopped ANY authenticated customer (VIEWER/MEMBER/MANAGER)
 *   from soft-deleting account resources.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  requireCustomerPermission,
  CustomerPermission,
} from "../../../src/auth/customerRbacMiddleware.js";

/** Minimal reply double that records the status code and payload. */
function makeReply(): FastifyReply & { statusCode?: number; payload?: unknown } {
  const reply = {
    code(status: number) {
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

function makeRequest(permissions?: readonly string[]): FastifyRequest {
  return {
    ...(permissions !== undefined && {
      customerUser: {
        id: "customer-1",
        accountId: "account-1",
        roleId: "role-owner",
        roleName: "OWNER",
        permissions,
      },
    }),
  } as unknown as FastifyRequest;
}

describe("requireCustomerPermission", () => {
  it("allows a caller that holds the required permission (no reply sent)", async () => {
    const reply = makeReply();
    const sendSpy = vi.spyOn(reply, "send");
    const mw = requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE);

    await mw(makeRequest(["post:read", "account:delete"]), reply);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reply.statusCode).toBeUndefined();
  });

  it("denies with 403 a caller that lacks the required permission", async () => {
    const reply = makeReply();
    const mw = requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE);

    await mw(makeRequest(["post:read", "post:create", "channel:read"]), reply);

    expect(reply.statusCode).toBe(403);
    expect((reply.payload as { error?: { code?: string } })?.error?.code).toBe("PERMISSION_DENIED");
  });

  it("denies with 403 a caller whose permission set is empty", async () => {
    const reply = makeReply();
    const mw = requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE);

    await mw(makeRequest([]), reply);

    expect(reply.statusCode).toBe(403);
  });

  it("rejects with 401 when there is no authenticated customer", async () => {
    const reply = makeReply();
    const mw = requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE);

    await mw(makeRequest(undefined), reply);

    expect(reply.statusCode).toBe(401);
  });

  it("allows when the caller holds ANY of several accepted permissions", async () => {
    const reply = makeReply();
    const sendSpy = vi.spyOn(reply, "send");
    const mw = requireCustomerPermission(
      CustomerPermission.ACCOUNT_MANAGE,
      CustomerPermission.ACCOUNT_DELETE
    );

    await mw(makeRequest(["account:delete"]), reply);

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
