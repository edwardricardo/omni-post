/**
 * @file reportRoutes.ts
 * @description Fastify plugin registering Scheduled Report management endpoints.
 *   Resolves use cases and queries from DI and delegates to ReportRouteHandler.
 *   Supports CRUD operations and manual report generation triggering.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";

// Use case / query types (type-only imports)
import type { CreateScheduledReportUseCase } from "../application/reports/CreateScheduledReportUseCase.js";
import type { UpdateScheduledReportUseCase } from "../application/reports/UpdateScheduledReportUseCase.js";
import type { DeleteScheduledReportUseCase } from "../application/reports/DeleteScheduledReportUseCase.js";
import type { ListScheduledReportsQuery } from "../application/reports/ListScheduledReportsQuery.js";
import type { GenerateReportUseCase } from "../application/reports/GenerateReportUseCase.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const UuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const CreateReportBodySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1, { message: "Report name must not be empty" }).max(200),
  cronSchedule: z.string().min(1, { message: "Cron schedule is required" }),
  format: z.enum(["CSV", "JSON"]).optional(),
  recipients: z.array(z.string().email()).min(1, { message: "At least one recipient is required" }),
  filters: z.record(z.string(), z.unknown()).optional(),
});

const UpdateReportBodySchema = z.object({
  cronSchedule: z.string().min(1).optional(),
  recipients: z.array(z.string().email()).min(1).optional(),
  isActive: z.boolean().optional(),
});

const ListReportsQuerySchema = z.object({
  projectId: z.string().uuid(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

/**
 * @class ReportRouteHandler
 * @description Handles all Scheduled Report HTTP endpoints, delegating business
 *   logic to the respective use cases and queries resolved from DI.
 */
class ReportRouteHandler extends BaseRouteHandler {
  protected routeName = "reports";

  constructor(
    private readonly createReportUseCase: CreateScheduledReportUseCase,
    private readonly updateReportUseCase: UpdateScheduledReportUseCase,
    private readonly deleteReportUseCase: DeleteScheduledReportUseCase,
    private readonly listReportsQuery: ListScheduledReportsQuery,
    private readonly generateReportUseCase: GenerateReportUseCase
  ) {
    super();
  }

  /**
   * @method mapErrorCode
   * @description Maps UseCaseError.code to an HTTP status code.
   */
  private mapErrorCode(code: string): number {
    const mapping: Record<string, number> = {
      VALIDATION_FAILED: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    };
    return mapping[code] ?? 500;
  }

  // --------------------------------------------------------------------------
  // Command endpoints
  // --------------------------------------------------------------------------

  /**
   * @method createReport
   * @description POST /api/reports -- Creates a new scheduled report.
   */
  async createReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateBody(ctx, CreateReportBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value;

    const result = await this.createReportUseCase.execute({
      projectId: body.projectId,
      name: body.name,
      cronSchedule: body.cronSchedule,
      recipients: body.recipients,
      ...(body.format !== undefined && { format: body.format }),
      ...(body.filters !== undefined && { filters: body.filters }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method updateReport
   * @description PATCH /api/reports/:id -- Updates a scheduled report.
   */
  async updateReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID format");
    }

    const bodyValidation = await this.validateBody(ctx, UpdateReportBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value;

    const result = await this.updateReportUseCase.execute({
      reportId: paramsValidation.value.id,
      ...(body.cronSchedule !== undefined && { cronSchedule: body.cronSchedule }),
      ...(body.recipients !== undefined && { recipients: body.recipients }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { reportId: paramsValidation.value.id, status: "updated" });
  }

  /**
   * @method deleteReport
   * @description DELETE /api/reports/:id -- Deletes a scheduled report.
   */
  async deleteReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.deleteReportUseCase.execute({
      reportId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { reportId: paramsValidation.value.id, status: "deleted" });
  }

  /**
   * @method generateReport
   * @description POST /api/reports/:id/generate -- Manually triggers report generation.
   */
  async generateReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.generateReportUseCase.execute({
      reportId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  // --------------------------------------------------------------------------
  // Query endpoints
  // --------------------------------------------------------------------------

  /**
   * @method listReports
   * @description GET /api/reports -- Lists scheduled reports for a project.
   */
  async listReports(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const queryValidation = await this.validateQuery(ctx, ListReportsQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.listReportsQuery.execute({
      projectId: queryValidation.value.projectId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getReport
   * @description GET /api/reports/:id -- Gets a single scheduled report.
   */
  async getReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid report ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    // Use the list query to find the specific report by resolving through
    // the repository. We import ScheduledReportRepository type inline.
    const reportRepo = request.server.container.resolve<
      import("../domain/repositories/ScheduledReportRepository.js").ScheduledReportRepository
    >(TOKENS.ScheduledReportRepository);

    const { ScheduledReportId } = await import("../domain/value-objects/EntityId.js");
    const idResult = ScheduledReportId.fromString(paramsValidation.value.id);
    if (!idResult.ok) {
      return this.sendError(ctx, 400, "Invalid report ID");
    }

    const findResult = await reportRepo.findById(idResult.value);
    if (!findResult.ok) {
      return this.sendError(ctx, 404, "Scheduled report not found");
    }

    this.sendSuccess(ctx, findResult.value.toJSON());
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

/**
 * Fastify plugin that registers Scheduled Report routes under /api/reports.
 */
const reportRoutes: FastifyPluginAsync = async (app) => {
  const createReportUseCase = app.container.resolve<CreateScheduledReportUseCase>(
    TOKENS.CreateScheduledReportUseCase
  );
  const updateReportUseCase = app.container.resolve<UpdateScheduledReportUseCase>(
    TOKENS.UpdateScheduledReportUseCase
  );
  const deleteReportUseCase = app.container.resolve<DeleteScheduledReportUseCase>(
    TOKENS.DeleteScheduledReportUseCase
  );
  const listReportsQuery = app.container.resolve<ListScheduledReportsQuery>(
    TOKENS.ListScheduledReportsQuery
  );
  const generateReportUseCase = app.container.resolve<GenerateReportUseCase>(
    TOKENS.GenerateReportUseCase
  );

  const handler = new ReportRouteHandler(
    createReportUseCase,
    updateReportUseCase,
    deleteReportUseCase,
    listReportsQuery,
    generateReportUseCase
  );

  // -- Command routes --

  app.post(
    "/reports",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Reports"], summary: "Create scheduled report" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.createReport(request, reply)
  );

  app.patch(
    "/reports/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Reports"], summary: "Update scheduled report" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.updateReport(request, reply)
  );

  app.delete(
    "/reports/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Reports"], summary: "Delete scheduled report" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.deleteReport(request, reply)
  );

  app.post(
    "/reports/:id/generate",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Reports"], summary: "Generate report manually" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.generateReport(request, reply)
  );

  // -- Query routes --

  app.get(
    "/reports",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Reports"], summary: "List scheduled reports" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listReports(request, reply)
  );

  app.get(
    "/reports/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Reports"], summary: "Get scheduled report by ID" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getReport(request, reply)
  );
};

export { reportRoutes };
