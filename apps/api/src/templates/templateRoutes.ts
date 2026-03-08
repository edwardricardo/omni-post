/**
 * Template Routes
 *
 * Thin Fastify plugin that registers all template management endpoints.
 * Resolves TemplateService and TemplateAnalytics from the DI container and
 * delegates all request handling to TemplateRouteHandler.
 *
 * Route groups:
 *   - Template CRUD      GET|POST /projects/:projectId/templates[/:templateId]
 *   - Template actions   POST .../duplicate | compile | validate | usage
 *   - Template versions  GET|POST .../versions[/:versionId/restore]
 *   - Analytics          GET .../analytics, POST .../usage
 *   - A/B testing        GET|POST .../ab-tests[/:testId/start|stop|results]
 *   - Platform info      GET /platforms[/:platform/limits]
 *
 * @module templates/templateRoutes
 */
import { FastifyPluginAsync } from "fastify";
import { TOKENS } from "../infrastructure/container/types.js";
import type { TemplateService } from "./templateService.js";
import type { templateAnalytics as TemplateAnalyticsType } from "./templateAnalytics.js";
import { TemplateRouteHandler } from "./TemplateHandlers.js";

const templateRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = fastify.container!.resolve<TemplateService>(TOKENS.TemplateService);
  const analytics = fastify.container!.resolve<typeof TemplateAnalyticsType>(
    TOKENS.TemplateAnalytics
  );

  const handler = new TemplateRouteHandler(svc, analytics);

  // ── Template CRUD ──────────────────────────────────────────────────────────

  fastify.get("/projects/:projectId/templates", (request, reply) =>
    handler.getTemplates(request, reply)
  );

  fastify.get("/projects/:projectId/templates/:templateId", (request, reply) =>
    handler.getTemplate(request, reply)
  );

  fastify.post("/projects/:projectId/templates", (request, reply) =>
    handler.createTemplate(request, reply)
  );

  fastify.put("/projects/:projectId/templates/:templateId", (request, reply) =>
    handler.updateTemplate(request, reply)
  );

  fastify.delete("/projects/:projectId/templates/:templateId", (request, reply) =>
    handler.deleteTemplate(request, reply)
  );

  // ── Template actions ───────────────────────────────────────────────────────

  fastify.post("/projects/:projectId/templates/:templateId/duplicate", (request, reply) =>
    handler.duplicateTemplate(request, reply)
  );

  fastify.post("/projects/:projectId/templates/:templateId/compile", (request, reply) =>
    handler.compileTemplate(request, reply)
  );

  fastify.post("/projects/:projectId/templates/:templateId/validate", (request, reply) =>
    handler.validateTemplate(request, reply)
  );

  // ── Template versions ──────────────────────────────────────────────────────

  fastify.get("/projects/:projectId/templates/:templateId/versions", (request, reply) =>
    handler.getTemplateVersions(request, reply)
  );

  fastify.post("/projects/:projectId/templates/:templateId/versions", (request, reply) =>
    handler.createTemplateVersion(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/:templateId/versions/:versionId/restore",
    (request, reply) => handler.restoreTemplateVersion(request, reply)
  );

  // ── Analytics & usage tracking ─────────────────────────────────────────────

  fastify.get("/projects/:projectId/templates/analytics", (request, reply) =>
    handler.getTemplateAnalytics(request, reply)
  );

  fastify.post("/projects/:projectId/templates/:templateId/usage", (request, reply) =>
    handler.trackTemplateUsage(request, reply)
  );

  // ── A/B testing ────────────────────────────────────────────────────────────

  fastify.get("/projects/:projectId/templates/ab-tests", (request, reply) =>
    handler.getABTests(request, reply)
  );

  fastify.post("/projects/:projectId/templates/ab-tests", (request, reply) =>
    handler.createABTest(request, reply)
  );

  fastify.post("/projects/:projectId/templates/ab-tests/:testId/start", (request, reply) =>
    handler.startABTest(request, reply)
  );

  fastify.post("/projects/:projectId/templates/ab-tests/:testId/stop", (request, reply) =>
    handler.stopABTest(request, reply)
  );

  fastify.get("/projects/:projectId/templates/ab-tests/:testId/results", (request, reply) =>
    handler.getABTestResults(request, reply)
  );

  // ── Platform information ───────────────────────────────────────────────────

  fastify.get("/platforms/:platform/limits", (request, reply) =>
    handler.getPlatformLimits(request, reply)
  );

  fastify.get("/platforms", (request, reply) => handler.getSupportedPlatforms(request, reply));
};

export { templateRoutes };
