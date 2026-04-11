/**
 * @file adminBillingRoutes.ts
 * @description Admin endpoints for managing gateway switch events.
 *   Uses requireAdminAuth + requirePermission(BILLING_MANAGE).
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@infra/prisma";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GatewayBillingService } from "./GatewayBillingService.js";
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
    "/api/admin/billing/gateway-switches",
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
      const offset = (page - 1) * limit;

      const where: Record<string, unknown> = status && status !== "ALL" ? { status } : {};

      const [events, total] = await Promise.all([
        prisma.gatewaySwitchEvent.findMany({
          where,
          include: {
            account: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
        }),
        prisma.gatewaySwitchEvent.count({ where }),
      ]);

      // Stat counts
      const [scheduled, pendingCheckout, suspended, completed30d] = await Promise.all([
        prisma.gatewaySwitchEvent.count({
          where: { status: "SCHEDULED" },
        }),
        prisma.gatewaySwitchEvent.count({
          where: { status: "PENDING_CHECKOUT" },
        }),
        prisma.gatewaySwitchEvent.count({
          where: { status: "SUSPENDED" },
        }),
        prisma.gatewaySwitchEvent.count({
          where: {
            status: "COMPLETED",
            completedAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        }),
      ]);

      return reply.send({
        ok: true,
        data: {
          events,
          total,
          page,
          limit,
          stats: { scheduled, pendingCheckout, suspended, completed30d },
        },
      });
    }
  );

  // GET /api/admin/billing/gateway-switches/:id — detail view
  fastify.get(
    "/api/admin/billing/gateway-switches/:id",
    {
      preHandler,
      schema: {
        tags: ["Admin Billing"],
        summary: "Get gateway switch event detail",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const event = await prisma.gatewaySwitchEvent.findUnique({
        where: { id },
        include: {
          account: { select: { id: true, name: true, email: true } },
        },
      });

      if (!event) {
        return reply.code(404).send({ error: "Switch event not found" });
      }

      return reply.send({ ok: true, data: event });
    }
  );

  // POST /api/admin/billing/gateway-switches/:id/extend — extend deadline
  fastify.post(
    "/api/admin/billing/gateway-switches/:id/extend",
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

      const switchEvent = await prisma.gatewaySwitchEvent.findUnique({
        where: { id },
      });
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
    "/api/admin/billing/gateway-switches/:id/force-complete",
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
    "/api/admin/billing/gateway-switches/:id/force-suspend",
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
};
