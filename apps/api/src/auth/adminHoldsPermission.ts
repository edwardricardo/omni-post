/**
 * @file adminHoldsPermission.ts
 * @description The in-handler admin grant check of the "admin-or-owner" routes (restore and
 *   hard-delete of accounts and projects): answers whether the ADMIN principal a request carries
 *   holds a permission, through the same RbacService the `requirePermission` preHandler uses, so
 *   the two cannot drift apart. One implementation, called by every route module that needs it.
 * @layer infrastructure
 */

import type { FastifyRequest } from "fastify";
import type { Permission } from "@core/domain/auth/Permission.js";
import type { RbacService } from "./rbacService.js";

/**
 * @function adminHoldsPermission
 * @description Answers whether the authenticated ADMIN principal on this request holds
 *   `permission`, using the same RbacService the `requirePermission` preHandler uses so the two
 *   cannot drift apart.
 *
 *   It exists as an in-handler check, rather than a preHandler, because the routes that need it
 *   are the "admin-or-owner" surfaces: their preHandler is the composed
 *   `requireCustomerOrAdminAuth`, and stacking `requirePermission` behind it would answer 401 to
 *   every customer — it reads `request.auth` / `request.user`, neither of which a customer token
 *   populates. So the grant is asserted inside the admin BRANCH, where the principal kind is
 *   already known.
 *
 *   Omitting it is not a smaller gate, it is no gate: an admin token by itself only proves the
 *   holder is staff, and every staff role — SUPPORT included — could otherwise reach across
 *   tenants through these endpoints.
 * @param rbacService - The RBAC service that resolves a role's permissions.
 * @param request - The incoming request, whose `request.auth` carries the admin principal.
 * @param permission - The permission the admin's role must grant.
 * @returns True when the principal's role grants `permission`; false when it does not, and false
 *   when no admin principal is bound at all (fail closed), without consulting the service.
 */
export async function adminHoldsPermission(
  rbacService: Pick<RbacService, "hasAnyPermission">,
  request: Pick<FastifyRequest, "auth">,
  permission: Permission
): Promise<boolean> {
  const role = request.auth?.user?.role;
  if (!role) {
    return false;
  }
  return rbacService.hasAnyPermission(role, [permission]);
}
