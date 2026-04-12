/**
 * @file TemplateABTestHandlers.ts
 * @description Route handlers for template A/B testing endpoints including test creation,
 *              start/stop lifecycle, and results retrieval.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { TemplateService } from "./templateService.js";
import type { templateAnalytics } from "./templateAnalytics.js";
import type { ABTestConfig } from "./templateTypes.js";
import {
  ProjectIdParamsSchema,
  TestIdParamsSchema,
  ABTestStatusQuerySchema,
  CreateABTestBodySchema,
} from "./templateSchemas.js";

type TemplateAnalyticsService = typeof templateAnalytics;

/**
 * Template A/B Test Route Handler
 * Handles A/B test creation, start, stop, and results retrieval
 */
export class TemplateABTestHandler extends BaseRouteHandler {
  protected routeName = "template-abtest";

  constructor(
    private readonly templateService: TemplateService,
    private readonly templateAnalytics: TemplateAnalyticsService
  ) {
    super();
  }

  async getABTests(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof ProjectIdParamsSchema>;
      query: z.infer<typeof ABTestStatusQuerySchema>;
    }>(ctx, { params: ProjectIdParamsSchema, query: ABTestStatusQuerySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, query } = validation.value;
    this.logInfo(ctx, "Fetching A/B tests", { projectId: params.projectId, status: query.status });
    const result = await this.templateService.getABTests(params.projectId, query.status);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value);
  }

  async createABTest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      params: z.infer<typeof ProjectIdParamsSchema>;
      body: z.infer<typeof CreateABTestBodySchema>;
    }>(ctx, { params: ProjectIdParamsSchema, body: CreateABTestBodySchema });

    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { params, body } = validation.value;
    this.logInfo(ctx, "Creating A/B test", { projectId: params.projectId, testName: body.name });

    const rawConfig = body.config as Record<string, unknown>;
    const testData: {
      name: string;
      templateId: string;
      config: ABTestConfig;
      description?: string;
    } = {
      name: body.name,
      templateId: body.templateId,
      config: {
        enabled: typeof rawConfig.enabled === "boolean" ? rawConfig.enabled : true,
        variants: Array.isArray(rawConfig.variants)
          ? (rawConfig.variants as ABTestConfig["variants"])
          : [],
        ...(Array.isArray(rawConfig.trafficSplit) && {
          trafficSplit: rawConfig.trafficSplit as number[],
        }),
        ...(rawConfig.startDate instanceof Date && { startDate: rawConfig.startDate }),
        ...(rawConfig.endDate instanceof Date && { endDate: rawConfig.endDate }),
      },
      ...(body.description && { description: body.description }),
    };

    const result = await this.templateService.createABTest(params.projectId, testData);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    this.sendSuccess(ctx, result.value, 201);
  }

  async startABTest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof TestIdParamsSchema>>(
      ctx,
      TestIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, testId } = validation.value;
    this.logInfo(ctx, "Starting A/B test", { projectId, testId });
    const result = await this.templateService.startABTest(projectId, testId);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "A/B test not found");
    this.sendSuccess(ctx, result.value);
  }

  async stopABTest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof TestIdParamsSchema>>(
      ctx,
      TestIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, testId } = validation.value;
    this.logInfo(ctx, "Stopping A/B test", { projectId, testId });
    const result = await this.templateService.stopABTest(projectId, testId);
    if (!result.ok) return this.sendError(ctx, 500, result.error);
    if (!result.value) return this.sendError(ctx, 404, "A/B test not found");
    this.sendSuccess(ctx, result.value);
  }

  async getABTestResults(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateParams<z.infer<typeof TestIdParamsSchema>>(
      ctx,
      TestIdParamsSchema
    );
    if (!validation.ok) return this.sendError(ctx, 400, "Invalid request parameters");

    const { projectId, testId } = validation.value;
    this.logInfo(ctx, "Fetching A/B test results", { projectId, testId });
    const results = await this.templateAnalytics.getABTestResults(projectId, testId);
    if (!results) return this.sendError(ctx, 404, "A/B test not found");
    this.sendSuccess(ctx, results);
  }
}
