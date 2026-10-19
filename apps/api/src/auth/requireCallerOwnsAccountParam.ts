/**
 * @file requireCallerOwnsAccountParam.ts
 * @description The own-account gate of every customer route whose path names an account
 *   (`/accounts/:accountId...`): a Fastify preHandler, behind `requireClientAuth`, that admits a
 *   request only when the path's account is the authenticated customer's own and answers every
 *   other account before any database access. One implementation, shared by the account and the
 *   project route modules.
 *
 *   Nothing below it refuses a foreign account id. `Account` IS the tenant, keyed by `id`, so it
 *   is absent from the Prisma tenant guard's `TENANT_SCOPED_MODELS` and every `account` query
 *   passes the guard untouched; where a route goes on to a guarded model, the guard refuses that
 *   later query as a mismatch the handler answers with 500, while a missing account answers 404 —
 *   so without this gate the status alone told any authenticated customer which ids name a real
 *   tenant, and the unguarded account reads and writes crossed tenants outright.
 * @layer infrastructure
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { IdSchema } from "@packages/api-common";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("caller-account-gate");

const AccountParamsSchema = z.object({
  accountId: IdSchema,
});

/**
 * @function refuse
 * @description Sends a refusal in the route handlers' own error shape, `{ ok: false, error }`,
 *   logged as `BaseRouteHandler.sendError` logs it, and waits for the response to end. Fastify
 *   runs the next hook and the handler unless the response has FINISHED, and an async onSend hook
 *   can hold it open after `send` returns; awaiting the reply, which resolves once the response
 *   ends, keeps a refused request from reaching the handler and its reads.
 * @param request - The refused request.
 * @param reply - The reply the refusal is sent on.
 * @param routeName - The route module named in the log entry.
 * @param statusCode - The status of the refusal.
 * @param message - The refusal's `error` text, also the log message.
 */
async function refuse(
  request: FastifyRequest,
  reply: FastifyReply,
  routeName: string,
  statusCode: 400 | 401 | 404,
  message: string
): Promise<void> {
  logger.error({ route: routeName, method: request.method, url: request.url, message });
  reply.code(statusCode).send({ ok: false, error: message });
  await reply;
}

/**
 * @function requireCallerOwnsAccountParam
 * @description Builds the own-account preHandler for a route module. MUST run after
 *   `requireClientAuth`, which binds `request.customerUser`. It answers 401 when no customer is
 *   bound, 400 when the path's `accountId` is malformed (no account carries such an id, so the 400
 *   discloses nothing), and 404 `Account not found` when the path names any account but the
 *   caller's, logging the attempt with both account ids; otherwise it returns without sending, so
 *   the next hook and the handler run.
 *
 *   The 404 is the route handlers' own not-found answer, the same body byte for byte, so it says
 *   nothing about whether the id names a tenant; a 403 would confirm that it does. Placed before
 *   any grant check (`requireCustomerPermission`), it makes a foreign id answer 404 whatever the
 *   caller holds.
 * @param routeName - The route module the log entries name, as its handler's `routeName`.
 * @returns A Fastify preHandler.
 */
export function requireCallerOwnsAccountParam(routeName: string) {
  return async function callerOwnsAccountParam(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const principal = request.customerUser;
    if (!principal) {
      await refuse(request, reply, routeName, 401, "Authentication required");
      return;
    }

    const params = AccountParamsSchema.safeParse(request.params);
    if (!params.success) {
      await refuse(request, reply, routeName, 400, "Invalid account ID");
      return;
    }

    if (params.data.accountId === principal.accountId) {
      return;
    }

    logger.error({
      route: routeName,
      method: request.method,
      url: request.url,
      principalAccountId: principal.accountId,
      requestedAccountId: params.data.accountId,
      message: "Cross-tenant account access refused",
    });
    await refuse(request, reply, routeName, 404, "Account not found");
  };
}
