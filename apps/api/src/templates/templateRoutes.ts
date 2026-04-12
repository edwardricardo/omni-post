/**
 * @file templateRoutes.ts
 * @description Fastify plugin registering all template management endpoints with
 *              DI-resolved services and delegation to TemplateRouteHandler.
 * @layer infrastructure
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
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
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

  fastify.get(
    "/projects/:projectId/templates",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "List templates for project" },
    },
    (request, reply) => handler.getTemplates(request, reply)
  );

  fastify.get(
    "/projects/:projectId/templates/:templateId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Get template by ID" },
    },
    (request, reply) => handler.getTemplate(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Create template" },
    },
    (request, reply) => handler.createTemplate(request, reply)
  );

  fastify.put(
    "/projects/:projectId/templates/:templateId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Update template" },
    },
    (request, reply) => handler.updateTemplate(request, reply)
  );

  fastify.delete(
    "/projects/:projectId/templates/:templateId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Delete template" },
    },
    (request, reply) => handler.deleteTemplate(request, reply)
  );

  // ── Template actions ───────────────────────────────────────────────────────

  fastify.post(
    "/projects/:projectId/templates/:templateId/duplicate",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Duplicate template" },
    },
    (request, reply) => handler.duplicateTemplate(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/:templateId/compile",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Compile template" },
    },
    (request, reply) => handler.compileTemplate(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/:templateId/validate",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Validate template" },
    },
    (request, reply) => handler.validateTemplate(request, reply)
  );

  // ── Template versions ──────────────────────────────────────────────────────

  fastify.get(
    "/projects/:projectId/templates/:templateId/versions",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "List template versions" },
    },
    (request, reply) => handler.getTemplateVersions(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/:templateId/versions",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Create template version" },
    },
    (request, reply) => handler.createTemplateVersion(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/:templateId/versions/:versionId/restore",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Restore template version" },
    },
    (request, reply) => handler.restoreTemplateVersion(request, reply)
  );

  // ── Analytics & usage tracking ─────────────────────────────────────────────

  fastify.get(
    "/projects/:projectId/templates/analytics",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Get template analytics" },
    },
    (request, reply) => handler.getTemplateAnalytics(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/:templateId/usage",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Track template usage" },
    },
    (request, reply) => handler.trackTemplateUsage(request, reply)
  );

  // ── A/B testing ────────────────────────────────────────────────────────────

  fastify.get(
    "/projects/:projectId/templates/ab-tests",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "List A/B tests" },
    },
    (request, reply) => handler.getABTests(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/ab-tests",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Create A/B test" },
    },
    (request, reply) => handler.createABTest(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/ab-tests/:testId/start",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Start A/B test" },
    },
    (request, reply) => handler.startABTest(request, reply)
  );

  fastify.post(
    "/projects/:projectId/templates/ab-tests/:testId/stop",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Stop A/B test" },
    },
    (request, reply) => handler.stopABTest(request, reply)
  );

  fastify.get(
    "/projects/:projectId/templates/ab-tests/:testId/results",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Get A/B test results" },
    },
    (request, reply) => handler.getABTestResults(request, reply)
  );

  // ── Platform information ───────────────────────────────────────────────────

  fastify.get(
    "/platforms/:platform/limits",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Get platform limits" },
    },
    (request, reply) => handler.getPlatformLimits(request, reply)
  );

  fastify.get(
    "/platforms",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Templates"], summary: "Get supported platforms" },
    },
    (request, reply) => handler.getSupportedPlatforms(request, reply)
  );
};

export { templateRoutes };
