/**
 * @file recurringPostRoutes.ts
 * @description Fastify plugin registering recurring post schedule endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 *   Supports CRUD operations and deactivation for recurring post schedules.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { CreateRecurringPostUseCase } from "@core/recurring/CreateRecurringPostUseCase.js";
import type { UpdateRecurringPostUseCase } from "@core/recurring/UpdateRecurringPostUseCase.js";
import type { DeactivateRecurringPostUseCase } from "@core/recurring/DeactivateRecurringPostUseCase.js";
import type { ListRecurringPostsQuery } from "@core/recurring/ListRecurringPostsQuery.js";
import type { GetRecurringPostQuery } from "@core/recurring/GetRecurringPostQuery.js";

// --- Zod Schemas ---

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

const ProjectIdQuerySchema = z.object({
  projectId: z.string().uuid(),
});

const CreateRecurringPostBodySchema = z.object({
  projectId: z.string().uuid(),
  templatePostId: z.string().uuid(),
  name: z.string().min(1).max(200),
  cronExpression: z.string().min(1).max(100),
  timezone: z.string().max(50).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  maxOccurrences: z.number().int().positive().optional(),
  channels: z.array(z.string().uuid()).min(1),
  contentVariation: z.enum(["EXACT", "ROTATED", "AI_GENERATED"]).optional(),
});

const UpdateRecurringPostBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cronExpression: z.string().min(1).max(100).optional(),
  timezone: z.string().max(50).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  maxOccurrences: z.number().int().positive().optional(),
  channels: z.array(z.string().uuid()).min(1).optional(),
  contentVariation: z.enum(["EXACT", "ROTATED", "AI_GENERATED"]).optional(),
});

/**
 * @class RecurringPostRouteHandler
 * @description Route handler for recurring post schedule endpoints.
 *   All operations delegate to application-layer use cases resolved from DI.
 */
class RecurringPostRouteHandler extends BaseRouteHandler {
  protected routeName = "recurring-posts";

  constructor(
    private readonly createUseCase: CreateRecurringPostUseCase,
    private readonly updateUseCase: UpdateRecurringPostUseCase,
    private readonly deactivateUseCase: DeactivateRecurringPostUseCase,
    private readonly listQuery: ListRecurringPostsQuery,
    private readonly getQuery: GetRecurringPostQuery
  ) {
    super();
  }

  /**
   * @method create
   * @description POST /recurring-posts -- Create a new recurring post schedule
   */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof CreateRecurringPostBodySchema>;
    }>(ctx, { body: CreateRecurringPostBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const body = bodyValidation.value.body;
    const result = await this.createUseCase.execute({
      projectId: body.projectId,
      templatePostId: body.templatePostId,
      name: body.name,
      cronExpression: body.cronExpression,
      startDate: body.startDate,
      channels: body.channels,
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.endDate !== undefined && { endDate: body.endDate }),
      ...(body.maxOccurrences !== undefined && { maxOccurrences: body.maxOccurrences }),
      ...(body.contentVariation !== undefined && { contentVariation: body.contentVariation }),
    });

    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method list
   * @description GET /recurring-posts?projectId=... -- List recurring posts for a project
   */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const queryValidation = await this.validateRequest<{
      query: z.infer<typeof ProjectIdQuerySchema>;
    }>(ctx, { query: ProjectIdQuerySchema });

    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Missing or invalid projectId query parameter");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.listQuery.execute({
      projectId: queryValidation.value.query.projectId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getOne
   * @description GET /recurring-posts/:id -- Get a single recurring post
   */
  async getOne(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof IdParamsSchema>;
    }>(ctx, { params: IdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid recurring post ID");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getQuery.execute({
      id: paramsValidation.value.params.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    if (!result.value) {
      return this.sendError(ctx, 404, "Recurring post not found");
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method update
   * @description PATCH /recurring-posts/:id -- Update a recurring post schedule
   */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof IdParamsSchema>;
    }>(ctx, { params: IdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid recurring post ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof UpdateRecurringPostBodySchema>;
    }>(ctx, { body: UpdateRecurringPostBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const updateBody = bodyValidation.value.body;
    const result = await this.updateUseCase.execute({
      id: paramsValidation.value.params.id,
      ...(updateBody.name !== undefined && { name: updateBody.name }),
      ...(updateBody.cronExpression !== undefined && { cronExpression: updateBody.cronExpression }),
      ...(updateBody.timezone !== undefined && { timezone: updateBody.timezone }),
      ...(updateBody.startDate !== undefined && { startDate: updateBody.startDate }),
      ...(updateBody.endDate !== undefined && { endDate: updateBody.endDate }),
      ...(updateBody.maxOccurrences !== undefined && { maxOccurrences: updateBody.maxOccurrences }),
      ...(updateBody.channels !== undefined && { channels: updateBody.channels }),
      ...(updateBody.contentVariation !== undefined && {
        contentVariation: updateBody.contentVariation,
      }),
    });

    if (!result.ok) {
      const statusCode =
        result.error.code === "NOT_FOUND"
          ? 404
          : result.error.code === "VALIDATION_FAILED"
            ? 400
            : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method deactivate
   * @description DELETE /recurring-posts/:id -- Deactivate a recurring post schedule
   */
  async deactivate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof IdParamsSchema>;
    }>(ctx, { params: IdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid recurring post ID");
    }

    const user = request.customerUser;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.deactivateUseCase.execute({
      id: paramsValidation.value.params.id,
    });

    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { deactivated: true });
  }
}

/**
 * Fastify plugin that registers recurring post schedule routes
 */
export const recurringPostRoutes: FastifyPluginAsync = async (app) => {
  const createUseCase = app.container.resolve<CreateRecurringPostUseCase>(
    TOKENS.CreateRecurringPostUseCase
  );
  const updateUseCase = app.container.resolve<UpdateRecurringPostUseCase>(
    TOKENS.UpdateRecurringPostUseCase
  );
  const deactivateUseCase = app.container.resolve<DeactivateRecurringPostUseCase>(
    TOKENS.DeactivateRecurringPostUseCase
  );
  const listQuery = app.container.resolve<ListRecurringPostsQuery>(
    TOKENS.ListRecurringPostsQuery_Recurring
  );
  const getQuery = app.container.resolve<GetRecurringPostQuery>(TOKENS.GetRecurringPostQuery);

  const handler = new RecurringPostRouteHandler(
    createUseCase,
    updateUseCase,
    deactivateUseCase,
    listQuery,
    getQuery
  );

  // Create a recurring post schedule
  app.post(
    "/recurring-posts",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Recurring Posts"], summary: "Create a recurring post schedule" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.create(request, reply)
  );

  // List recurring posts for a project
  app.get(
    "/recurring-posts",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Recurring Posts"], summary: "List recurring posts for a project" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.list(request, reply)
  );

  // Get a single recurring post
  app.get(
    "/recurring-posts/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Recurring Posts"], summary: "Get a single recurring post" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getOne(request, reply)
  );

  // Update a recurring post schedule
  app.patch(
    "/recurring-posts/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Recurring Posts"], summary: "Update a recurring post schedule" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.update(request, reply)
  );

  // Deactivate a recurring post schedule
  app.delete(
    "/recurring-posts/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Recurring Posts"], summary: "Deactivate a recurring post schedule" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.deactivate(request, reply)
  );
};
