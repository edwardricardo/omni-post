/**
 * @file customerRbacMiddleware.test.ts
 * @description Unit tests for the customer-side permission gate. The customer JWT carries a
 *   permission snapshot, so the gate is a pure membership test with no service round-trip —
 *   which makes its two failure modes the only things worth pinning: an unauthenticated
 *   request MUST NOT reach the handler (fail closed on a missing principal), and a customer
 *   holding none of the accepted permissions MUST get 403 rather than falling through. Both
 *   assertions go red the moment their guard is deleted: without the principal check an
 *   anonymous request stops replying 401, and without the membership check a MEMBER-level
 *   token silently reaches an OWNER-only handler.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CustomerPermission,
  requireCustomerPermission,
} from "../../../src/auth/customerRbacMiddleware.js";

interface CapturingReply {
  statusCode: number | undefined;
  body: unknown;
}

function fakeReply(): FastifyReply & CapturingReply {
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
  return reply as unknown as FastifyReply & CapturingReply;
}

/** Request carrying an authenticated customer holding exactly `permissions`. */
function reqWithPermissions(permissions: readonly string[]): FastifyRequest {
  return {
    customerUser: {
      id: "customer-1",
      accountId: "account-1",
      roleId: "role-1",
      roleName: "OWNER",
      permissions,
    },
  } as unknown as FastifyRequest;
}

/** Request that never went through customer authentication. */
function reqWithoutPrincipal(): FastifyRequest {
  return { customerUser: undefined } as unknown as FastifyRequest;
}

function errorCodeOf(body: unknown): string | undefined {
  return (body as { error?: { code?: string } } | undefined)?.error?.code;
}

describe("requireCustomerPermission", () => {
  it("replies 401 when the request carries no authenticated customer", async () => {
    const reply = fakeReply();

    await requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE)(
      reqWithoutPrincipal(),
      reply
    );

    expect(reply.statusCode).toBe(401);
    expect(errorCodeOf(reply.body)).toBe("AUTHENTICATION_REQUIRED");
  });

  it("replies 403 PERMISSION_DENIED when the customer holds none of the required permissions", async () => {
    const reply = fakeReply();

    await requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE)(
      reqWithPermissions(["post:read", "post:write"]),
      reply
    );

    expect(reply.statusCode).toBe(403);
    expect(errorCodeOf(reply.body)).toBe("PERMISSION_DENIED");
  });

  it("returns without replying when the customer holds the required permission", async () => {
    const reply = fakeReply();

    await requireCustomerPermission(CustomerPermission.ACCOUNT_DELETE)(
      reqWithPermissions([CustomerPermission.ACCOUNT_DELETE]),
      reply
    );

    expect(reply.statusCode).toBeUndefined();
    expect(reply.body).toBeUndefined();
  });

  it("allows the request when the customer holds only the second of two accepted permissions", async () => {
    const reply = fakeReply();

    await requireCustomerPermission(
      CustomerPermission.ACCOUNT_DELETE,
      CustomerPermission.ACCOUNT_MANAGE
    )(reqWithPermissions([CustomerPermission.ACCOUNT_MANAGE]), reply);

    expect(reply.statusCode).toBeUndefined();
  });

  it("replies 403 when the customer holds neither of two accepted permissions", async () => {
    const reply = fakeReply();

    await requireCustomerPermission(
      CustomerPermission.ACCOUNT_DELETE,
      CustomerPermission.ACCOUNT_MANAGE
    )(reqWithPermissions(["account:read"]), reply);

    expect(reply.statusCode).toBe(403);
    expect(errorCodeOf(reply.body)).toBe("PERMISSION_DENIED");
  });

  it("names every accepted permission in the 403 message so the caller can see what is required", async () => {
    const reply = fakeReply();

    await requireCustomerPermission(
      CustomerPermission.ACCOUNT_DELETE,
      CustomerPermission.ACCOUNT_MANAGE
    )(reqWithPermissions([]), reply);

    const message = (reply.body as { error?: { message?: string } }).error?.message ?? "";
    expect(message).toContain(CustomerPermission.ACCOUNT_DELETE);
    expect(message).toContain(CustomerPermission.ACCOUNT_MANAGE);
  });

  it("exposes the OWNER-only account lifecycle permissions as their wire strings", () => {
    expect(CustomerPermission.ACCOUNT_DELETE).toBe("account:delete");
    expect(CustomerPermission.ACCOUNT_MANAGE).toBe("account:manage");
  });
});
