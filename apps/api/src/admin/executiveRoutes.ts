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
import { ExecutiveAccountHandler } from "./ExecutiveAccountHandlers.js";
import { requireAdmin } from "./auth/adminAuthMiddleware.js";
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

  // GET /api/admin/executive/metrics - Executive dashboard KPIs
  fastify.get(
    "/api/admin/executive/metrics",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Executive"], summary: "Get executive dashboard KPIs" },
    },
    async (request, reply) => handler.getExecutiveMetrics(request, reply)
  );

  // GET /api/admin/compliance/metrics - Compliance status overview
  fastify.get(
    "/api/admin/compliance/metrics",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Executive"], summary: "Get compliance metrics" },
    },
    async (request, reply) => handler.getComplianceMetrics(request, reply)
  );

  // GET /api/admin/compliance/audit-logs - Fetch compliance audit logs
  fastify.get(
    "/api/admin/compliance/audit-logs",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Executive"], summary: "Get compliance audit logs" },
    },
    async (request, reply) => handler.getComplianceAuditLogs(request, reply)
  );

  // GET /api/admin/compliance/gdpr - GDPR compliance data
  fastify.get(
    "/api/admin/compliance/gdpr",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Executive"], summary: "Get GDPR compliance data" },
    },
    async (request, reply) => handler.getGdprData(request, reply)
  );

  // PUT /admin/accounts/:id/settings - Update Account model (trial, maxProjects, billing)
  // Separate from PUT /admin/accounts/:id which updates AdminUser in accountLifecycleRoutes
  const accountHandler = new ExecutiveAccountHandler(prisma);
  fastify.put(
    "/admin/accounts/:id/settings",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Executive"], summary: "Update account settings (trial, billing)" },
    },
    async (request, reply) => accountHandler.updateAccount(request, reply)
  );
};
