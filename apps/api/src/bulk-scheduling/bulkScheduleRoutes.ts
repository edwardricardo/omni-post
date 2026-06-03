/**
 * @file bulkScheduleRoutes.ts
 * @description Fastify plugin for the 2-phase bulk CSV scheduling API.
 *   POST /bulk-scheduling/parse  — stateless CSV parse; returns row preview.
 *   POST /bulk-scheduling/confirm — confirm; persists batch + outbox events atomically.
 *   GET  /bulk-scheduling/batches/:batchId — per-row manifest poll (unchanged).
 *   POST /bulk-scheduling/imports — 410 Gone (retired single-step endpoint).
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { ParseBulkScheduleCsvUseCase } from "@core/bulk-scheduling/ParseBulkScheduleCsvUseCase.js";
import type { ConfirmBulkScheduleUseCase } from "@core/bulk-scheduling/ConfirmBulkScheduleUseCase.js";
import type { GetBulkScheduleBatchQuery } from "@core/bulk-scheduling/GetBulkScheduleBatchQuery.js";

/** Generous 16 MB cap for the CSV body (default Fastify limit is 1 MB). */
const IMPORT_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const ParseCsvBodySchema = z.object({
  projectId: z.string().uuid(),
  csv: z.string().min(1, "csv is required"),
});

const ConfirmBodySchema = z.object({
  projectId: z.string().uuid(),
  channelIds: z.array(z.string().uuid()).min(1, "at least one channelId required"),
  rows: z.array(
    z.object({
      row: z.number().int().positive(),
      content: z.string().min(1),
      scheduledFor: z.string().min(1),
      timezone: z.string().default("UTC"),
      title: z.string().optional(),
      media: z
        .array(
          z.object({
            url: z.string().url(),
            type: z.enum(["image", "video", "gif"]),
          })
        )
        .default([]),
      tags: z.array(z.string()).default([]),
    })
  ),
});

const BatchParamsSchema = z.object({
  batchId: z.string().uuid(),
});

// ============================================================================
// Route handler
// ============================================================================

class BulkScheduleRouteHandler extends BaseRouteHandler {
  protected routeName = "bulk-scheduling";

  constructor(
    private readonly parseUseCase: ParseBulkScheduleCsvUseCase,
    private readonly confirmUseCase: ConfirmBulkScheduleUseCase,
    private readonly getBatchQuery: GetBulkScheduleBatchQuery
  ) {
    super();
  }

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

  /**
   * @method parseCsv
   * @description POST /bulk-scheduling/parse — stateless CSV parse. Returns row
   *   preview without writing to the database.
   */
  async parseCsv(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateBody(ctx, ParseCsvBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const accountId = request.customerUser?.accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.parseUseCase.execute({
      csv: validation.value.csv,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method confirmBulkSchedule
   * @description POST /bulk-scheduling/confirm — confirm a parsed upload.
   *   Persists the lean manifest batch + one outbox event per row atomically.
   *   accountId is taken from the authenticated user, NOT from the request body.
   */
  async confirmBulkSchedule(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateBody(ctx, ConfirmBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const accountId = request.customerUser?.accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const rows = validation.value.rows.map((r) => ({
      row: r.row,
      content: r.content,
      scheduledFor: r.scheduledFor,
      timezone: r.timezone,
      ...(r.title !== undefined && { title: r.title }),
      media: r.media,
      tags: r.tags,
    }));

    const result = await this.confirmUseCase.execute({
      accountId,
      projectId: validation.value.projectId,
      channelIds: validation.value.channelIds,
      rows,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 202);
  }

  /**
   * @method getBatch
   * @description GET /bulk-scheduling/batches/:batchId — returns the batch and
   *   its per-row manifest (status / postId / errorMessage), account-scoped.
   */
  async getBatch(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateParams(ctx, BatchParamsSchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid batch id");
    }

    const accountId = request.customerUser?.accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getBatchQuery.execute({
      accountId,
      batchId: validation.value.batchId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * Fastify plugin registering bulk-scheduling routes under /api/bulk-scheduling.
 */
const bulkScheduleRoutes: FastifyPluginAsync = async (app) => {
  const parseUseCase = app.container.resolve<ParseBulkScheduleCsvUseCase>(
    TOKENS.ParseBulkScheduleCsvUseCase
  );
  const confirmUseCase = app.container.resolve<ConfirmBulkScheduleUseCase>(
    TOKENS.ConfirmBulkScheduleUseCase
  );
  const getBatchQuery = app.container.resolve<GetBulkScheduleBatchQuery>(
    TOKENS.GetBulkScheduleBatchQuery
  );

  const handler = new BulkScheduleRouteHandler(parseUseCase, confirmUseCase, getBatchQuery);

  // Parse endpoint — stateless, no DB writes.
  app.post(
    "/bulk-scheduling/parse",
    {
      preHandler: [requireClientAuth],
      bodyLimit: IMPORT_BODY_LIMIT_BYTES,
      schema: {
        tags: ["Bulk Scheduling"],
        summary: "Parse a scheduling CSV and return row preview (no DB write)",
      },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.parseCsv(request, reply)
  );

  // Confirm endpoint — atomic manifest + outbox commit.
  app.post(
    "/bulk-scheduling/confirm",
    {
      preHandler: [requireClientAuth],
      bodyLimit: IMPORT_BODY_LIMIT_BYTES,
      schema: {
        tags: ["Bulk Scheduling"],
        summary: "Confirm a bulk schedule upload (atomic manifest + outbox events)",
      },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.confirmBulkSchedule(request, reply)
  );

  // Batch manifest poll — unchanged.
  app.get(
    "/bulk-scheduling/batches/:batchId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Bulk Scheduling"], summary: "Get a bulk-scheduling batch manifest" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getBatch(request, reply)
  );

  // Retired legacy endpoint — 410 Gone.
  app.post(
    "/bulk-scheduling/imports",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["Bulk Scheduling"],
        summary: "RETIRED — use /bulk-scheduling/parse then /bulk-scheduling/confirm",
        deprecated: true,
      },
    },
    (_request: FastifyRequest, reply: FastifyReply) => {
      reply.code(410).send({
        ok: false,
        error:
          "This endpoint has been retired. Use POST /bulk-scheduling/parse followed by POST /bulk-scheduling/confirm.",
      });
    }
  );
};

export { bulkScheduleRoutes };
