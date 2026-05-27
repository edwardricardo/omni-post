/**
 * @file announcementRoutes.ts
 * @description API endpoints for system announcements. Admin endpoints for CRUD,
 *   public endpoint for active announcements (no auth).
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { z } from "zod";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { TOKENS } from "../infrastructure/container/types.js";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  type: z.enum(["INFO", "WARNING", "MAINTENANCE", "CRITICAL"]).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
});

const updateSchema = createSchema.partial();

export const announcementRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container!.resolve<PrismaClient>(TOKENS.PrismaClient);
  const adminPreHandler = [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)];

  // ─── Public: Active Announcements (no auth) ─────────────────────────

  fastify.get(
    "/announcements/active",
    { schema: { tags: ["Announcements"], summary: "Get active announcements (public)" } },
    async (_request, reply) => {
      const now = new Date();
      const announcements = await prisma.systemAnnouncement.findMany({
        where: {
          isActive: true,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          message: true,
          type: true,
          startsAt: true,
          endsAt: true,
        },
      });

      return reply.send({ ok: true, data: announcements });
    }
  );

  // ─── Admin CRUD ─────────────────────────────────────────────────────

  fastify.get(
    "/admin/announcements",
    {
      preHandler: adminPreHandler,
      schema: { tags: ["Announcements"], summary: "List all announcements" },
    },
    async (_request, reply) => {
      const announcements = await prisma.systemAnnouncement.findMany({
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ ok: true, data: announcements });
    }
  );

  fastify.post(
    "/admin/announcements",
    {
      preHandler: adminPreHandler,
      schema: { tags: ["Announcements"], summary: "Create announcement" },
    },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "Invalid input" });
      }
      const adminId = request.auth?.user?.id ?? "system";
      const announcement = await prisma.systemAnnouncement.create({
        data: {
          title: parsed.data.title,
          message: parsed.data.message,
          type: parsed.data.type ?? "INFO",
          startsAt: new Date(parsed.data.startsAt),
          ...(parsed.data.endsAt && { endsAt: new Date(parsed.data.endsAt) }),
          createdBy: adminId,
        },
      });
      return reply.code(201).send({ ok: true, data: announcement });
    }
  );

  fastify.put(
    "/admin/announcements/:id",
    {
      preHandler: adminPreHandler,
      schema: { tags: ["Announcements"], summary: "Update announcement" },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "Invalid input" });
      }

      const data: Record<string, unknown> = {};
      if (parsed.data.title !== undefined) data.title = parsed.data.title;
      if (parsed.data.message !== undefined) data.message = parsed.data.message;
      if (parsed.data.type !== undefined) data.type = parsed.data.type;
      if (parsed.data.startsAt !== undefined) data.startsAt = new Date(parsed.data.startsAt);
      if (parsed.data.endsAt !== undefined) data.endsAt = new Date(parsed.data.endsAt);

      const announcement = await prisma.systemAnnouncement.update({
        where: { id },
        data,
      });
      return reply.send({ ok: true, data: announcement });
    }
  );

  fastify.delete(
    "/admin/announcements/:id",
    {
      preHandler: adminPreHandler,
      schema: { tags: ["Announcements"], summary: "Delete announcement" },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await prisma.systemAnnouncement.delete({ where: { id } });
      return reply.send({ ok: true });
    }
  );
};
