/**
 * @file bulkScheduleRoutes.ts
 * @description Fastify plugin for bulk CSV scheduling: POST an import (text CSV
 *   in JSON) that fans out one job per valid row, and GET the per-row manifest
 *   to poll progress. Both routes are account-scoped from the authenticated
 *   customer token (multi-tenant safe). Resolves use cases from DI and delegates
 *   to BulkScheduleRouteHandler.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { ImportSchedulingCsvUseCase } from "@core/application/bulk-scheduling/ImportSchedulingCsvUseCase.js";
import type { GetBulkScheduleBatchQuery } from "@core/application/bulk-scheduling/GetBulkScheduleBatchQuery.js";

/** Generous 16 MB cap for the CSV body (default Fastify limit is 1 MB). */
const IMPORT_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const ImportCsvBodySchema = z.object({
  projectId: z.string().uuid(),
  csv: z.string().min(1, "csv is required"),
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
    private readonly importUseCase: ImportSchedulingCsvUseCase,
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
   * @method importCsv
   * @description POST /bulk-scheduling/imports — parses + validates the CSV,
   *   persists the manifest, and enqueues one job per valid row. Returns 202.
   */
  async importCsv(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateBody(ctx, ImportCsvBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const accountId = request.customerUser?.accountId;
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.importUseCase.execute({
      accountId,
      projectId: validation.value.projectId,
      csv: validation.value.csv,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 202);
  }

  /**
   * @method getBatch
   * @description GET /bulk-scheduling/imports/:batchId — returns the batch and
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
  const importUseCase = app.container.resolve<ImportSchedulingCsvUseCase>(
    TOKENS.ImportSchedulingCsvUseCase
  );
  const getBatchQuery = app.container.resolve<GetBulkScheduleBatchQuery>(
    TOKENS.GetBulkScheduleBatchQuery
  );

  const handler = new BulkScheduleRouteHandler(importUseCase, getBatchQuery);

  app.post(
    "/bulk-scheduling/imports",
    {
      preHandler: [requireClientAuth],
      bodyLimit: IMPORT_BODY_LIMIT_BYTES,
      schema: {
        tags: ["Bulk Scheduling"],
        summary: "Import a scheduling CSV (one job per valid row)",
      },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.importCsv(request, reply)
  );

  app.get(
    "/bulk-scheduling/imports/:batchId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Bulk Scheduling"], summary: "Get a bulk-scheduling batch manifest" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getBatch(request, reply)
  );
};

export { bulkScheduleRoutes };
