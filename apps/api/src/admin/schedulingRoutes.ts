/**
 * Admin Scheduling Routes
 *
 * Registers scheduling management endpoints for the admin dashboard.
 * Post management (list, cancel, reschedule) is handled by SchedulingPostHandlers;
 * slot and rule management is handled by SchedulingSlotHandlers.
 * Schemas are in schedulingSchemas.ts.
 *
 * @module admin/schedulingRoutes
 */
import { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { SchedulingPostRouteHandler } from "./SchedulingPostHandlers.js";
import { SchedulingSlotRouteHandler } from "./SchedulingSlotHandlers.js";
import { TOKENS } from "../infrastructure/container/types.js";

/**
 * Scheduling Routes Plugin
 * Registers all scheduling management endpoints with authentication
 */
export const schedulingRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const postHandler = new SchedulingPostRouteHandler(prisma);
  const slotHandler = new SchedulingSlotRouteHandler(prisma);

  // All routes require authentication
  const authOptions = { preHandler: [requireAdminAuth] };

  // GET /admin/posts/scheduled - Fetch scheduled posts with filters
  fastify.get("/admin/posts/scheduled", authOptions, async (request, reply) =>
    postHandler.getScheduledPosts(request, reply)
  );

  // POST /admin/posts/:id/cancel - Cancel a scheduled post
  fastify.post("/admin/posts/:id/cancel", authOptions, async (request, reply) =>
    postHandler.cancelScheduledPost(request, reply)
  );

  // POST /admin/posts/:id/reschedule - Reschedule a post to new time
  fastify.post("/admin/posts/:id/reschedule", authOptions, async (request, reply) =>
    postHandler.reschedulePost(request, reply)
  );

  // GET /api/scheduling/slots - Get available schedule slots
  fastify.get("/api/scheduling/slots", authOptions, async (request, reply) =>
    slotHandler.getSchedulingSlots(request, reply)
  );

  // GET /api/analytics/optimal-times - Get optimal posting times
  fastify.get("/api/analytics/optimal-times", authOptions, async (request, reply) =>
    slotHandler.getOptimalPostingTimes(request, reply)
  );

  // GET /api/scheduling/rules - Get scheduling rules/constraints
  fastify.get("/api/scheduling/rules", authOptions, async (request, reply) =>
    slotHandler.getSchedulingRules(request, reply)
  );

  // POST /api/scheduling/slots - Create a new schedule slot
  fastify.post("/api/scheduling/slots", authOptions, async (request, reply) =>
    slotHandler.createScheduleSlot(request, reply)
  );

  // POST /api/scheduling/slots/bulk - Bulk create schedule slots
  fastify.post("/api/scheduling/slots/bulk", authOptions, async (request, reply) =>
    slotHandler.bulkCreateScheduleSlots(request, reply)
  );
};
