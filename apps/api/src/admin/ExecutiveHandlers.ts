/**
 * Admin Executive Handlers - Facade
 *
 * Re-exports the ExecutiveRouteHandler class composed from three sub-handlers:
 * - ExecutiveDashboardHandler  (dashboard/overview KPIs)
 * - ExecutiveComplianceHandler (audit logs, GDPR data)
 * - ExecutiveAccountHandler    (account management)
 *
 * External consumers continue importing ExecutiveRouteHandler from this file.
 *
 * @module admin/ExecutiveHandlers
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler } from "@packages/api-common";
import type { PrismaClient } from "@infra/prisma";
import { ExecutiveDashboardHandler } from "./ExecutiveDashboardHandlers.js";
import { ExecutiveComplianceHandler } from "./ExecutiveComplianceHandlers.js";
import { ExecutiveAccountHandler } from "./ExecutiveAccountHandlers.js";

/**
 * Executive Route Handler
 * Composes dashboard, compliance, and account sub-handlers into a single API
 */
export class ExecutiveRouteHandler extends BaseRouteHandler {
  protected routeName = "executive";

  private readonly dashboardHandler: ExecutiveDashboardHandler;
  private readonly complianceHandler: ExecutiveComplianceHandler;
  private readonly accountHandler: ExecutiveAccountHandler;

  constructor(prisma: PrismaClient) {
    super();
    this.dashboardHandler = new ExecutiveDashboardHandler(prisma);
    this.complianceHandler = new ExecutiveComplianceHandler(prisma);
    this.accountHandler = new ExecutiveAccountHandler(prisma);
  }

  /** GET /api/admin/executive/metrics */
  async getExecutiveMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.dashboardHandler.getExecutiveMetrics(request, reply);
  }

  /** GET /api/admin/compliance/metrics */
  async getComplianceMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.dashboardHandler.getComplianceMetrics(request, reply);
  }

  /** GET /api/admin/compliance/audit-logs */
  async getComplianceAuditLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.complianceHandler.getComplianceAuditLogs(request, reply);
  }

  /** GET /api/admin/compliance/gdpr */
  async getGdprData(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.complianceHandler.getGdprData(request, reply);
  }

  /** PUT /admin/accounts/:id */
  async updateAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.accountHandler.updateAccount(request, reply);
  }
}
