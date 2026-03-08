// ✅ Phase 6.2: Migrated to BaseRouteHandler Pattern
// ✅ DI: Resolves AuditService from container (no singleton import)
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  BaseRouteHandler,
  type RouteContext,
  IdSchema,
  exportToCSV,
  generateCSVFilename,
  type ColumnDefinition,
} from "@packages/api-common";
import type { AuditService } from "./auditService.js";
import { authenticateMiddleware, requireAdmin, requireSuperAdmin } from "../auth/authMiddleware.js";
import { SecureSchemas } from "../security/inputValidation.js";
import { TOKENS } from "../infrastructure/container/types.js";

// ✅ Zod schemas for validation
const AuditLogsQuerySchema = z.object({
  query: z.object({
    userId: IdSchema.optional(),
    action: z.string().optional(),
    resource: z.string().optional(),
    resourceId: z.string().optional(),
    success: z.boolean().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.coerce.number().min(1).max(1000).default(50),
    offset: z.coerce.number().min(0).default(0),
  }),
});

const AuditStatsQuerySchema = z.object({
  query: z.object({
    userId: IdSchema.optional(),
    action: z.string().optional(),
    resource: z.string().optional(),
    resourceId: z.string().optional(),
    success: z.boolean().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),
});

const UserLogsSchema = z.object({
  params: z.object({
    userId: IdSchema,
  }),
  query: z.object({
    limit: z.coerce.number().min(1).max(1000).default(50),
    offset: z.coerce.number().min(0).default(0),
  }),
});

const ResourceLogsSchema = z.object({
  params: z.object({
    resource: z.string(),
  }),
  query: z.object({
    resourceId: z.string().optional(),
    limit: z.coerce.number().min(1).max(1000).default(50),
    offset: z.coerce.number().min(0).default(0),
  }),
});

const CreateAuditLogSchema = z.object({
  body: z.object({
    userId: IdSchema.optional(),
    action: SecureSchemas.userName,
    resource: z.string().optional(),
    resourceId: z.string().optional(),
    details: z.record(z.string(), z.any()).optional(),
    success: z.boolean().default(true),
    error: z.string().optional(),
  }),
});

const CleanupAuditLogsSchema = z.object({
  body: z.object({
    retentionDays: z.coerce.number().min(1).max(3650).default(90),
  }),
});

const MyLogsQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
  }),
});

const ExportAuditLogsSchema = z.object({
  query: z.object({
    format: z.enum(["json", "csv"]).default("json"),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    userId: IdSchema.optional(),
    resource: z.string().optional(),
  }),
});

// ✅ BaseRouteHandler implementation
class AuditRouteHandler extends BaseRouteHandler {
  protected routeName = "audit";

  constructor(private readonly auditService: AuditService) {
    super();
  }

  async getAuditLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AuditLogsQuerySchema>>(ctx, {
      query: AuditLogsQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const query = validated.value.query;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;

    const filters = {
      ...(query.userId && { userId: query.userId }),
      ...(query.action && { action: query.action }),
      ...(query.resource && { resource: query.resource }),
      ...(query.resourceId && { resourceId: query.resourceId }),
      ...(query.success !== undefined && { success: query.success }),
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      limit: query.limit,
      offset: query.offset,
    };

    const result = await this.auditService.getLogs(filters);

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to retrieve audit logs");
    }

    this.logInfo(ctx, "Audit logs retrieved", { count: result.value.length, filters });
    return this.sendSuccess(ctx, { logs: result.value, filters });
  }

  async getAuditStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AuditStatsQuerySchema>>(ctx, {
      query: AuditStatsQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const query = validated.value.query;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;

    const filters = {
      ...(query.userId && { userId: query.userId }),
      ...(query.action && { action: query.action }),
      ...(query.resource && { resource: query.resource }),
      ...(query.resourceId && { resourceId: query.resourceId }),
      ...(query.success !== undefined && { success: query.success }),
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
    };

    const result = await this.auditService.getStats(filters);

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to retrieve audit statistics");
    }

    return this.sendSuccess(ctx, { stats: result.value, filters });
  }

  async getUserLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof UserLogsSchema>>(ctx, {
      params: UserLogsSchema.shape.params,
      query: UserLogsSchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const result = await this.auditService.getUserLogs(
      validated.value.params.userId,
      validated.value.query.limit,
      validated.value.query.offset
    );

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to retrieve user audit logs");
    }

    return this.sendSuccess(ctx, {
      logs: result.value,
      userId: validated.value.params.userId,
    });
  }

  async getResourceLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof ResourceLogsSchema>>(ctx, {
      params: ResourceLogsSchema.shape.params,
      query: ResourceLogsSchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const result = await this.auditService.getResourceLogs(
      validated.value.params.resource,
      validated.value.query.resourceId,
      validated.value.query.limit,
      validated.value.query.offset
    );

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to retrieve resource audit logs");
    }

    return this.sendSuccess(ctx, {
      logs: result.value,
      resource: validated.value.params.resource,
      resourceId: validated.value.query.resourceId,
    });
  }

