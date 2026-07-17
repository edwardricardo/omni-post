/**
 * @file makeRoutes.ts
 * @description REST API routes for the Make (formerly Integromat) integration platform.
 *
 *   API Key Management (requireClientAuth -- admin auth):
 *   GET    /api/make/keys     -> ListIntegrationApiKeysQuery
 *   POST   /api/make/keys     -> GenerateIntegrationApiKeyUseCase (platform: MAKE)
 *   DELETE /api/make/keys/:id -> RevokeIntegrationApiKeyUseCase
 *
 *   Make REST Hooks (integration-key auth):
 *   POST   /api/make/subscribe      -> SubscribeIntegrationTriggerUseCase (platform: MAKE)
 *   DELETE /api/make/subscribe/:id  -> UnsubscribeIntegrationTriggerUseCase
 *
 *   Make Actions (integration-key auth):
 *   POST /api/make/actions/create-draft   -> CreatePostUseCase
 *   POST /api/make/actions/schedule-post  -> CreatePostUseCase + SchedulePostUseCase
 *
 *   Make Polling (integration-key auth):
 *   GET /api/make/triggers/posts-published -> last 25 published posts
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { integrationAuthResolve, integrationAuthBind } from "../auth/integrationAuthMiddleware.js";
import type {
  ListIntegrationApiKeysQuery,
  IntegrationApiKeyDto,
} from "@core/integrations/ListIntegrationApiKeysQuery.js";
import type { GenerateIntegrationApiKeyUseCase } from "@core/integrations/GenerateIntegrationApiKeyUseCase.js";
import type { RevokeIntegrationApiKeyUseCase } from "@core/integrations/RevokeIntegrationApiKeyUseCase.js";
import type { SubscribeIntegrationTriggerUseCase } from "@core/integrations/SubscribeIntegrationTriggerUseCase.js";
import type { UnsubscribeIntegrationTriggerUseCase } from "@core/integrations/UnsubscribeIntegrationTriggerUseCase.js";
import type { CreatePostUseCase } from "@core/posts/CreatePostUseCase.js";
import type { SchedulePostUseCase } from "@core/posts/SchedulePostUseCase.js";
import type { PrismaClient } from "@infra/prisma";

// ============================================================================
// Schemas
// ============================================================================

const GenerateKeyBodySchema = z.object({
  label: z.string().max(100).optional(),
});

const IdParamSchema = z.object({
  id: z.string().min(1),
});

const SubscribeBodySchema = z.object({
  event: z.string().min(1),
  targetUrl: z.string().url().startsWith("https://"),
});

const CreateDraftBodySchema = z.object({
  projectId: z.string().uuid(),
  body: z.string().min(1).max(5000),
  title: z.string().max(200).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

const SchedulePostBodySchema = z.object({
  projectId: z.string().uuid(),
  body: z.string().min(1).max(5000),
  title: z.string().max(200).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  channelIds: z.array(z.string().uuid()).min(1),
  scheduledFor: z.string().datetime(),
  timezone: z.string().optional(),
});

// ============================================================================
// Plugin
// ============================================================================

export const makeRoutes: FastifyPluginAsync = async (app) => {
  // Resolve use cases from DI
  const listKeysQuery = app.container!.resolve<ListIntegrationApiKeysQuery>(
    TOKENS.ListIntegrationApiKeysQuery
  );
  const generateKeyUseCase = app.container!.resolve<GenerateIntegrationApiKeyUseCase>(
    TOKENS.GenerateIntegrationApiKeyUseCase
  );
  const revokeKeyUseCase = app.container!.resolve<RevokeIntegrationApiKeyUseCase>(
    TOKENS.RevokeIntegrationApiKeyUseCase
  );
  const subscribeUseCase = app.container!.resolve<SubscribeIntegrationTriggerUseCase>(
    TOKENS.SubscribeIntegrationTriggerUseCase
  );
  const unsubscribeUseCase = app.container!.resolve<UnsubscribeIntegrationTriggerUseCase>(
    TOKENS.UnsubscribeIntegrationTriggerUseCase
  );
  const createPostUseCase = app.container!.resolve<CreatePostUseCase>(TOKENS.CreatePostUseCase);
  const schedulePostUseCase = app.container!.resolve<SchedulePostUseCase>(
    TOKENS.SchedulePostUseCase
  );
  const prisma = app.container!.resolve<PrismaClient>(TOKENS.PrismaClient);

  // ── API Key Management (admin auth) ─────────────────────────────────────

  app.get(
    "/make/keys",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Make"], summary: "List active Make API keys" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(400).send({ error: "Account ID required" });
      }

      const result = await listKeysQuery.execute({ accountId });
      if (!result.ok) {
        return reply.code(400).send({ error: result.error.message });
      }

      // Filter to show only MAKE keys
      const makeKeys = result.value.filter((k: IntegrationApiKeyDto) => k.platform === "MAKE");
      return reply.send({ ok: true, data: makeKeys });
    }
  );

  app.post(
    "/make/keys",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Make"], summary: "Generate a new Make API key" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(400).send({ error: "Account ID required" });
      }

      const parseResult = GenerateKeyBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }

      const result = await generateKeyUseCase.execute({
        accountId,
        platform: "MAKE",
        ...(parseResult.data.label !== undefined && { label: parseResult.data.label }),
      });

      if (!result.ok) {
        const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
        return reply.code(statusCode).send({ error: result.error.message });
      }

      return reply.code(201).send({ ok: true, data: result.value });
    }
  );

  app.delete(
    "/make/keys/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Make"], summary: "Revoke a Make API key" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(400).send({ error: "Account ID required" });
      }

      const parseResult = IdParamSchema.safeParse(request.params);
      if (!parseResult.success) {
        return reply.code(400).send({ error: "Invalid key ID" });
      }

      const result = await revokeKeyUseCase.execute({
        keyId: parseResult.data.id,
        accountId,
      });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          NOT_FOUND: 404,
          FORBIDDEN: 403,
        };
        const statusCode = statusMap[result.error.code] ?? 500;
        return reply.code(statusCode).send({ error: result.error.message });
      }

      return reply.send({ ok: true, message: "API key revoked" });
    }
  );

  // ── Make REST Hooks (integration auth) ────────────────────────────────

  app.post(
    "/make/subscribe",
    {
      onRequest: [integrationAuthResolve],
      preHandler: [integrationAuthBind],
      schema: { tags: ["Make"], summary: "Subscribe to a Make trigger event" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(400).send({ error: "Account ID required" });
      }

      const parseResult = SubscribeBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parseResult.error.issues });
      }

      const result = await subscribeUseCase.execute({
        accountId,
        platform: "MAKE",
        event: parseResult.data.event,
        targetUrl: parseResult.data.targetUrl,
      });

      if (!result.ok) {
        const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
        return reply.code(statusCode).send({ error: result.error.message });
      }

      return reply.code(201).send({ ok: true, data: result.value });
    }
  );

  app.delete(
    "/make/subscribe/:id",
    {
      onRequest: [integrationAuthResolve],
      preHandler: [integrationAuthBind],
      schema: { tags: ["Make"], summary: "Unsubscribe from a Make trigger event" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(400).send({ error: "Account ID required" });
      }

      const parseResult = IdParamSchema.safeParse(request.params);
      if (!parseResult.success) {
        return reply.code(400).send({ error: "Invalid subscription ID" });
      }

      const result = await unsubscribeUseCase.execute({
        subscriptionId: parseResult.data.id,
        accountId,
      });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          NOT_FOUND: 404,
          FORBIDDEN: 403,
        };
        const statusCode = statusMap[result.error.code] ?? 500;
        return reply.code(statusCode).send({ error: result.error.message });
      }

      return reply.send({ ok: true, message: "Subscription deactivated" });
    }
  );

  // ── Make Actions (integration auth) ───────────────────────────────────

  app.post(
    "/make/actions/create-draft",
    {
      onRequest: [integrationAuthResolve],
      preHandler: [integrationAuthBind],
      schema: { tags: ["Make"], summary: "Create a draft post via Make" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateDraftBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parseResult.error.issues });
      }

      const result = await createPostUseCase.execute({
        projectId: parseResult.data.projectId,
        body: parseResult.data.body,
        ...(parseResult.data.title !== undefined && { title: parseResult.data.title }),
        ...(parseResult.data.tags !== undefined && { tags: parseResult.data.tags }),
      });

      if (!result.ok) {
        return reply.code(400).send({ error: result.error.message });
      }

      return reply.code(201).send({ ok: true, data: result.value });
    }
  );

  app.post(
    "/make/actions/schedule-post",
    {
      onRequest: [integrationAuthResolve],
      preHandler: [integrationAuthBind],
      schema: { tags: ["Make"], summary: "Create and schedule a post via Make" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = SchedulePostBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parseResult.error.issues });
      }

      // Step 1: Create the post as a draft
      const createResult = await createPostUseCase.execute({
        projectId: parseResult.data.projectId,
        body: parseResult.data.body,
        ...(parseResult.data.title !== undefined && { title: parseResult.data.title }),
        ...(parseResult.data.tags !== undefined && { tags: parseResult.data.tags }),
      });

      if (!createResult.ok) {
        return reply.code(400).send({ error: createResult.error.message });
      }

      // Step 2: Schedule the post
      const scheduleResult = await schedulePostUseCase.execute({
        postId: createResult.value.id,
        channelIds: parseResult.data.channelIds,
        scheduledFor: parseResult.data.scheduledFor,
        ...(parseResult.data.timezone !== undefined && { timezone: parseResult.data.timezone }),
      });

      if (!scheduleResult.ok) {
        return reply.code(400).send({ error: scheduleResult.error.message });
      }

      return reply.code(201).send({
        ok: true,
        data: {
          postId: createResult.value.id,
          ...scheduleResult.value,
        },
      });
    }
  );

  // ── Make Polling Triggers (integration auth) ──────────────────────────

  app.get(
    "/make/triggers/posts-published",
    {
      onRequest: [integrationAuthResolve],
      preHandler: [integrationAuthBind],
      schema: { tags: ["Make"], summary: "Poll last 25 published posts" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(400).send({ error: "Account ID required" });
      }

      try {
        const posts = await prisma.post.findMany({
          where: {
            project: { accountId },
            status: "PUBLISHED",
          },
          orderBy: { publishedAt: "desc" },
          take: 25,
          select: {
            id: true,
            title: true,
            body: true,
            status: true,
            publishedAt: true,
            createdAt: true,
            projectId: true,
          },
        });

        return reply.send({ ok: true, data: posts });
      } catch {
        return reply.code(500).send({ error: "Failed to fetch published posts" });
      }
    }
  );
};
