/**
 * @file AnalyticsHandlers.ts
 * @description Facade that re-exports the AnalyticsRouteHandler class composed
 *              from dashboard, compliance, and account sub-handlers.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler } from "../lib/route-handler/index.js";
import type { PrismaClient } from "@infra/prisma";
import type { ComplianceService } from "@core/application/compliance/ComplianceService.js";
import { AnalyticsDashboardHandler } from "./AnalyticsDashboardHandlers.js";
import { AnalyticsComplianceHandler } from "./AnalyticsComplianceHandlers.js";
import { AnalyticsAccountHandler } from "./AnalyticsAccountHandlers.js";

/**
 * Analytics Route Handler
 * Composes dashboard, compliance, and account sub-handlers into a single API
 */
export class AnalyticsRouteHandler extends BaseRouteHandler {
  protected routeName = "analytics";

  private readonly dashboardHandler: AnalyticsDashboardHandler;
  private readonly complianceHandler: AnalyticsComplianceHandler;
  private readonly accountHandler: AnalyticsAccountHandler;

  constructor(prisma: PrismaClient, complianceService?: ComplianceService) {
    super();
    this.dashboardHandler = new AnalyticsDashboardHandler(prisma, complianceService);
    this.complianceHandler = new AnalyticsComplianceHandler(prisma);
    this.accountHandler = new AnalyticsAccountHandler(prisma);
  }

  /** GET /api/admin/analytics/metrics */
  async getAnalyticsMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    return this.dashboardHandler.getAnalyticsMetrics(request, reply);
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