  async createAuditLog(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof CreateAuditLogSchema>>(ctx, {
      body: CreateAuditLogSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = validated.value.body;
    const userAgent = request.headers["user-agent"];

    const result = await this.auditService.log({
      ...(body.userId && { userId: body.userId }),
      action: body.action,
      ...(body.resource && { resource: body.resource }),
      ...(body.resourceId && { resourceId: body.resourceId }),
      ...(body.details && { details: body.details }),
      ipAddress: request.ip,
      ...(userAgent && { userAgent }),
      success: body.success,
      ...(body.error && { error: body.error }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to create audit log");
    }

    this.logInfo(ctx, "Manual audit log created", { action: body.action });
    return this.sendSuccess(ctx, { log: result.value }, 201);
  }

  async cleanupAuditLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof CleanupAuditLogsSchema>>(ctx, {
      body: CleanupAuditLogsSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const retentionDays = validated.value.body.retentionDays;
    const result = await this.auditService.cleanup(retentionDays);

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to cleanup audit logs");
    }

    this.logInfo(ctx, "Audit logs cleaned up", {
      deletedCount: result.value,
      retentionDays,
    });
    return this.sendSuccess(ctx, {
      message: `Cleaned up ${result.value} audit logs older than ${retentionDays} days`,
      deletedCount: result.value,
      retentionDays,
    });
  }

  async getMyLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.user?.id;
    if (!userId) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const validated = await this.validateRequest<z.infer<typeof MyLogsQuerySchema>>(ctx, {
      query: MyLogsQuerySchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const result = await this.auditService.getUserLogs(
      userId,
      validated.value.query.limit,
      validated.value.query.offset
    );

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to retrieve your audit logs");
    }

    return this.sendSuccess(ctx, { logs: result.value });
  }

  async exportAuditLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof ExportAuditLogsSchema>>(ctx, {
      query: ExportAuditLogsSchema.shape.query,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const query = validated.value.query;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;

    const filters = {
      ...(query.userId && { userId: query.userId }),
      ...(query.resource && { resource: query.resource }),
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      limit: 10000, // Large limit for export
    };

    const result = await this.auditService.getLogs(filters);

    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to export audit logs");
    }

    const logs = result.value;
    const format = query.format;

    if (format === "csv") {
      // ✅ Use RFC 4180 compliant CSV export utility
      const columns: ColumnDefinition<(typeof logs)[0]>[] = [
        { key: "createdAt", header: "Timestamp", format: (date) => date.toISOString() },
        { key: "user.email", header: "User Email" },
        { key: "action", header: "Action" },
        { key: "resource", header: "Resource" },
        { key: "resourceId", header: "Resource ID" },
        { key: "success", header: "Success", format: (val) => String(val) },
        { key: "ipAddress", header: "IP Address" },
        { key: "userAgent", header: "User Agent" },
        { key: "error", header: "Error" },
      ];

      const csv = exportToCSV(logs, columns, {
        preventInjection: true,
        lineEnding: "CRLF",
      });

      const filename = generateCSVFilename("audit-logs");

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);

      this.logInfo(ctx, "Audit logs exported as CSV", {
        count: logs.length,
        filters,
      });
      return reply.send(csv);
    } else {
      // JSON format
      const filename = `audit-logs-${new Date().toISOString().split("T")[0]}.json`;

      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);

      this.logInfo(ctx, "Audit logs exported as JSON", {
        count: logs.length,
        filters,
      });
      return reply.send({
        export_date: new Date().toISOString(),
        filters,
        total_records: logs.length,
        logs,
      });
    }
  }
}

// ✅ PROPER Fastify v5.6.1 Plugin Implementation
const auditRoutes: FastifyPluginAsync = async (fastify) => {
  const auditService = fastify.container!.resolve<AuditService>(TOKENS.AuditService);
  const handler = new AuditRouteHandler(auditService);

  // ✅ Get audit logs with filtering
  fastify.get(
    "/admin/audit/logs",
    { preHandler: [authenticateMiddleware, requireAdmin] },
    async (request, reply) => handler.getAuditLogs(request, reply)
  );

  // ✅ Get audit log statistics
  fastify.get(
    "/admin/audit/stats",
    { preHandler: [authenticateMiddleware, requireAdmin] },
    async (request, reply) => handler.getAuditStats(request, reply)
  );

  // ✅ Get audit logs for a specific user
  fastify.get(
    "/admin/audit/users/:userId/logs",
    { preHandler: [authenticateMiddleware, requireAdmin] },
    async (request, reply) => handler.getUserLogs(request, reply)
  );

  // ✅ Get audit logs for a specific resource
  fastify.get(
    "/admin/audit/resources/:resource/logs",
    { preHandler: [authenticateMiddleware, requireAdmin] },
    async (request, reply) => handler.getResourceLogs(request, reply)
  );

  // ✅ Manual audit log creation (for special cases)
  fastify.post(
    "/admin/audit/logs",
    { preHandler: [authenticateMiddleware, requireSuperAdmin] },
    async (request, reply) => handler.createAuditLog(request, reply)
  );

  // ✅ Cleanup old audit logs (data retention)
  fastify.post(
    "/admin/audit/cleanup",
    { preHandler: [authenticateMiddleware, requireSuperAdmin] },
    async (request, reply) => handler.cleanupAuditLogs(request, reply)
  );

  // ✅ Get current user's audit logs (self-service)
  fastify.get(
    "/admin/audit/my-logs",
    { preHandler: [authenticateMiddleware] },
    async (request, reply) => handler.getMyLogs(request, reply)
  );

  // ✅ Export audit logs (for compliance)
  fastify.get(
    "/admin/audit/export",
    { preHandler: [authenticateMiddleware, requireSuperAdmin] },
    async (request, reply) => handler.exportAuditLogs(request, reply)
  );
};

export { auditRoutes };
