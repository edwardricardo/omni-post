/**
 * @file analyticsRoutes.ts
 * @description Registers analytics dashboard and compliance management endpoints for the admin panel.
 * @layer infrastructure
 */
import { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { AnalyticsRouteHandler } from "./AnalyticsHandlers.js";
import { AnalyticsAccountHandler } from "./AnalyticsAccountHandlers.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { TOKENS } from "../infrastructure/container/types.js";

/**
 * Analytics Routes Plugin
 * Registers all analytics dashboard and compliance endpoints with authentication
 */
export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const complianceService = container.resolve<
    import("@core/compliance/ComplianceService.js").ComplianceService
  >(TOKENS.ComplianceService);
  const handler = new AnalyticsRouteHandler(prisma, complianceService);

  // GET /api/admin/analytics/metrics - Analytics dashboard KPIs
  fastify.get(
    "/admin/analytics/metrics",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ANALYTICS_READ)],
      schema: { tags: ["Admin Analytics"], summary: "Get analytics dashboard KPIs" },
    },
    async (request, reply) => handler.getAnalyticsMetrics(request, reply)
  );

  // GET /api/admin/compliance/metrics - Compliance status overview
  fastify.get(
    "/admin/compliance/metrics",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.AUDIT_READ)],
      schema: { tags: ["Admin Analytics"], summary: "Get compliance metrics" },
    },
    async (request, reply) => handler.getComplianceMetrics(request, reply)
  );

  // GET /api/admin/compliance/audit-logs - Fetch compliance audit logs
  fastify.get(
    "/admin/compliance/audit-logs",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.AUDIT_READ)],
      schema: { tags: ["Admin Analytics"], summary: "Get compliance audit logs" },
    },
    async (request, reply) => handler.getComplianceAuditLogs(request, reply)
  );

  // GET /api/admin/compliance/gdpr - GDPR compliance data
  fastify.get(
    "/admin/compliance/gdpr",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.AUDIT_READ)],
      schema: { tags: ["Admin Analytics"], summary: "Get GDPR compliance data" },
    },
    async (request, reply) => handler.getGdprData(request, reply)
  );

  // PUT /admin/accounts/:id/settings - Update Account model (trial, maxProjects, billing)
  // Separate from PUT /admin/accounts/:id which updates AdminUser in accountLifecycleRoutes
  const accountHandler = new AnalyticsAccountHandler(prisma);
  fastify.put(
    "/admin/accounts/:id/settings",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
      schema: { tags: ["Admin Analytics"], summary: "Update account settings (trial, billing)" },
    },
    async (request, reply) => accountHandler.updateAccount(request, reply)
  );
};
