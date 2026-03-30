/**
 * @file customerAuthMiddleware.ts
 * @description Fastify preHandler middleware that authenticates customer users.
 *   Validates Bearer tokens issued by the customer JWT system and rejects
 *   admin tokens (type !== 'customer').
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyCustomerToken } from "./customerJwt.js";
import { authLogger } from "../lib/logger.js";

/**
 * Shape attached to request.customerUser when authentication succeeds.
 */
export interface CustomerRequestUser {
  id: string;
  accountId: string;
  role: string;
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
 * @function customerAuthMiddleware
 * @description Fastify preHandler that validates customer Bearer tokens.
 *   Rejects admin tokens by checking the `type` discriminator.
 */
export async function customerAuthMiddleware(
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
      role: payload.role,
    };
  } catch (error: unknown) {
    authLogger.warn({ err: error }, "Customer authentication failed");
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}
