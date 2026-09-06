/**
 * @file customerRbacMiddleware.ts
 * @description Fastify preHandler that enforces a customer-side permission check against the
 *   permission snapshot carried on `request.customerUser` (the customer JWT's `permissions`
 *   claim). The customer counterpart to the admin `requirePermission` in `rbacMiddleware.ts`:
 *   the admin factory resolves the RbacService and keys off `request.auth.user.role`, whereas
 *   customer tokens already carry their granted permission strings, so the check is a pure
 *   membership test with no service round-trip.
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Customer permission string constants used by the API's route gates. The full
 * catalog is defined by the customer role seed (`infra/prisma/seed.ts`), which
 * is the source of truth for what each role holds; this object names only the
 * ones a route file gates on, so the wire strings never appear as magic literals
 * in a preHandler.
 *
 * `ACCOUNT_DELETE` (`account:delete`) and `ACCOUNT_MANAGE` (`account:manage`)
 * are the OWNER-only account-lifecycle permissions — the seed grants them to the
 * OWNER role and to no other (MANAGER, MEMBER, VIEWER lack them). They are the
 * gate for destructive and restorative lifecycle actions on account-owned
 * resources.
 */
export const CustomerPermission = {
  /** OWNER-only. Destructive account-lifecycle action (soft delete of account resources). */
  ACCOUNT_DELETE: "account:delete",
  /** OWNER-only. Account management (billing, settings, lifecycle). */
  ACCOUNT_MANAGE: "account:manage",
} as const;

/**
 * @function requireCustomerPermission
 * @description Builds a Fastify preHandler that allows the request only when the authenticated
 *   customer holds AT LEAST ONE of the given permissions (matching the admin `requirePermission`
 *   "any-of" semantics). MUST run AFTER `requireClientAuth`, which populates
 *   `request.customerUser`. Replies 401 when no customer is authenticated and 403 when the
 *   customer holds none of the required permissions; otherwise returns without sending, so the
 *   handler runs.
 * @param permissions - One or more accepted permission strings (any-of).
 * @returns A Fastify preHandler middleware.
 */
export function requireCustomerPermission(...permissions: string[]) {
  return async function customerPermissionMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const customer = request.customerUser;
    if (!customer) {
      // requireClientAuth should have set this; a missing principal here means
      // the gate was wired without auth in front of it. Fail closed.
      await reply.code(401).send({
        ok: false,
        error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication required" },
      });
      return;
    }

    const held = new Set(customer.permissions);
    const allowed = permissions.some((permission) => held.has(permission));

    if (!allowed) {
      await reply.code(403).send({
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message: `Required permission: ${permissions.join(" or ")}`,
        },
      });
    }
  };
}
