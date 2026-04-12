/**
 * @file TemplateVersionHandlers.ts
 * @description Route handlers for template versioning, usage tracking, and analytics
 *              endpoints including version history and restore operations.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { TemplateService } from "./templateService.js";
import type { templateAnalytics } from "./templateAnalytics.js";
import type { TemplateVersion } from "./templateTypes.js";
import {
  ProjectIdParamsSchema,
  TemplateIdParamsSchema,
  VersionIdParamsSchema,
  AnalyticsQuerySchema,
  CreateVersionBodySchema,
  TrackUsageBodySchema,
} from "./templateSchemas.js";

type TemplateAnalyticsService = typeof templateAnalytics;

interface TemplateUsageEvent {
  action: "VIEW" | "USE" | "COMPILE" | "LIKE" | "SHARE";
  timestamp: Date;
  context?: Record<string, unknown>;
  variantId?: string;
}

/**
 * Template Version and Analytics Route Handler
 * Handles version management, usage tracking, and analytics queries
 */
export class TemplateVersionHandler extends BaseRouteHandler {
  protected routeName = "template-version";

  constructor(
    private readonly templateService: TemplateService,
    private readonly templateAnalytics: TemplateAnalyticsService
  ) {
    super();
  }

  async getTemplateVersions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof TemplateIdParamsSchema>>(
      ctx,
      TemplateIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, templateId } = validation.value;
    this.logInfo(ctx, "Fetching template versions", { projectId, templateId });
    const result = await this.templateService.getTemplateVersions(projectId, templateId);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value);
  }

  async createTemplateVersion(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof TemplateIdParamsSchema>;
      body: z.infer<typeof CreateVersionBodySchema>;
    }>(ctx, { params: TemplateIdParamsSchema, body: CreateVersionBodySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, body } = validation.value;
    this.logInfo(ctx, "Creating template version", {
      projectId: params.projectId,
      templateId: params.templateId,
    });
    const versionData: Omit<TemplateVersion, "id" | "createdAt"> = {
      templateId: params.templateId,
      version: 0,
      content: body.content,
      variables: body.variables ? Object.keys(body.variables) : [],
      platforms: [],
      tags: [],
      changeLog: body.changes || "Version update",
      author: { id: "system", name: "System" },
      isActive: true,
      branchName: "main",
      commitMessage: body.changes || "Version update",
    };

    const result = await this.templateService.createTemplateVersion(
      params.projectId,
      params.templateId,
      versionData
    );
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value, 201);
  }

  async restoreTemplateVersion(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof VersionIdParamsSchema>>(
      ctx,
      VersionIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, templateId, versionId } = validation.value;
    this.logInfo(ctx, "Restoring template version", { projectId, templateId, versionId });
    const result = await this.templateService.restoreTemplateVersion(
      projectId,
      templateId,
      versionId
    );
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "Template or version not found");
    this.sendSuccess(ctx, result.value);
  }

  async getTemplateAnalytics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof ProjectIdParamsSchema>;
      query: z.infer<typeof AnalyticsQuerySchema>;
    }>(ctx, { params: ProjectIdParamsSchema, query: AnalyticsQuerySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, query } = validation.value;
    const filters = {
      ...(query.startDate && { startDate: new Date(query.startDate) }),
      ...(query.endDate && { endDate: new Date(query.endDate) }),
      ...(query.templateIds && { templateIds: query.templateIds.split(",") }),
    };

    this.logInfo(ctx, "Fetching template analytics", { projectId: params.projectId, filters });
    const analytics = await this.templateAnalytics.getTemplateAnalytics(params.projectId, filters);
    this.sendSuccess(ctx, analytics);
  }

  async trackTemplateUsage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof TemplateIdParamsSchema>;
      body: z.infer<typeof TrackUsageBodySchema>;
    }>(ctx, { params: TemplateIdParamsSchema, body: TrackUsageBodySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, body } = validation.value;
    this.logInfo(ctx, "Tracking template usage", {
      projectId: params.projectId,
      templateId: params.templateId,
      action: body.action,
    });

    const usageEvent: TemplateUsageEvent = {
      action: body.action,
      timestamp: new Date(),
      ...(body.context && { context: body.context }),
      ...(body.variantId && { variantId: body.variantId }),
    };

    await this.templateAnalytics.trackTemplateUsage(
      params.projectId,
      params.templateId,
      usageEvent
    );
    this.sendSuccess(ctx, { message: "Usage tracked successfully" });
  }
}
