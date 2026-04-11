/**
 * @file outboxAdminRoutes.ts
 * @description Admin endpoints for managing OutboxDeadLetter records.
 *   Provides list, retry, and resolve operations.
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@infra/prisma";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";

export const outboxAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const preHandler = [requireAdminAuth, requirePermission(Permission.WEBHOOK_MANAGE)];

  // GET /api/admin/outbox/dead-letter — paginated list
  fastify.get(
    "/api/admin/outbox/dead-letter",
    { preHandler, schema: { tags: ["Outbox DLQ"] } },
    async (request, reply) => {
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
    "/api/admin/outbox/dead-letter/:id/retry",
    { preHandler, schema: { tags: ["Outbox DLQ"] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dlqEntry = await prisma.outboxDeadLetter.findUnique({
        where: { id },
      });
      if (!dlqEntry) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      // Re-create outbox event with retryCount=0
      await prisma.outboxEvent.create({
        data: {
          eventType: dlqEntry.eventType,
          aggregateId: dlqEntry.aggregateId,
          aggregateType: "unknown",
          payload: dlqEntry.payload as object,
          version: 1,
          occurredAt: new Date(),
          retryCount: 0,
          maxRetries: 5,
          nextRetryAt: new Date(),
        },
      });

      // Mark DLQ entry as resolved
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

  // POST /api/admin/outbox/dead-letter/:id/resolve — mark as resolved without retry
  fastify.post(
    "/api/admin/outbox/dead-letter/:id/resolve",
    { preHandler, schema: { tags: ["Outbox DLQ"] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dlqEntry = await prisma.outboxDeadLetter.findUnique({
        where: { id },
      });
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
