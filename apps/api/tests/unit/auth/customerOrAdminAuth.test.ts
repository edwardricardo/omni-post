/**
 * @file customerOrAdminAuth.test.ts
 * @description Unit tests for the dual-principal preHandler that serves the "admin-or-owner"
 *   surface. Each of its four guards is independently deletable, so each gets its own
 *   assertion: a real customer access token populates `request.customerUser` AND binds the
 *   tenant context (without that binding the tenant guard has no account to scope by, and a
 *   downstream owner query would run unscoped); an admin access token populates
 *   `request.auth` and binds NO tenant context (admin work is expected to opt into
 *   `withSystemContext` explicitly); a token that verifies as neither is rejected with 401
 *   instead of reaching the handler as an anonymous caller; and a header that carries no
 *   bearer credential at all is rejected by the extractor before either verifier runs, which
 *   is why those cases assert the extractor's own message rather than settling for the shared
 *   401 status that the final fail-closed reply would produce anyway.
 *
 *   The customer token here is genuinely signed and genuinely verified, so the rejection
 *   test exercises the real signature check rather than a stubbed verdict.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireCustomerOrAdminAuth } from "../../../src/auth/customerOrAdminAuth.js";
import { signCustomerAccessToken } from "../../../src/auth/customerJwt.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { getTenantContext } from "../../../src/security/tenantContext.js";

const CUSTOMER_ACCOUNT_ID = "account-owner-1";

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

/**
 * Admin auth double whose `verifyAccessToken` accepts exactly one opaque token
 * string. Any other token is rejected the way the real service rejects a
 * customer token: a failed `Result`, never a throw.
 */
function fakeAdminAuthService(acceptedToken: string) {
  return {
    verifyAccessToken(token: string) {
      if (token !== acceptedToken) {
        return { ok: false, error: "INVALID_TOKEN" } as const;
      }
      return {
        ok: true,
        value: {
          sub: "admin-1",
          email: "admin@example.test",
          name: "Admin One",
          role: "SUPER_ADMIN",
          type: "access",
          iat: 0,
          exp: 0,
          deviceId: "device-1",
        },
      } as const;
    },
  };
}

function fakeRequest(
  authorization: string | undefined,
  adminAuthService: ReturnType<typeof fakeAdminAuthService> | null
): FastifyRequest {
  return {
    headers: {
      ...(authorization !== undefined && { authorization }),
      "user-agent": "vitest",
    },
    ip: "203.0.113.10",
    server: {
      container: {
        resolve: (token: symbol) => (token === TOKENS.AdminAuthService ? adminAuthService : null),
      },
    },
    customerUser: undefined as unknown,
    auth: undefined as unknown,
  } as unknown as FastifyRequest;
}

function customerToken(): string {
  return signCustomerAccessToken({
    sub: "customer-1",
    accountId: CUSTOMER_ACCOUNT_ID,
    roleId: "role-owner",
    roleName: "OWNER",
    permissions: ["account:delete", "account:manage"],
  });
}

function errorCodeOf(body: unknown): string | undefined {
  return (body as { error?: { code?: string } } | undefined)?.error?.code;
}

function messageOf(body: unknown): string | undefined {
  return (body as { error?: { message?: string } } | undefined)?.error?.message;
}

/**
 * The two rejection paths answer different questions for the caller — "you sent
 * no credential" versus "the credential you sent is not valid" — and they are
 * produced by two independent guards. Asserting the message keeps each header
 * test anchored to its own guard instead of both riding on the final fail-closed
 * reply, which would leave the header parsing free to accept anything.
 */
const NO_CREDENTIAL_MESSAGE = "Authorization token required";
const BAD_CREDENTIAL_MESSAGE = "Invalid or expired token";

describe("requireCustomerOrAdminAuth", () => {
  let admin: ReturnType<typeof fakeAdminAuthService>;

  beforeEach(() => {
    admin = fakeAdminAuthService("admin-access-token");
  });

  it("populates customerUser and binds the tenant context for a valid customer token", async () => {
    const request = fakeRequest(`Bearer ${customerToken()}`, admin);
    const reply = fakeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBeUndefined();
    expect(request.customerUser?.id).toBe("customer-1");
    expect(request.customerUser?.accountId).toBe(CUSTOMER_ACCOUNT_ID);
    expect(request.customerUser?.roleName).toBe("OWNER");
    expect(request.customerUser?.permissions).toEqual(["account:delete", "account:manage"]);
    expect(request.auth).toBeUndefined();
    // The binding is the point: a customer request that reaches the handler
    // without tenant scope would query across accounts.
    expect(getTenantContext()?.accountId).toBe(CUSTOMER_ACCOUNT_ID);
  });

  it("populates auth for a valid admin token and leaves customerUser unset", async () => {
    const request = fakeRequest("Bearer admin-access-token", admin);
    const reply = fakeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBeUndefined();
    expect(request.auth?.user.id).toBe("admin-1");
    expect(request.auth?.user.email).toBe("admin@example.test");
    expect(request.auth?.user.role).toBe("SUPER_ADMIN");
    expect(request.customerUser).toBeUndefined();
  });

  it("replies 401 when the token verifies as neither a customer nor an admin", async () => {
    const request = fakeRequest("Bearer not-a-real-token", admin);
    const reply = fakeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(errorCodeOf(reply.body)).toBe("INVALID_TOKEN");
    expect(messageOf(reply.body)).toBe(BAD_CREDENTIAL_MESSAGE);
    expect(request.customerUser).toBeUndefined();
    expect(request.auth).toBeUndefined();
  });

  it("rejects an absent Authorization header before any token verification runs", async () => {
    const request = fakeRequest(undefined, admin);
    const reply = fakeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(errorCodeOf(reply.body)).toBe("INVALID_TOKEN");
    expect(messageOf(reply.body)).toBe(NO_CREDENTIAL_MESSAGE);
  });

  it("rejects a non-Bearer Authorization scheme instead of treating its credential as a token", async () => {
    const request = fakeRequest("Basic YWRtaW46YWRtaW4=", admin);
    const reply = fakeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(messageOf(reply.body)).toBe(NO_CREDENTIAL_MESSAGE);
  });

  it("rejects a Bearer header with an empty credential", async () => {
    const request = fakeRequest("Bearer ", admin);
    const reply = fakeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(messageOf(reply.body)).toBe(NO_CREDENTIAL_MESSAGE);
  });

  it("replies 401 when the admin auth service is not resolvable from the container", async () => {
    const request = fakeRequest("Bearer admin-access-token", null);
    const reply = fakeReply();

    await requireCustomerOrAdminAuth(request, reply);

    expect(reply.statusCode).toBe(401);
    expect(request.auth).toBeUndefined();
  });
});
