/**
 * Template CRUD Handlers
 *
 * Handles template create, read, update, delete, duplicate, and compile endpoints.
 * Extracted from TemplateHandlers.ts to keep files under 800 lines.
 *
 * @module templates/TemplateCrudHandlers
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { TemplateService } from "./templateService.js";
import type { Template } from "./templateTypes.js";
import {
  ProjectIdParamsSchema,
  TemplateIdParamsSchema,
  PlatformParamsSchema,
  GetTemplatesQuerySchema,
  CreateTemplateBodySchema,
  UpdateTemplateBodySchema,
  DuplicateTemplateBodySchema,
  CompileTemplateBodySchema,
} from "./templateSchemas.js";

/**
 * Template CRUD Route Handler
 * Handles template listing, creation, update, deletion, duplication, compilation, and validation
 */
export class TemplateCrudHandler extends BaseRouteHandler {
  protected routeName = "template-crud";

  constructor(private readonly templateService: TemplateService) {
    super();
  }

  async getTemplates(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof ProjectIdParamsSchema>;
      query: z.infer<typeof GetTemplatesQuerySchema>;
    }>(ctx, { params: ProjectIdParamsSchema, query: GetTemplatesQuerySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, query } = validation.value;
    const { category, platform, tags, search, limit, offset } = query;
    const filters = {
      ...(category && { category }),
      ...(platform && { platform }),
      ...(tags && { tags: tags.split(",") }),
      ...(search && { search }),
    };

    this.logInfo(ctx, "Fetching templates", { projectId: params.projectId, filters });
    const result = await this.templateService.getTemplates(params.projectId, filters, {
      limit,
      offset,
    });
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value);
  }

  async getTemplate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof TemplateIdParamsSchema>>(
      ctx,
      TemplateIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, templateId } = validation.value;
    this.logInfo(ctx, "Fetching template", { projectId, templateId });
    const result = await this.templateService.getTemplate(projectId, templateId);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "Template not found");
    this.sendSuccess(ctx, result.value);
  }

  async createTemplate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof ProjectIdParamsSchema>;
      body: z.infer<typeof CreateTemplateBodySchema>;
    }>(ctx, { params: ProjectIdParamsSchema, body: CreateTemplateBodySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, body } = validation.value;
    this.logInfo(ctx, "Creating template", { projectId: params.projectId });

    const templateData: Omit<Template, "id"> = {
      name: body.name,
      content: body.content,
      category: body.category || "general",
      variables: [],
      platforms: body.platforms || [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(body.description && { description: body.description }),
      ...(body.tags && { tags: body.tags }),
    };

    const result = await this.templateService.createTemplate(params.projectId, templateData);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value, 201);
  }

  async updateTemplate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof TemplateIdParamsSchema>;
      body: z.infer<typeof UpdateTemplateBodySchema>;
    }>(ctx, { params: TemplateIdParamsSchema, body: UpdateTemplateBodySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, body } = validation.value;
    this.logInfo(ctx, "Updating template", {
      projectId: params.projectId,
      templateId: params.templateId,
    });

    const updateData: Partial<Template> = {
      updatedAt: new Date(),
      ...(body.name && { name: body.name }),
      ...(body.description && { description: body.description }),
      ...(body.category && { category: body.category }),
      ...(body.content && { content: body.content }),
      ...(body.platforms && { platforms: body.platforms }),
      ...(body.tags && { tags: body.tags }),
    };

    const result = await this.templateService.updateTemplate(
      params.projectId,
      params.templateId,
      updateData
    );
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "Template not found");
    this.sendSuccess(ctx, result.value);
  }

  async deleteTemplate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof TemplateIdParamsSchema>>(
      ctx,
      TemplateIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, templateId } = validation.value;
    this.logInfo(ctx, "Deleting template", { projectId, templateId });
    const result = await this.templateService.deleteTemplate(projectId, templateId);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "Template not found");
    this.sendSuccess(ctx, { message: "Template deleted successfully" });
  }

  async duplicateTemplate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof TemplateIdParamsSchema>;
      body: z.infer<typeof DuplicateTemplateBodySchema>;
    }>(ctx, { params: TemplateIdParamsSchema, body: DuplicateTemplateBodySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, body } = validation.value;
    this.logInfo(ctx, "Duplicating template", {
      projectId: params.projectId,
      templateId: params.templateId,
      newName: body.name,
    });
    const result = await this.templateService.duplicateTemplate(
      params.projectId,
      params.templateId,
      body.name
    );
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "Template not found");
    this.sendSuccess(ctx, result.value, 201);
  }

  async compileTemplate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof TemplateIdParamsSchema>;
      body: z.infer<typeof CompileTemplateBodySchema>;
    }>(ctx, { params: TemplateIdParamsSchema, body: CompileTemplateBodySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, body } = validation.value;
    this.logInfo(ctx, "Compiling template", {
      projectId: params.projectId,
      templateId: params.templateId,
    });
    const result = await this.templateService.compileTemplate(
      params.projectId,
      params.templateId,
      body.context,
      body.platforms,
      body.abTestConfig
    );
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "Template not found");
    this.sendSuccess(ctx, result.value);
  }

  async validateTemplate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof TemplateIdParamsSchema>>(
      ctx,
      TemplateIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, templateId } = validation.value;
    this.logInfo(ctx, "Validating template", { projectId, templateId });
    const result = await this.templateService.validateTemplate(projectId, templateId);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value);
  }

  async getPlatformLimits(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof PlatformParamsSchema>>(
      ctx,
      PlatformParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { platform } = validation.value;
    this.logInfo(ctx, "Fetching platform limits", { platform });
    const result = await this.templateService.getPlatformLimits(platform);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "Platform not supported");
    this.sendSuccess(ctx, result.value);
  }

  async getSupportedPlatforms(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Fetching supported platforms");
    const result = await this.templateService.getSupportedPlatforms();
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value);
  }
}
