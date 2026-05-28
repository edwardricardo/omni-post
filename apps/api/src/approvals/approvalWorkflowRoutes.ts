/**
 * @file approvalWorkflowRoutes.ts
 * @description Fastify plugin registering multi-level approval workflow CRUD endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { CreateApprovalWorkflowUseCase } from "@core/approvals/CreateApprovalWorkflowUseCase.js";
import type { UpdateApprovalWorkflowUseCase } from "@core/approvals/UpdateApprovalWorkflowUseCase.js";
import type { DeleteApprovalWorkflowUseCase } from "@core/approvals/DeleteApprovalWorkflowUseCase.js";
import type { ListApprovalWorkflowsQuery } from "@core/approvals/ListApprovalWorkflowsQuery.js";

// --- Zod Schemas ---

const WorkflowIdParamsSchema = z.object({
  id: z.string().min(1),
});

const WorkflowLevelSchema = z.object({
  order: z.number().int().min(1).max(10),
  role: z.string().max(100).optional(),
  assigneeId: z.string().uuid().optional(),
  requireAll: z.boolean().optional(),
});

const CreateWorkflowBodySchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  levels: z.array(WorkflowLevelSchema).min(1).max(10),
  isDefault: z.boolean().optional(),
});

const UpdateWorkflowBodySchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  levels: z.array(WorkflowLevelSchema).min(1).max(10).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const ListWorkflowsQuerySchema = z.object({
  accountId: z.string().min(1),
});

const DeleteWorkflowBodySchema = z.object({
  accountId: z.string().min(1),
});

/**
 * @class ApprovalWorkflowRouteHandler
 * @description Route handler for multi-level approval workflow CRUD endpoints.
 */
class ApprovalWorkflowRouteHandler extends BaseRouteHandler {
  protected routeName = "approval-workflows";

  constructor(
    private readonly createUseCase: CreateApprovalWorkflowUseCase,
    private readonly updateUseCase: UpdateApprovalWorkflowUseCase,
    private readonly deleteUseCase: DeleteApprovalWorkflowUseCase,
    private readonly listQuery: ListApprovalWorkflowsQuery
  ) {
    super();
  }

  /**
   * @method list
   * @description GET /approval-workflows -- Lists all workflows for an account
   */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      query: z.infer<typeof ListWorkflowsQuerySchema>;
    }>(ctx, { query: ListWorkflowsQuerySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters (accountId required)");
    }

    const result = await this.listQuery.execute({
      accountId: validation.value.query.accountId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, { workflows: result.value });
  }

  /**
   * @method create
   * @description POST /approval-workflows -- Creates a new workflow
   */
  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof CreateWorkflowBodySchema>;
    }>(ctx, { body: CreateWorkflowBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value.body;

    const result = await this.createUseCase.execute({
      accountId: body.accountId,
      name: body.name,
      ...(body.description !== undefined && { description: body.description }),
      levels: body.levels.map((l) => ({
        order: l.order,
        ...(l.role !== undefined && { role: l.role }),
        ...(l.assigneeId !== undefined && { assigneeId: l.assigneeId }),
        ...(l.requireAll !== undefined && { requireAll: l.requireAll }),
      })),
      ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        VALIDATION_FAILED: 400,
        CONFLICT: 409,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method getById
   * @description GET /approval-workflows/:id -- Gets a workflow with levels
   */
  async getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateRequest<{
      params: z.infer<typeof WorkflowIdParamsSchema>;
      query: z.infer<typeof ListWorkflowsQuerySchema>;
    }>(ctx, { params: WorkflowIdParamsSchema, query: ListWorkflowsQuerySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    // Use list query and filter by ID (avoids needing a separate GetByIdQuery)
    const result = await this.listQuery.execute({
      accountId: validation.value.query.accountId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    const workflow = result.value.find((w) => w.id === validation.value.params.id);
    if (!workflow) {
      return this.sendError(ctx, 404, "Approval workflow not found");
    }

    this.sendSuccess(ctx, { workflow });
  }

  /**
   * @method update
   * @description PATCH /approval-workflows/:id -- Updates a workflow
   */
  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof WorkflowIdParamsSchema>;
    }>(ctx, { params: WorkflowIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid workflow ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof UpdateWorkflowBodySchema>;
    }>(ctx, { body: UpdateWorkflowBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsValidation.value.params;
    const body = bodyValidation.value.body;

    const result = await this.updateUseCase.execute({
      workflowId: id,
      accountId: body.accountId,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.levels !== undefined && {
        levels: body.levels.map((l) => ({
          order: l.order,
          ...(l.role !== undefined && { role: l.role }),
          ...(l.assigneeId !== undefined && { assigneeId: l.assigneeId }),
          ...(l.requireAll !== undefined && { requireAll: l.requireAll }),
        })),
      }),
      ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        VALIDATION_FAILED: 400,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { updated: true });
  }

  /**
   * @method remove
   * @description DELETE /approval-workflows/:id -- Deletes a workflow
   */
  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof WorkflowIdParamsSchema>;
    }>(ctx, { params: WorkflowIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid workflow ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof DeleteWorkflowBodySchema>;
    }>(ctx, { body: DeleteWorkflowBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body (accountId required)");
    }

    const { id } = paramsValidation.value.params;
    const body = bodyValidation.value.body;

    const result = await this.deleteUseCase.execute({
      workflowId: id,
      accountId: body.accountId,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        CONFLICT: 409,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { deleted: true });
  }
}

/**
 * Fastify plugin that registers multi-level approval workflow routes
 */
export const approvalWorkflowRoutes: FastifyPluginAsync = async (app) => {
  const createUseCase = app.container.resolve<CreateApprovalWorkflowUseCase>(
    TOKENS.CreateApprovalWorkflowUseCase
  );
  const updateUseCase = app.container.resolve<UpdateApprovalWorkflowUseCase>(
    TOKENS.UpdateApprovalWorkflowUseCase
  );
  const deleteUseCase = app.container.resolve<DeleteApprovalWorkflowUseCase>(
    TOKENS.DeleteApprovalWorkflowUseCase
  );
  const listQuery = app.container.resolve<ListApprovalWorkflowsQuery>(
    TOKENS.ListApprovalWorkflowsQuery
  );

  const handler = new ApprovalWorkflowRouteHandler(
    createUseCase,
    updateUseCase,
    deleteUseCase,
    listQuery
  );

  // List workflows for an account
  app.get(
    "/approval-workflows",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approval Workflows"], summary: "List approval workflows" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.list(request, reply)
  );

  // Create a new workflow
  app.post(
    "/approval-workflows",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approval Workflows"], summary: "Create approval workflow" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.create(request, reply)
  );

  // Get a specific workflow by ID
  app.get(
    "/approval-workflows/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approval Workflows"], summary: "Get approval workflow by ID" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getById(request, reply)
  );

  // Update a workflow
  app.patch(
    "/approval-workflows/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approval Workflows"], summary: "Update approval workflow" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.update(request, reply)
  );

  // Delete a workflow
  app.delete(
    "/approval-workflows/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Approval Workflows"], summary: "Delete approval workflow" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.remove(request, reply)
  );
};
