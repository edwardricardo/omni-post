/**
 * @file promptTemplateRoutes.ts
 * @description REST API routes for AI prompt template management.
 *   Supports listing (system + account), creating, updating, and deleting templates.
 *   System templates are read-only.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { ListAIPromptTemplatesQuery } from "../application/aiPromptTemplates/ListAIPromptTemplatesQuery.js";
import type { CreateAIPromptTemplateUseCase } from "../application/aiPromptTemplates/CreateAIPromptTemplateUseCase.js";
import type { UpdateAIPromptTemplateUseCase } from "../application/aiPromptTemplates/UpdateAIPromptTemplateUseCase.js";
import type { DeleteAIPromptTemplateUseCase } from "../application/aiPromptTemplates/DeleteAIPromptTemplateUseCase.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const TemplateVariableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["text", "select", "date", "url"]),
  label: z.string().min(1),
  placeholder: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const CreateTemplateBodySchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  platforms: z.array(z.string()).min(1),
  prompt: z.string().min(1).max(5000),
  variables: z.array(TemplateVariableSchema).default([]),
  tone: z.array(z.string()).default([]),
});

const UpdateTemplateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().min(1).max(50).optional(),
  platforms: z.array(z.string()).optional(),
  prompt: z.string().min(1).max(5000).optional(),
  variables: z.array(TemplateVariableSchema).optional(),
  tone: z.array(z.string()).optional(),
});

const ListQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
});

const UuidParamsSchema = z.object({ id: z.string().uuid() });

const DeleteQuerySchema = z.object({ accountId: z.string().uuid() });

// ============================================================================
// Route Handler Class
// ============================================================================

class PromptTemplateRouteHandler extends BaseRouteHandler {
  protected routeName = "ai-templates";

  constructor(
    private readonly listQuery: ListAIPromptTemplatesQuery,
    private readonly createUseCase: CreateAIPromptTemplateUseCase,
    private readonly updateUseCase: UpdateAIPromptTemplateUseCase,
    private readonly deleteUseCase: DeleteAIPromptTemplateUseCase
  ) {
    super();
  }

  private mapErrorCode(code: string): number {
    const mapping: Record<string, number> = {
      VALIDATION_FAILED: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      INTERNAL_ERROR: 500,
    };
    return mapping[code] ?? 500;
  }

  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const queryValidation = await this.validateQuery(ctx, ListQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const result = await this.listQuery.execute({
      ...(queryValidation.value.accountId !== undefined && {
        accountId: queryValidation.value.accountId,
      }),
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }
    this.sendSuccess(ctx, result.value);
  }

  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyValidation = await this.validateBody(ctx, CreateTemplateBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.createUseCase.execute({
      accountId: body.accountId,
      name: body.name,
      category: body.category,
      platforms: body.platforms,
      prompt: body.prompt,
      variables:
        body.variables as import("../application/aiPromptTemplates/types.js").TemplateVariableDto[],
      tone: body.tone,
    });
    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }
    this.sendSuccess(ctx, result.value, 201);
  }

  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid template ID format");
    }

    const bodyValidation = await this.validateBody(ctx, UpdateTemplateBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const input: import("../application/aiPromptTemplates/types.js").UpdateAIPromptTemplateInput = {
      templateId: paramsValidation.value.id,
    };
    if (body.name !== undefined) input.name = body.name;
    if (body.category !== undefined) input.category = body.category;
    if (body.platforms !== undefined) input.platforms = body.platforms;
    if (body.prompt !== undefined) input.prompt = body.prompt;
    if (body.variables !== undefined) {
      input.variables =
        body.variables as import("../application/aiPromptTemplates/types.js").TemplateVariableDto[];
    }
    if (body.tone !== undefined) input.tone = body.tone;
    const result = await this.updateUseCase.execute(input);

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }
    this.sendSuccess(ctx, result.value);
  }

  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid template ID format");
    }

    const queryValidation = await this.validateQuery(ctx, DeleteQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "accountId query parameter is required and must be a UUID");
    }

    const result = await this.deleteUseCase.execute({
      templateId: paramsValidation.value.id,
      accountId: queryValidation.value.accountId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }
    this.sendSuccess(ctx, null, 204);
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

export const promptTemplateRoutes: FastifyPluginAsync = async (app) => {
  const handler = new PromptTemplateRouteHandler(
    app.container.resolve<ListAIPromptTemplatesQuery>(TOKENS.ListAIPromptTemplatesQuery),
    app.container.resolve<CreateAIPromptTemplateUseCase>(TOKENS.CreateAIPromptTemplateUseCase),
    app.container.resolve<UpdateAIPromptTemplateUseCase>(TOKENS.UpdateAIPromptTemplateUseCase),
    app.container.resolve<DeleteAIPromptTemplateUseCase>(TOKENS.DeleteAIPromptTemplateUseCase)
  );

  app.get(
    "/ai-templates",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI Templates"], summary: "List prompt templates" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.list(request, reply)
  );

  app.post(
    "/ai-templates",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI Templates"], summary: "Create prompt template" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.create(request, reply)
  );

  app.patch(
    "/ai-templates/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI Templates"], summary: "Update prompt template" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.update(request, reply)
  );

  app.delete(
    "/ai-templates/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI Templates"], summary: "Delete prompt template" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.remove(request, reply)
  );
};
