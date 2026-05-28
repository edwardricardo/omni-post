/**
 * @file customReportRoutes.ts
 * @description REST API routes for Custom Report Builder.
 *
 *   GET    /api/custom-reports           -> ListCustomReportsQuery
 *   POST   /api/custom-reports           -> CreateCustomReportUseCase
 *   GET    /api/custom-reports/:id       -> GetCustomReportQuery
 *   PATCH  /api/custom-reports/:id       -> UpdateCustomReportUseCase
 *   DELETE /api/custom-reports/:id       -> DeleteCustomReportUseCase
 *   POST   /api/custom-reports/:id/run   -> RunCustomReportQuery
 *   POST   /api/custom-reports/:id/schedules -> ScheduleCustomReportUseCase
 *   GET    /api/reports/schema           -> Returns available metrics, dimensions, presets
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import {
  AVAILABLE_METRICS,
  AVAILABLE_DIMENSIONS,
  DATE_RANGE_PRESETS,
  CHART_TYPES,
  REPORT_FORMATS,
} from "@core/domain/analytics/ReportSchema.js";
import type { CreateCustomReportUseCase } from "@core/custom-reports/CreateCustomReportUseCase.js";
import type { UpdateCustomReportUseCase } from "@core/custom-reports/UpdateCustomReportUseCase.js";
import type { DeleteCustomReportUseCase } from "@core/custom-reports/DeleteCustomReportUseCase.js";
import type { ListCustomReportsQuery } from "@core/custom-reports/ListCustomReportsQuery.js";
import type { GetCustomReportQuery } from "@core/custom-reports/GetCustomReportQuery.js";
import type { RunCustomReportQuery } from "@core/custom-reports/RunCustomReportQuery.js";
import type { ScheduleCustomReportUseCase } from "@core/custom-reports/ScheduleCustomReportUseCase.js";

// ============================================================================
// Schemas
// ============================================================================

const IdParamSchema = z.object({
  id: z.string().min(1),
});

const CreateBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  metrics: z.array(z.string()).min(1),
  dimensions: z.array(z.string()).min(1),
  projectId: z.string().optional(),
  dateRange: z.string().optional(),
  dateRangeStart: z.string().datetime().optional(),
  dateRangeEnd: z.string().datetime().optional(),
  chartType: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
});

const UpdateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  metrics: z.array(z.string()).min(1).optional(),
  dimensions: z.array(z.string()).min(1).optional(),
  dateRange: z.string().optional(),
  dateRangeStart: z.string().datetime().optional(),
  dateRangeEnd: z.string().datetime().optional(),
  chartType: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
});

const ScheduleBodySchema = z.object({
  cronExpression: z.string().min(1),
  timezone: z.string().optional(),
  format: z.string().optional(),
  recipients: z.array(z.string().email()).min(1),
});

// ============================================================================
// Handler
// ============================================================================

class CustomReportRouteHandler extends BaseRouteHandler {
  protected routeName = "custom-reports";

  constructor(
    private readonly createUseCase: CreateCustomReportUseCase,
    private readonly updateUseCase: UpdateCustomReportUseCase,
    private readonly deleteUseCase: DeleteCustomReportUseCase,
    private readonly listQuery: ListCustomReportsQuery,
    private readonly getQuery: GetCustomReportQuery,
    private readonly runQuery: RunCustomReportQuery,
    private readonly scheduleUseCase: ScheduleCustomReportUseCase
  ) {
    super();
  }

  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.listQuery.execute({ accountId });
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const bodyValidation = await this.validateBody(ctx, CreateBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.createUseCase.execute({
      accountId,
      name: body.name,
      metrics: body.metrics,
      dimensions: body.dimensions,
      createdById: accountId,
      ...(body.projectId !== undefined && { projectId: body.projectId }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.dateRange !== undefined && { dateRange: body.dateRange }),
      ...(body.dateRangeStart !== undefined && { dateRangeStart: body.dateRangeStart }),
      ...(body.dateRangeEnd !== undefined && { dateRangeEnd: body.dateRangeEnd }),
      ...(body.chartType !== undefined && { chartType: body.chartType }),
      ...(body.filters !== undefined && { filters: body.filters }),
      ...(body.isShared !== undefined && { isShared: body.isShared }),
    });

    if (!result.ok) {
      const status = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, IdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID");
    }

    const result = await this.getQuery.execute({
      reportId: paramsValidation.value.id,
      accountId,
    });

    if (!result.ok) {
      const status =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 403 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, IdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID");
    }

    const bodyValidation = await this.validateBody(ctx, UpdateBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.updateUseCase.execute({
      reportId: paramsValidation.value.id,
      accountId,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.metrics !== undefined && { metrics: body.metrics }),
      ...(body.dimensions !== undefined && { dimensions: body.dimensions }),
      ...(body.dateRange !== undefined && { dateRange: body.dateRange }),
      ...(body.dateRangeStart !== undefined && { dateRangeStart: body.dateRangeStart }),
      ...(body.dateRangeEnd !== undefined && { dateRangeEnd: body.dateRangeEnd }),
      ...(body.chartType !== undefined && { chartType: body.chartType }),
      ...(body.filters !== undefined && { filters: body.filters }),
      ...(body.isShared !== undefined && { isShared: body.isShared }),
    });

    if (!result.ok) {
      const status =
        result.error.code === "NOT_FOUND"
          ? 404
          : result.error.code === "FORBIDDEN"
            ? 403
            : result.error.code === "VALIDATION_FAILED"
              ? 400
              : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, { updated: true });
  }

  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, IdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID");
    }

    const result = await this.deleteUseCase.execute({
      reportId: paramsValidation.value.id,
      accountId,
    });

    if (!result.ok) {
      const status =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 403 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, { deleted: true });
  }

  async run(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, IdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID");
    }

    const result = await this.runQuery.execute({
      reportId: paramsValidation.value.id,
      accountId,
    });

    if (!result.ok) {
      const status =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 403 : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async schedule(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, IdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID");
    }

    const bodyValidation = await this.validateBody(ctx, ScheduleBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.scheduleUseCase.execute({
      reportId: paramsValidation.value.id,
      accountId,
      cronExpression: body.cronExpression,
      recipients: body.recipients,
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.format !== undefined && { format: body.format }),
    });

    if (!result.ok) {
      const status =
        result.error.code === "NOT_FOUND"
          ? 404
          : result.error.code === "FORBIDDEN"
            ? 403
            : result.error.code === "VALIDATION_FAILED"
              ? 400
              : 500;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  schema(_request: FastifyRequest, reply: FastifyReply): void {
    const ctx: RouteContext = { request: _request, reply };
    this.sendSuccess(ctx, {
      metrics: AVAILABLE_METRICS,
      dimensions: AVAILABLE_DIMENSIONS,
      dateRangePresets: DATE_RANGE_PRESETS,
      chartTypes: CHART_TYPES,
      reportFormats: REPORT_FORMATS,
    });
  }

  /**
   * Extracts accountId from the authenticated request.
   */
  private getAccountId(request: FastifyRequest): string | undefined {
    const user = (request as unknown as Record<string, unknown>).user as
      | { accountId?: string }
      | undefined;
    return user?.accountId;
  }
}

