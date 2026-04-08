/**
 * @file schedulingClientRoutes.ts
 * @description Client-facing scheduling endpoints for slot management,
 *              optimal posting times, and scheduling rules.
 * @layer infrastructure
 */
import { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { SchedulingSlotRouteHandler } from "../admin/SchedulingSlotHandlers.js";
import { TOKENS } from "../infrastructure/container/types.js";

export const schedulingClientRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const slotHandler = new SchedulingSlotRouteHandler(prisma);

  fastify.get(
    "/api/scheduling/slots",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Scheduling"], summary: "Get scheduling slots" },
    },
    async (request, reply) => slotHandler.getSchedulingSlots(request, reply)
  );

  fastify.get(
    "/api/analytics/optimal-times",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Scheduling"], summary: "Get optimal posting times" },
    },
    async (request, reply) => slotHandler.getOptimalPostingTimes(request, reply)
  );

  fastify.get(
    "/api/scheduling/rules",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Scheduling"], summary: "Get scheduling rules" },
    },
    async (request, reply) => slotHandler.getSchedulingRules(request, reply)
  );

  fastify.post(
    "/api/scheduling/slots",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Scheduling"], summary: "Create schedule slot" },
    },
    async (request, reply) => slotHandler.createScheduleSlot(request, reply)
  );

  fastify.post(
    "/api/scheduling/slots/bulk",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Scheduling"], summary: "Bulk create schedule slots" },
    },
    async (request, reply) => slotHandler.bulkCreateScheduleSlots(request, reply)
  );
};
