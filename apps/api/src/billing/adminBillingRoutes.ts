/**
 * @file adminBillingRoutes.ts
 * @description Admin endpoints for managing gateway switch events.
 *   Uses requireAdminAuth + requirePermission(BILLING_MANAGE).
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GatewayBillingService } from "@core/billing/GatewayBillingService.js";
import { gatewaySwitchFiltersSchema, extendSwitchDeadlineSchema } from "./gatewaySwitchSchemas.js";

export const adminBillingRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const gatewayService = container.resolve<GatewayBillingService>(TOKENS.GatewayBillingService);

  const preHandler = [requireAdminAuth, requirePermission(Permission.BILLING_MANAGE)];

  // GET /api/admin/billing/gateway-switches — list with pagination/filtering
  fastify.get(
    "/admin/billing/gateway-switches",
    {
      preHandler,
      schema: {
        tags: ["Admin Billing"],
        summary: "List gateway switch events",
      },
    },
    async (request, reply) => {
      const parsed = gatewaySwitchFiltersSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      const { status, page, limit } = parsed.data;
      const data = await gatewayService.listGatewaySwitches({
        status,
        page,
        limit,
      });
      return reply.send({ ok: true, data });
    }
  );

  // GET /api/admin/billing/gateway-switches/:id — detail view
  fastify.get(
    "/admin/billing/gateway-switches/:id",
    {
      preHandler,
      schema: {
        tags: ["Admin Billing"],
        summary: "Get gateway switch event detail",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const event = await gatewayService.getGatewaySwitchById(id);

      if (!event) {
        return reply.code(404).send({ error: "Switch event not found" });
      }

      return reply.send({ ok: true, data: event });
    }
  );

  // POST /api/admin/billing/gateway-switches/:id/extend — extend deadline
  fastify.post(
    "/admin/billing/gateway-switches/:id/extend",
    {
      preHandler,
      schema: {
        tags: ["Admin Billing"],
        summary: "Extend gateway switch checkout deadline",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = extendSwitchDeadlineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      const switchEvent = await gatewayService.getGatewaySwitchById(id);
      if (!switchEvent) {
        return reply.code(404).send({ error: "Switch event not found" });
      }

      const adminUserId = request.auth?.user?.id ?? "system";
      const result = await gatewayService.extendSwitchDeadline(
        switchEvent.accountId,
        parsed.data.extraHours,
        adminUserId
      );

      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }

      return reply.send({ ok: true, data: result.value });
    }
  );

  // POST /api/admin/billing/gateway-switches/:id/force-complete
  fastify.post(
    "/admin/billing/gateway-switches/:id/force-complete",
    {
      preHandler,
      schema: {
        tags: ["Admin Billing"],
        summary: "Force-complete a gateway switch",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminUserId = request.auth?.user?.id ?? "system";

      const result = await gatewayService.forceComplete(id, adminUserId);

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          SWITCH_NOT_FOUND: 404,
          INVALID_STATUS: 400,
        };
        return reply.code(statusMap[result.error] ?? 500).send({ error: result.error });
      }

      return reply.send({ ok: true });
    }
  );

  // POST /api/admin/billing/gateway-switches/:id/force-suspend
  fastify.post(
    "/admin/billing/gateway-switches/:id/force-suspend",
    {
      preHandler,
      schema: {
        tags: ["Admin Billing"],
        summary: "Force-suspend a gateway switch",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminUserId = request.auth?.user?.id ?? "system";

      const result = await gatewayService.forceSuspend(id, adminUserId);

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          SWITCH_NOT_FOUND: 404,
          INVALID_STATUS: 400,
        };
        return reply.code(statusMap[result.error] ?? 500).send({ error: result.error });
      }

      return reply.send({ ok: true });
    }
  );

  // ─── Admin Invoice List ─────────────────────────────────────────────

  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);

  fastify.get(
    "/admin/billing/invoices",
    {
      preHandler,
      schema: { tags: ["Admin Billing"], summary: "List all invoices (admin)" },
    },
    async (request, reply) => {
      const query = request.query as {
        accountId?: string;
        status?: string;
        page?: string;
        limit?: string;
      };
      const page = Math.max(1, parseInt(query.page ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10)));
      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = {};
      if (query.accountId) where.accountId = query.accountId;
      if (query.status) where.status = query.status;

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            account: { select: { id: true, name: true, email: true } },
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      return reply.send({ ok: true, data: { invoices, total, page, limit } });
    }
  );
};