// ============================================================================
// Plugin
// ============================================================================

export const customReportRoutes: FastifyPluginAsync = async (app) => {
  const handler = new CustomReportRouteHandler(
    app.container.resolve<CreateCustomReportUseCase>(TOKENS.CreateCustomReportUseCase),
    app.container.resolve<UpdateCustomReportUseCase>(TOKENS.UpdateCustomReportUseCase),
    app.container.resolve<DeleteCustomReportUseCase>(TOKENS.DeleteCustomReportUseCase),
    app.container.resolve<ListCustomReportsQuery>(TOKENS.ListCustomReportsQuery),
    app.container.resolve<GetCustomReportQuery>(TOKENS.GetCustomReportQuery),
    app.container.resolve<RunCustomReportQuery>(TOKENS.RunCustomReportQuery),
    app.container.resolve<ScheduleCustomReportUseCase>(TOKENS.ScheduleCustomReportUseCase)
  );

  // Schema endpoint (no auth required)
  app.get(
    "/reports/schema",
    {
      schema: {
        tags: ["Custom Reports"],
        summary: "Get available report schema (metrics, dimensions, presets)",
      },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.schema(req, reply)
  );

  // CRUD endpoints
  app.get(
    "/custom-reports",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Custom Reports"], summary: "List custom reports" },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.list(req, reply)
  );

  app.post(
    "/custom-reports",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Custom Reports"], summary: "Create custom report" },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.create(req, reply)
  );

  app.get(
    "/custom-reports/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Custom Reports"], summary: "Get custom report by ID" },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.get(req, reply)
  );

  app.patch(
    "/custom-reports/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Custom Reports"], summary: "Update custom report" },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.update(req, reply)
  );

  app.delete(
    "/custom-reports/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Custom Reports"], summary: "Delete custom report" },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.remove(req, reply)
  );

  app.post(
    "/custom-reports/:id/run",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Custom Reports"], summary: "Execute custom report" },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.run(req, reply)
  );

  app.post(
    "/custom-reports/:id/schedules",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Custom Reports"], summary: "Schedule custom report delivery" },
    },
    (req: FastifyRequest, reply: FastifyReply) => handler.schedule(req, reply)
  );
};
