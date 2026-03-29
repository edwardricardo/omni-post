/**
 * @file taskRoutes.ts
 * @description REST API routes for Task management.
 *
 *   GET    /api/tasks          -> ListTasksQuery
 *   POST   /api/tasks          -> CreateTaskUseCase
 *   GET    /api/tasks/:id      -> GetTaskQuery
 *   PATCH  /api/tasks/:id      -> UpdateTaskUseCase
 *   POST   /api/tasks/:id/complete -> CompleteTaskUseCase
 *   POST   /api/tasks/:id/cancel   -> CancelTaskUseCase
 *   DELETE /api/tasks/:id      -> soft delete
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { authenticateMiddleware } from "../auth/authMiddleware.js";
import type { CreateTaskUseCase } from "../application/tasks/CreateTaskUseCase.js";
import type { UpdateTaskUseCase } from "../application/tasks/UpdateTaskUseCase.js";
import type { CompleteTaskUseCase } from "../application/tasks/CompleteTaskUseCase.js";
import type { CancelTaskUseCase } from "../application/tasks/CancelTaskUseCase.js";
import type { ListTasksQuery } from "../application/tasks/ListTasksQuery.js";
import type { GetTaskQuery } from "../application/tasks/GetTaskQuery.js";
import type { TaskRepository } from "../domain/repositories/TaskRepository.js";

// ============================================================================
// Schemas
// ============================================================================

const TaskIdParamSchema = z.object({
  id: z.string().min(1),
});

const ListQuerySchema = z.object({
  accountId: z.string().min(1),
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const CreateBodySchema = z.object({
  accountId: z.string().min(1),
  projectId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  createdById: z.string().min(1),
  dueDate: z.coerce.date().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  postId: z.string().optional(),
});

const UpdateBodySchema = z.object({
  accountId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

const CompleteBodySchema = z.object({
  accountId: z.string().min(1),
  completedById: z.string().min(1),
});

const CancelBodySchema = z.object({
  accountId: z.string().min(1),
  cancelledById: z.string().min(1),
});

const DeleteBodySchema = z.object({
  accountId: z.string().min(1),
});

// ============================================================================
// Handler
// ============================================================================

class TaskRouteHandler extends BaseRouteHandler {
  protected routeName = "tasks";

  constructor(
    private readonly createUseCase: CreateTaskUseCase,
    private readonly updateUseCase: UpdateTaskUseCase,
    private readonly completeUseCase: CompleteTaskUseCase,
    private readonly cancelUseCase: CancelTaskUseCase,
    private readonly listQuery: ListTasksQuery,
    private readonly getQuery: GetTaskQuery,
    private readonly taskRepository: TaskRepository
  ) {
    super();
  }

  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const queryValidation = await this.validateQuery(ctx, ListQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const q = queryValidation.value;
    const result = await this.listQuery.execute({
      accountId: q.accountId,
      ...(q.projectId !== undefined && { projectId: q.projectId }),
      ...(q.assigneeId !== undefined && { assigneeId: q.assigneeId }),
      ...(q.status !== undefined && { status: q.status }),
      ...(q.priority !== undefined && { priority: q.priority }),
      ...(q.limit !== undefined && { limit: q.limit }),
      ...(q.offset !== undefined && { offset: q.offset }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateBody(ctx, CreateBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.createUseCase.execute({
      accountId: body.accountId,
      title: body.title,
      createdById: body.createdById,
      ...(body.projectId !== undefined && { projectId: body.projectId }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.postId !== undefined && { postId: body.postId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    reply.status(201);
    this.sendSuccess(ctx, result.value);
  }

  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, TaskIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid task ID");
    }

    const queryValidation = await this.validateQuery(
      ctx,
      z.object({ accountId: z.string().min(1) })
    );
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "accountId query parameter is required");
    }

    const result = await this.getQuery.execute({
      taskId: paramsValidation.value.id,
      accountId: queryValidation.value.accountId,
    });

    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, TaskIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid task ID");
    }

    const bodyValidation = await this.validateBody(ctx, UpdateBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.updateUseCase.execute({
      taskId: paramsValidation.value.id,
      accountId: body.accountId,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
      ...(body.priority !== undefined && { priority: body.priority }),
    });

    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, { updated: true });
  }

  async complete(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, TaskIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid task ID");
    }

    const bodyValidation = await this.validateBody(ctx, CompleteBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const result = await this.completeUseCase.execute({
      taskId: paramsValidation.value.id,
      accountId: bodyValidation.value.accountId,
      completedById: bodyValidation.value.completedById,
    });

    if (!result.ok) {
      const status =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 403 : 400;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, { completed: true });
  }

  async cancelTask(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, TaskIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid task ID");
    }

    const bodyValidation = await this.validateBody(ctx, CancelBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const result = await this.cancelUseCase.execute({
      taskId: paramsValidation.value.id,
      accountId: bodyValidation.value.accountId,
      cancelledById: bodyValidation.value.cancelledById,
    });

    if (!result.ok) {
      const status =
        result.error.code === "NOT_FOUND" ? 404 : result.error.code === "FORBIDDEN" ? 403 : 400;
      return this.sendError(ctx, status, result.error.message);
    }

    this.sendSuccess(ctx, { cancelled: true });
  }

  async deleteTask(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, TaskIdParamSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid task ID");
    }

    const bodyValidation = await this.validateBody(ctx, DeleteBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    // Verify ownership before soft-deleting
    const findResult = await this.taskRepository.findById(paramsValidation.value.id);
    if (!findResult.ok) {
      return this.sendError(ctx, 404, "Task not found");
    }
    if (findResult.value.accountId !== bodyValidation.value.accountId) {
      return this.sendError(ctx, 404, "Task not found");
    }

    const result = await this.taskRepository.softDelete(paramsValidation.value.id);
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, { deleted: true });
  }
}

// ============================================================================
// Plugin
// ============================================================================

export const taskRoutes: FastifyPluginAsync = async (app) => {
  const handler = new TaskRouteHandler(
    app.container.resolve<CreateTaskUseCase>(TOKENS.CreateTaskUseCase),
    app.container.resolve<UpdateTaskUseCase>(TOKENS.UpdateTaskUseCase),
    app.container.resolve<CompleteTaskUseCase>(TOKENS.CompleteTaskUseCase),
    app.container.resolve<CancelTaskUseCase>(TOKENS.CancelTaskUseCase),
    app.container.resolve<ListTasksQuery>(TOKENS.ListTasksQuery),
    app.container.resolve<GetTaskQuery>(TOKENS.GetTaskQuery),
    app.container.resolve<TaskRepository>(TOKENS.TaskRepository)
  );

  app.get(
    "/api/tasks",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Tasks"], summary: "List tasks with filters" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.list(request, reply)
  );

  app.post(
    "/api/tasks",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Tasks"], summary: "Create a new task" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.create(request, reply)
  );

  app.get(
    "/api/tasks/:id",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Tasks"], summary: "Get a single task" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.get(request, reply)
  );

  app.patch(
    "/api/tasks/:id",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Tasks"], summary: "Update a task" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.update(request, reply)
  );

  app.post(
    "/api/tasks/:id/complete",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Tasks"], summary: "Complete a task" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.complete(request, reply)
  );

  app.post(
    "/api/tasks/:id/cancel",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Tasks"], summary: "Cancel a task" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.cancelTask(request, reply)
  );

  app.delete(
    "/api/tasks/:id",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Tasks"], summary: "Soft-delete a task" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.deleteTask(request, reply)
  );
};
