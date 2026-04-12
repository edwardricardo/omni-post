/**
 * @file AnalyticsComplianceHandlers.ts
 * @description Handles compliance audit log and GDPR data endpoints.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { PrismaClient, Prisma } from "@infra/prisma";
import { ComplianceAuditLogsQuerySchema, GdprQuerySchema } from "./analyticsSchemas.js";

/**
 * Analytics Compliance Route Handler
 * Provides compliance audit log queries and GDPR data views
 */
export class AnalyticsComplianceHandler extends BaseRouteHandler {
  protected routeName = "analytics-compliance";

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  /**
   * GET /api/admin/compliance/audit-logs
   * Fetch compliance audit logs with pagination and filters
   */
  async getComplianceAuditLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching compliance audit logs");

    const validated = await this.validateQuery(ctx, ComplianceAuditLogsQuerySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const {
      page,
      limit,
      action,
      resource,
      userId,
      success,
      startDate,
      endDate,
      sortBy,
      sortOrder,
    } = validated.value;

    try {
      const pageNum = page ?? 1;
      const limitNum = limit ?? 20;
      const sortField = sortBy ?? "createdAt";
      const sortDir = sortOrder ?? "desc";

      // Build where clause with conditional filtering
      const whereClause: Prisma.AuditLogWhereInput = {};

      if (action) {
        whereClause.action = action;
      }

      if (resource) {
        whereClause.resource = resource;
      }

      if (userId) {
        whereClause.userId = userId;
      }

      if (success !== undefined) {
        whereClause.success = success;
      }

      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) {
          whereClause.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          whereClause.createdAt.lte = new Date(endDate);
        }
      }

      const total = await this.prisma.auditLog.count({ where: whereClause });
      const offset = (pageNum - 1) * limitNum;

      const orderByClause: Record<string, "asc" | "desc"> = {};
      orderByClause[sortField] = sortDir;

      const logs = await this.prisma.auditLog.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: { select: { name: true } },
            },
          },
        },
        orderBy: orderByClause,
        skip: offset,
        take: limitNum,
      });

      const formattedLogs = logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        user: log.user
          ? {
              id: log.user.id,
              name: log.user.name,
              email: log.user.email,
              role: log.user.role.name,
            }
          : null,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        details: log.details,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        success: log.success,
        error: log.error,
        createdAt: log.createdAt,
      }));

      this.logInfo(ctx, "Compliance audit logs fetched successfully", {
        total,
        page: pageNum,
        limit: limitNum,
        returned: formattedLogs.length,
      });

      return this.sendSuccess(
        ctx,
        this.formatPaginatedResponse(formattedLogs, total, pageNum, limitNum)
      );
    } catch (error) {
      this.logError(ctx, "Failed to fetch compliance audit logs", { error });
      return this.sendError(ctx, 500, "Failed to fetch compliance audit logs");
    }
  }

  /**
   * GET /api/admin/compliance/gdpr
   * GDPR compliance data (data exports, deletion requests)
   */
  async getGdprData(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    this.logInfo(ctx, "Fetching GDPR compliance data");

    const validated = await this.validateQuery(ctx, GdprQuerySchema);
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { accountId, requestType, status, startDate, endDate } = validated.value;

    try {
      const dateFilter =
        startDate && endDate
          ? {
              gte: new Date(startDate),
              lte: new Date(endDate),
            }
          : undefined;

      const whereClause: Prisma.AccountWhereInput = {};

      if (accountId) {
        whereClause.id = accountId;
      }

      if (dateFilter) {
        whereClause.createdAt = dateFilter;
      }

      const accounts = await this.prisma.account.findMany({
        where: whereClause,
        include: {
          projects: {
            select: {
              id: true,
              name: true,
              createdAt: true,
            },
          },
          providerConnections: {
            select: {
              id: true,
              providerId: true,
              providerName: true,
              accountName: true,
              connectedAt: true,
            },
          },
        },
        take: 50,
      });

      const gdprData = accounts.map((account) => ({
        accountId: account.id,
        email: account.email,
        name: account.name,
        createdAt: account.createdAt,
        dataCategories: {
          personalInformation: {
            email: account.email,
            name: account.name,
            createdAt: account.createdAt,
          },
          subscriptionData: {
            maxProjects: account.maxProjects,
            isOnTrial: account.isOnTrial,
            trialStartDate: account.trialStartDate,
            trialEndDate: account.trialEndDate,
          },
          projects: account.projects.length,
          providerConnections: account.providerConnections.length,
        },
        exportable: true,
        deletable: !account.isOnTrial && account.projects.length === 0,
      }));

      const summary = {
        totalDataSubjects: accounts.length,
        exportableAccounts: gdprData.filter((d) => d.exportable).length,
        deletableAccounts: gdprData.filter((d) => d.deletable).length,
        averageProjectsPerAccount:
          accounts.length > 0
            ? accounts.reduce((sum, acc) => sum + acc.projects.length, 0) / accounts.length
            : 0,
        averageConnectionsPerAccount:
          accounts.length > 0
            ? accounts.reduce((sum, acc) => sum + acc.providerConnections.length, 0) /
              accounts.length
            : 0,
      };

      this.logInfo(ctx, "GDPR data fetched successfully", {
        totalDataSubjects: summary.totalDataSubjects,
        accountId,
      });

      return this.sendSuccess(ctx, {
        summary,
        dataSubjects: gdprData,
        requestType: requestType ?? null,
        status: status ?? null,
        generatedAt: new Date(),
      });
    } catch (error) {
      this.logError(ctx, "Failed to fetch GDPR data", { error });
      return this.sendError(ctx, 500, "Failed to fetch GDPR data");
    }
  }
}
