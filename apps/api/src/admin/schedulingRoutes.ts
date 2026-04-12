/**
 * @file schedulingRoutes.ts
 * @description Admin scheduling routes for post management operations:
 *              list scheduled posts, cancel, and reschedule.
 * @layer infrastructure
 */
import { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { SchedulingPostRouteHandler } from "./SchedulingPostHandlers.js";
import { TOKENS } from "../infrastructure/container/types.js";

export const schedulingRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const postHandler = new SchedulingPostRouteHandler(prisma);

  fastify.get(
    "/admin/posts/scheduled",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.POST_MANAGE)],
      schema: { tags: ["Admin Scheduling"], summary: "Get scheduled posts" },
    },
    async (request, reply) => postHandler.getScheduledPosts(request, reply)
  );

  fastify.post(
    "/admin/posts/:id/cancel",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.POST_MANAGE)],
      schema: { tags: ["Admin Scheduling"], summary: "Cancel scheduled post" },
    },
    async (request, reply) => postHandler.cancelScheduledPost(request, reply)
  );

  fastify.post(
    "/admin/posts/:id/reschedule",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.POST_MANAGE)],
      schema: { tags: ["Admin Scheduling"], summary: "Reschedule post" },
    },
    async (request, reply) => postHandler.reschedulePost(request, reply)
  );
};
