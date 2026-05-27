/**
 * @file requireClientAuth.ts
 * @description Fastify preHandler middleware that authenticates customer users.
 *   Validates Bearer tokens issued by the customer JWT system and rejects
 *   admin tokens (type !== 'customer').
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyCustomerToken } from "./customerJwt.js";
import { enterTenantContext } from "../security/tenantContext.js";
import { authLogger } from "../lib/logger.js";

/**
 * Shape attached to request.customerUser when authentication succeeds.
 */
export interface CustomerRequestUser {
  id: string;
  accountId: string;
  roleId: string;
  roleName: string;
  /** Permission strings granted by the role at sign time (snapshot from JWT). */
  permissions: readonly string[];
}

/**
 * Extend Fastify request to include the customerUser property.
 */
declare module "fastify" {
  interface FastifyRequest {
    customerUser?: CustomerRequestUser;
  }
}

/**
 * @function requireClientAuth
 * @description Fastify preHandler that validates customer Bearer tokens.
 *   Rejects admin tokens by checking the `type` discriminator.
 */
export async function requireClientAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Authorization token required" });
    }

    const token = authHeader.substring(7);

    if (!token) {
      return reply.code(401).send({ error: "Authorization token required" });
    }

    const payload = verifyCustomerToken(token);

    request.customerUser = {
      id: payload.sub,
      accountId: payload.accountId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions,
    };

    // Bind tenant context for the rest of the async chain (handlers, hooks,
    // Prisma queries). The tenant guard extension (S2.1b) reads this on
    // every query to a tenant-scoped table.
    enterTenantContext({ accountId: payload.accountId });
  } catch (error: unknown) {
    authLogger.warn({ err: error }, "Customer authentication failed");
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}
