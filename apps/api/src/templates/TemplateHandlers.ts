/**
 * Template Handlers - Facade
 *
 * Re-exports TemplateRouteHandler composed from three sub-handlers:
 * - TemplateCrudHandler    (CRUD, compile, validate, platform queries)
 * - TemplateABTestHandler  (A/B testing endpoints)
 * - TemplateVersionHandler (versioning, analytics, usage tracking)
 *
 * External consumers continue importing TemplateRouteHandler from this file.
 *
 * @module templates/TemplateHandlers
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler } from "@packages/api-common";
import type { TemplateService } from "./templateService.js";
import { templateAnalytics } from "./templateAnalytics.js";
import { TemplateCrudHandler } from "./TemplateCrudHandlers.js";
import { TemplateABTestHandler } from "./TemplateABTestHandlers.js";
import { TemplateVersionHandler } from "./TemplateVersionHandlers.js";

type TemplateAnalyticsService = typeof templateAnalytics;

/**
 * Template Route Handler
 * Composes CRUD, A/B test, and version sub-handlers into a single API
 */
export class TemplateRouteHandler extends BaseRouteHandler {
  protected routeName = "template";

  private readonly crudHandler: TemplateCrudHandler;
  private readonly abTestHandler: TemplateABTestHandler;
  private readonly versionHandler: TemplateVersionHandler;

  constructor(templateService: TemplateService, analyticsService: TemplateAnalyticsService) {
    super();
    this.crudHandler = new TemplateCrudHandler(templateService);
    this.abTestHandler = new TemplateABTestHandler(templateService, analyticsService);
    this.versionHandler = new TemplateVersionHandler(templateService, analyticsService);
  }

  // CRUD operations
  async getTemplates(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getTemplates(req, rep);
  }
  async getTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getTemplate(req, rep);
  }
  async createTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.createTemplate(req, rep);
  }
  async updateTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.updateTemplate(req, rep);
  }
  async deleteTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.deleteTemplate(req, rep);
  }
  async duplicateTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.duplicateTemplate(req, rep);
  }
  async compileTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.compileTemplate(req, rep);
  }
  async validateTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.validateTemplate(req, rep);
  }
  async getPlatformLimits(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getPlatformLimits(req, rep);
  }
  async getSupportedPlatforms(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getSupportedPlatforms(req, rep);
  }

  // Version and analytics operations
  async getTemplateVersions(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.getTemplateVersions(req, rep);
  }
  async createTemplateVersion(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.createTemplateVersion(req, rep);
  }
  async restoreTemplateVersion(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.restoreTemplateVersion(req, rep);
  }
  async getTemplateAnalytics(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.getTemplateAnalytics(req, rep);
  }
  async trackTemplateUsage(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.trackTemplateUsage(req, rep);
  }

  // A/B testing operations
  async getABTests(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.getABTests(req, rep);
  }
  async createABTest(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.createABTest(req, rep);
  }
  async startABTest(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.startABTest(req, rep);
  }
  async stopABTest(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.stopABTest(req, rep);
  }
  async getABTestResults(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.getABTestResults(req, rep);
  }
}
