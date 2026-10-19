/**
 * @file adminHoldsPermission.test.ts
 * @description Unit tests for `adminHoldsPermission`, the admin grant check of the admin-or-owner
 *   account and project routes. The route suites pin its two outcomes through real admin tokens
 *   (a SUPPORT admin refused with 403, a SUPER_ADMIN admitted); this suite pins the branch no
 *   route reaches with a real token — a request with no admin principal bound — and that the
 *   service is asked for exactly the permission the caller named.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { Permission } from "@core/domain/auth/Permission.js";
import { adminHoldsPermission } from "../../../src/auth/adminHoldsPermission.js";

const hasAnyPermission = vi.fn<(role: string, permissions: Permission[]) => Promise<boolean>>();
const rbacService = { hasAnyPermission };

/** A request carrying an admin principal of `role`, the shape `requireAdminAuth` binds. */
function adminRequest(role: string): Pick<FastifyRequest, "auth"> {
  return { auth: { user: { role } } } as Pick<FastifyRequest, "auth">;
}

describe("adminHoldsPermission", () => {
  beforeEach(() => {
    hasAnyPermission.mockReset();
  });

  it("returns false without consulting the service when no admin principal is bound", async () => {
    const held = await adminHoldsPermission(rbacService, {}, Permission.ACCOUNT_MANAGE);

    expect(held).toBe(false);
    expect(hasAnyPermission).not.toHaveBeenCalled();
  });

  it("returns false without consulting the service when the admin principal carries no role", async () => {
    const request = { auth: { user: {} } } as Pick<FastifyRequest, "auth">;

    const held = await adminHoldsPermission(rbacService, request, Permission.ACCOUNT_MANAGE);

    expect(held).toBe(false);
    expect(hasAnyPermission).not.toHaveBeenCalled();
  });

  it("returns true when the service grants the named permission to the principal's role", async () => {
    hasAnyPermission.mockResolvedValue(true);

    const held = await adminHoldsPermission(
      rbacService,
      adminRequest("ADMIN"),
      Permission.ACCOUNT_MANAGE
    );

    expect(held).toBe(true);
    expect(hasAnyPermission).toHaveBeenCalledWith("ADMIN", [Permission.ACCOUNT_MANAGE]);
  });

  it("returns false when the service denies the named permission to the principal's role", async () => {
    hasAnyPermission.mockResolvedValue(false);

    const held = await adminHoldsPermission(
      rbacService,
      adminRequest("SUPPORT"),
      Permission.ACCOUNT_MANAGE
    );

    expect(held).toBe(false);
    expect(hasAnyPermission).toHaveBeenCalledWith("SUPPORT", [Permission.ACCOUNT_MANAGE]);
  });
});
