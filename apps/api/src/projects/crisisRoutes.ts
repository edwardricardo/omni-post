/**
 * @file crisisRoutes.ts
 * @description REST API endpoints for crisis mode management including entering,
 *              exiting, and querying crisis status for projects.
 * @layer infrastructure
 */

import { type FastifyPluginAsync, type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { IdSchema } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import type { EnterCrisisModeUseCase } from "@core/application/crisis/EnterCrisisModeUseCase.js";
import type { ExitCrisisModeUseCase } from "@core/application/crisis/ExitCrisisModeUseCase.js";
import type { GetCrisisStatusUseCase } from "@core/application/crisis/GetCrisisStatusUseCase.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

// Zod Schemas
const ProjectParamsSchema = z.object({
  projectId: IdSchema,
});

const EnterCrisisBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * Crisis Mode Route Handler
 *
 * Delegates all operations to application-layer use cases resolved from
 * the DI container. No direct repository or Prisma access.
 */
class CrisisRouteHandler extends BaseRouteHandler {
  protected routeName = "crisis";

  constructor(
    private readonly enterCrisisModeUseCase: EnterCrisisModeUseCase,
    private readonly exitCrisisModeUseCase: ExitCrisisModeUseCase,
    private readonly getCrisisStatusUseCase: GetCrisisStatusUseCase
  ) {
    super();
  }

  /**
   * Enter crisis mode for a project
   * POST /projects/:projectId/crisis
   */
  async enterCrisisMode(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Entering crisis mode");

    const paramsValidated = await this.validateRequest<{
      params: z.infer<typeof ProjectParamsSchema>;
    }>(ctx, { params: ProjectParamsSchema });
    if (!paramsValidated.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const bodyValidated = await this.validateRequest<{
      body: z.infer<typeof EnterCrisisBodySchema>;
    }>(ctx, { body: EnterCrisisBodySchema });
    if (!bodyValidated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const result = await this.enterCrisisModeUseCase.execute({
      projectId: paramsValidated.value.params.projectId,
      reason: bodyValidated.value.body.reason,
    });

    if (!result.ok) {
      const statusCode =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "CONFLICT" ? 409 : 400;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * Exit crisis mode for a project
   * DELETE /projects/:projectId/crisis
   */
  async exitCrisisMode(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Exiting crisis mode");

    const validated = await this.validateRequest<{ params: z.infer<typeof ProjectParamsSchema> }>(
      ctx,
      { params: ProjectParamsSchema }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const result = await this.exitCrisisModeUseCase.execute({
      projectId: validated.value.params.projectId,
    });

    if (!result.ok) {
      const statusCode =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "CONFLICT" ? 409 : 400;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * Get crisis status for a project
   * GET /projects/:projectId/crisis
   */
  async getCrisisStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<{ params: z.infer<typeof ProjectParamsSchema> }>(
      ctx,
      { params: ProjectParamsSchema }
    );
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid project ID");
    }

    const result = await this.getCrisisStatusUseCase.execute({
      projectId: validated.value.params.projectId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 404, result.error.message);
    }

    return this.sendSuccess(ctx, result.value);
  }
}

/**
 * Crisis mode routes plugin
 *
 * Resolves use cases from the DI container at plugin registration time.
 */
export const crisisRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }

  const handler = new CrisisRouteHandler(
    container.resolve<EnterCrisisModeUseCase>(TOKENS.EnterCrisisModeUseCase),
    container.resolve<ExitCrisisModeUseCase>(TOKENS.ExitCrisisModeUseCase),
    container.resolve<GetCrisisStatusUseCase>(TOKENS.GetCrisisStatusUseCase)
  );

  // Crisis mode endpoints
  fastify.post(
    "/projects/:projectId/crisis",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Crisis"], summary: "Enter crisis mode for a project" },
    },
    handler.enterCrisisMode.bind(handler)
  );
  fastify.delete(
    "/projects/:projectId/crisis",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Crisis"], summary: "Exit crisis mode for a project" },
    },
    handler.exitCrisisMode.bind(handler)
  );
  fastify.get(
    "/projects/:projectId/crisis",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Crisis"], summary: "Get crisis status for a project" },
    },
    handler.getCrisisStatus.bind(handler)
  );
};
