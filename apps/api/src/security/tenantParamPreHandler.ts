/**
 * @file tenantParamPreHandler.ts
 * @description Fastify preHandler factory that establishes the tenant context at a
 *   pre-authentication route boundary whose tenant is carried in the URL path.
 *   The account identifier is read from a named route param and bound via
 *   `enterTenantContext`, so every downstream handler and Prisma query on the
 *   guarded client inherits the tenant scope. Fails closed with 400 when the
 *   param is missing, so no enrolled-model query can run context-less behind a
 *   public route.
 * @layer infrastructure
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { enterTenantContext } from "./tenantContext.js";

/**
 * @function makeTenantParamPreHandler
 * @description Builds a Fastify preHandler that binds the tenant context from a
 *   URL path param. The bound scope is the account whose identifier appears at
 *   `request.params[paramName]`. Public SSO routes carry it as `accountId`; the
 *   tenant-health route carries it as `tenantId`, which is the same account id
 *   (the health monitor resolves projects by `accountId`), so both map onto the
 *   single `TenantContext.accountId` field.
 *
 *   `enterWith` semantics match the HTTP one-tenant-per-request model: the scope
 *   is set once at the boundary and inherited by the rest of the async chain.
 * @param paramName - Name of the route param carrying the account/tenant id.
 * @returns A preHandler that enters the tenant context, or replies 400 when the
 *   param is absent or empty.
 */
export function makeTenantParamPreHandler(
  paramName: string
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function tenantParamPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const params = request.params as Record<string, unknown> | undefined;
    const value = params?.[paramName];

    if (typeof value !== "string" || value.length === 0) {
      await reply.code(400).send({ error: `Missing ${paramName}` });
      return;
    }

    enterTenantContext({ accountId: value });
  };
}
