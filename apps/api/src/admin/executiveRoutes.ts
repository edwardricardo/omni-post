/**
 * Admin Executive Routes
 *
 * Registers executive dashboard and compliance management endpoints for the admin panel.
 * Delegates request handling to ExecutiveRouteHandler; validation schemas are in executiveSchemas.ts.
 *
 * @module admin/executiveRoutes
 */
import { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { ExecutiveRouteHandler } from "./ExecutiveHandlers.js";
import { TOKENS } from "../infrastructure/container/types.js";

/**
 * Executive Routes Plugin
 * Registers all executive dashboard and compliance endpoints with authentication
 */
export const executiveRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const handler = new ExecutiveRouteHandler(prisma);

  // All routes require authentication
  const authOptions = { preHandler: [requireAdminAuth] };

  // GET /api/admin/executive/metrics - Executive dashboard KPIs
  fastify.get("/api/admin/executive/metrics", authOptions, async (request, reply) =>
    handler.getExecutiveMetrics(request, reply)
  );

  // GET /api/admin/compliance/metrics - Compliance status overview
  fastify.get("/api/admin/compliance/metrics", authOptions, async (request, reply) =>
    handler.getComplianceMetrics(request, reply)
  );

  // GET /api/admin/compliance/audit-logs - Fetch compliance audit logs
  fastify.get("/api/admin/compliance/audit-logs", authOptions, async (request, reply) =>
    handler.getComplianceAuditLogs(request, reply)
  );

  // GET /api/admin/compliance/gdpr - GDPR compliance data
  fastify.get("/api/admin/compliance/gdpr", authOptions, async (request, reply) =>
    handler.getGdprData(request, reply)
  );

  // Note: PUT /admin/accounts/:id is handled by accountLifecycleRoutes to avoid duplication
};
