/**
 * @file outboxAdminRoutes.ts
 * @description Admin endpoints for managing OutboxDeadLetter records.
 *   Provides list, retry, and resolve operations. Retry path is transactional
 *   (DLQ resolution + outbox re-insertion roll back together) so a partial
 *   failure cannot leave the DLQ marked resolved while the event is missing
 *   from the outbox, or vice versa.
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import type { Prisma, PrismaClient } from "@infra/prisma";
import { withGucBoundTransaction } from "@infra/prisma/extensions/tenantGuc.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { getAmbientGucScope } from "../security/tenantContext.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { TOKENS } from "../infrastructure/container/types.js";

/**
 * The client Prisma hands an interactive transaction. Named here because this file
 * resolves its client from the container inside a Fastify handler, where the callback's
 * parameter is not contextually typed from the client argument the way a repository
 * method's is.
 */
type TransactionClient = Prisma.TransactionClient;

export const outboxAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const preHandler = [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)];

  // GET /api/admin/outbox/dead-letter — paginated list
  fastify.get(
    "/admin/outbox/dead-letter",
    { preHandler, schema: { tags: ["Outbox DLQ"] } },
    async (request, reply) => {
      const prisma = fastify.container!.resolve<PrismaClient>(TOKENS.PrismaClient);
      const query = request.query as { page?: string; limit?: string };
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

      const [items, total] = await Promise.all([
        prisma.outboxDeadLetter.findMany({
          where: { resolvedAt: null },
          orderBy: { archivedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.outboxDeadLetter.count({ where: { resolvedAt: null } }),
      ]);

      return reply.send({ ok: true, data: { items, total, page, limit } });
    }
  );

  // POST /api/admin/outbox/dead-letter/:id/retry — re-insert into OutboxEvent
  fastify.post(
    "/admin/outbox/dead-letter/:id/retry",
    { preHandler, schema: { tags: ["Outbox DLQ"] } },
    async (request, reply) => {
      const prisma = fastify.container!.resolve<PrismaClient>(TOKENS.PrismaClient);
      const { id } = request.params as { id: string };
      const dlqEntry = await prisma.outboxDeadLetter.findUnique({ where: { id } });
      if (!dlqEntry) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      // Atomic: re-create outbox event AND mark DLQ resolved together. If
      // either side fails, both roll back — protects against the case where
      // the DLQ is marked resolved but the event never re-enters the relay.
      await withGucBoundTransaction(prisma, getAmbientGucScope(), async (tx: TransactionClient) => {
        await tx.outboxEvent.create({
          data: {
            eventType: dlqEntry.eventType,
            aggregateId: dlqEntry.aggregateId,
            aggregateType: dlqEntry.aggregateType,
            payload: dlqEntry.payload as object,
            version: 1,
            occurredAt: new Date(),
            retryCount: 0,
            maxRetries: 5,
            nextRetryAt: new Date(),
          },
        });
        await tx.outboxDeadLetter.update({
          where: { id },
          data: {
            resolvedAt: new Date(),
            resolvedBy: request.auth?.user?.id ?? "system",
          },
        });
      });

      return reply.send({ ok: true });
    }
  );

  // POST /api/admin/outbox/dead-letter/:id/resolve — mark as resolved without retry
  fastify.post(
    "/admin/outbox/dead-letter/:id/resolve",
    { preHandler, schema: { tags: ["Outbox DLQ"] } },
    async (request, reply) => {
      const prisma = fastify.container!.resolve<PrismaClient>(TOKENS.PrismaClient);
      const { id } = request.params as { id: string };
      const dlqEntry = await prisma.outboxDeadLetter.findUnique({ where: { id } });
      if (!dlqEntry) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      await prisma.outboxDeadLetter.update({
        where: { id },
        data: {
          resolvedAt: new Date(),
          resolvedBy: request.auth?.user?.id ?? "system",
        },
      });

      return reply.send({ ok: true });
    }
  );
};
