/**
 * @file TemplateHandlers.ts
 * @description Template route handler facade composing TemplateCrudHandler,
 *              TemplateABTestHandler, and TemplateVersionHandler into a unified API.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { BaseRouteHandler } from "../lib/route-handler/index.js";
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
  /**
   * @method getTemplates
   * @description Lists templates for the authenticated account.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getTemplates(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getTemplates(req, rep);
  }
  /**
   * @method getTemplate
   * @description Fetches a single template by id.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getTemplate(req, rep);
  }
  /**
   * @method createTemplate
   * @description Creates a new template from the request body.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async createTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.createTemplate(req, rep);
  }
  /**
   * @method updateTemplate
   * @description Updates an existing template.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async updateTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.updateTemplate(req, rep);
  }
  /**
   * @method deleteTemplate
   * @description Deletes a template by id.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async deleteTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.deleteTemplate(req, rep);
  }
  /**
   * @method duplicateTemplate
   * @description Creates a copy of a template.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async duplicateTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.duplicateTemplate(req, rep);
  }
  /**
   * @method compileTemplate
   * @description Compiles a template body against provided variables.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async compileTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.compileTemplate(req, rep);
  }
  /**
   * @method validateTemplate
   * @description Validates a template body against the requested platform limits.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async validateTemplate(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.validateTemplate(req, rep);
  }
  /**
   * @method getPlatformLimits
   * @description Returns the configured per-platform template limits.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getPlatformLimits(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getPlatformLimits(req, rep);
  }
  /**
   * @method getSupportedPlatforms
   * @description Lists platforms supported by the template engine.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getSupportedPlatforms(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.crudHandler.getSupportedPlatforms(req, rep);
  }

  // Version and analytics operations
  /**
   * @method getTemplateVersions
   * @description Lists versions of a template.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getTemplateVersions(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.getTemplateVersions(req, rep);
  }
  /**
   * @method createTemplateVersion
   * @description Creates a new immutable version snapshot of a template.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async createTemplateVersion(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.createTemplateVersion(req, rep);
  }
  /**
   * @method restoreTemplateVersion
   * @description Restores a template to a prior version.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async restoreTemplateVersion(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.restoreTemplateVersion(req, rep);
  }
  /**
   * @method getTemplateAnalytics
   * @description Returns usage analytics for a template.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getTemplateAnalytics(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.getTemplateAnalytics(req, rep);
  }
  /**
   * @method trackTemplateUsage
   * @description Records a usage event for a template.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async trackTemplateUsage(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.versionHandler.trackTemplateUsage(req, rep);
  }

  // A/B testing operations
  /**
   * @method getABTests
   * @description Lists A/B tests for the account.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getABTests(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.getABTests(req, rep);
  }
  /**
   * @method createABTest
   * @description Creates a new A/B test for two or more template variants.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async createABTest(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.createABTest(req, rep);
  }
  /**
   * @method startABTest
   * @description Starts a previously created A/B test.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async startABTest(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.startABTest(req, rep);
  }
  /**
   * @method stopABTest
   * @description Stops a running A/B test.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async stopABTest(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.stopABTest(req, rep);
  }
  /**
   * @method getABTestResults
   * @description Returns the current statistical results of an A/B test.
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @returns Resolves when the reply is sent
   */
  async getABTestResults(req: FastifyRequest, rep: FastifyReply): Promise<void> {
    return this.abTestHandler.getABTestResults(req, rep);
  }
}
