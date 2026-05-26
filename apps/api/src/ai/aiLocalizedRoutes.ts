/**
 * @file aiLocalizedRoutes.ts
 * @description Client-facing REST surface for the locale-native AI
 *              generation pipeline. Exposes glossary + style-guide CRUD
 *              (per account / locale) and the
 *              `POST /ai/generate-localized` endpoint that grounds the
 *              LLM with retrieved-by-semantic-similarity terms and rules.
 *
 *              The account is taken from the customer JWT; the optional
 *              `accountId` query param (where supported) MUST match the
 *              JWT account — second barrier against IDOR even though
 *              `requireClientAuth` has already gated the request.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import type { GenerateLocalizedContentUseCase } from "@core/application/ai/GenerateLocalizedContentUseCase.js";
import type { UpsertGlossaryTermUseCase } from "@core/application/glossary/UpsertGlossaryTermUseCase.js";
import type { DeleteGlossaryTermUseCase } from "@core/application/glossary/DeleteGlossaryTermUseCase.js";
import type { ListGlossaryByLocaleQuery } from "@core/application/glossary/ListGlossaryByLocaleQuery.js";
import type { UpsertStyleGuideRuleUseCase } from "@core/application/style-guide/UpsertStyleGuideRuleUseCase.js";
import type { DeleteStyleGuideRuleUseCase } from "@core/application/style-guide/DeleteStyleGuideRuleUseCase.js";
import type { ListStyleGuideRulesByLocaleQuery } from "@core/application/style-guide/ListStyleGuideRulesByLocaleQuery.js";

const SupportedLocaleSchema = z.enum(["es", "en"]);

const GenerateBodySchema = z.object({
  locale: SupportedLocaleSchema,
  brief: z.string().min(10).max(2000),
  platforms: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(20).optional(),
});

const GlossaryUpsertBodySchema = z.object({
  locale: SupportedLocaleSchema,
  term: z.string().min(1).max(120),
  definition: z.string().min(1).max(1000),
  usage: z.string().max(500).optional(),
});

const StyleGuideUpsertBodySchema = z.object({
  id: z.string().uuid().optional(),
  locale: SupportedLocaleSchema,
  rule: z.string().min(1).max(1000),
  example: z.string().max(500).optional(),
  category: z.string().max(60).optional(),
});

const ListByLocaleQuerySchema = z.object({
  locale: SupportedLocaleSchema,
});

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

class AiLocalizedRouteHandler extends BaseRouteHandler {
  protected routeName = "ai-localized";

  constructor(
    private readonly generate: GenerateLocalizedContentUseCase,
    private readonly upsertGlossary: UpsertGlossaryTermUseCase,
    private readonly deleteGlossary: DeleteGlossaryTermUseCase,
    private readonly listGlossary: ListGlossaryByLocaleQuery,
    private readonly upsertStyleRule: UpsertStyleGuideRuleUseCase,
    private readonly deleteStyleRule: DeleteStyleGuideRuleUseCase,
    private readonly listStyleRules: ListStyleGuideRulesByLocaleQuery
  ) {
    super();
  }

  private getAccountId(request: FastifyRequest): string | undefined {
    return request.customerUser?.accountId;
  }

  async generateLocalized(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = await this.validateBody(ctx, GenerateBodySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 422, "Invalid request body");
    }

    const result = await this.generate.execute({
      accountId,
      locale: validation.value.locale,
      brief: validation.value.brief,
      ...(validation.value.platforms !== undefined && { platforms: validation.value.platforms }),
      ...(validation.value.topK !== undefined && { topK: validation.value.topK }),
    });
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }
    this.sendSuccess(ctx, result.value);
  }

  async glossaryUpsert(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) return this.sendError(ctx, 401, "Authentication required");

    const validation = await this.validateBody(ctx, GlossaryUpsertBodySchema);
    if (!validation.ok) return this.sendError(ctx, 422, "Invalid request body");

    const result = await this.upsertGlossary.execute({
      accountId,
      locale: validation.value.locale,
      term: validation.value.term,
      definition: validation.value.definition,
      ...(validation.value.usage !== undefined && { usage: validation.value.usage }),
    });
    if (!result.ok) return this.sendError(ctx, 500, result.error.message);
    this.sendSuccess(ctx, result.value, 201);
  }

  async glossaryDelete(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    if (!this.getAccountId(request)) {
      return this.sendError(ctx, 401, "Authentication required");
    }
    const params = await this.validateParams(ctx, IdParamsSchema);
    if (!params.ok) return this.sendError(ctx, 422, "Invalid id");

    const result = await this.deleteGlossary.execute({ id: params.value.id });
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      return this.sendError(ctx, status, result.error.message);
    }
    this.sendSuccess(ctx, { deleted: true });
  }

  async glossaryList(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) return this.sendError(ctx, 401, "Authentication required");

    const query = await this.validateQuery(ctx, ListByLocaleQuerySchema);
    if (!query.ok) return this.sendError(ctx, 422, "Invalid query");

    const result = await this.listGlossary.execute({ accountId, locale: query.value.locale });
    if (!result.ok) return this.sendError(ctx, 500, result.error.message);
    this.sendSuccess(ctx, result.value);
  }

  async styleRuleUpsert(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) return this.sendError(ctx, 401, "Authentication required");

    const validation = await this.validateBody(ctx, StyleGuideUpsertBodySchema);
    if (!validation.ok) return this.sendError(ctx, 422, "Invalid request body");

    const result = await this.upsertStyleRule.execute({
      accountId,
      locale: validation.value.locale,
      rule: validation.value.rule,
      ...(validation.value.id !== undefined && { id: validation.value.id }),
      ...(validation.value.example !== undefined && { example: validation.value.example }),
      ...(validation.value.category !== undefined && { category: validation.value.category }),
    });
    if (!result.ok) return this.sendError(ctx, 500, result.error.message);
    this.sendSuccess(ctx, result.value, 201);
  }

  async styleRuleDelete(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    if (!this.getAccountId(request)) {
      return this.sendError(ctx, 401, "Authentication required");
    }
    const params = await this.validateParams(ctx, IdParamsSchema);
    if (!params.ok) return this.sendError(ctx, 422, "Invalid id");

    const result = await this.deleteStyleRule.execute({ id: params.value.id });
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      return this.sendError(ctx, status, result.error.message);
    }
    this.sendSuccess(ctx, { deleted: true });
  }

  async styleRuleList(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = this.getAccountId(request);
    if (!accountId) return this.sendError(ctx, 401, "Authentication required");

    const query = await this.validateQuery(ctx, ListByLocaleQuerySchema);
    if (!query.ok) return this.sendError(ctx, 422, "Invalid query");

    const result = await this.listStyleRules.execute({ accountId, locale: query.value.locale });
    if (!result.ok) return this.sendError(ctx, 500, result.error.message);
    this.sendSuccess(ctx, result.value);
  }
}

export const aiLocalizedRoutes: FastifyPluginAsync = async (app) => {
  const handler = new AiLocalizedRouteHandler(
    app.container.resolve<GenerateLocalizedContentUseCase>(TOKENS.GenerateLocalizedContentUseCase),
    app.container.resolve<UpsertGlossaryTermUseCase>(TOKENS.UpsertGlossaryTermUseCase),
    app.container.resolve<DeleteGlossaryTermUseCase>(TOKENS.DeleteGlossaryTermUseCase),
    app.container.resolve<ListGlossaryByLocaleQuery>(TOKENS.ListGlossaryByLocaleQuery),
    app.container.resolve<UpsertStyleGuideRuleUseCase>(TOKENS.UpsertStyleGuideRuleUseCase),
    app.container.resolve<DeleteStyleGuideRuleUseCase>(TOKENS.DeleteStyleGuideRuleUseCase),
    app.container.resolve<ListStyleGuideRulesByLocaleQuery>(TOKENS.ListStyleGuideRulesByLocaleQuery)
  );

  app.post(
    "/ai/generate-localized",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["AI", "Localization"],
        summary: "Generate locale-native content grounded by glossary + style-guide RAG",
      },
    },
    (req, reply) => handler.generateLocalized(req, reply)
  );

  app.post(
    "/ai/glossary",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI", "Localization"], summary: "Upsert a glossary term" },
    },
    (req, reply) => handler.glossaryUpsert(req, reply)
  );

  app.delete(
    "/ai/glossary/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI", "Localization"], summary: "Delete a glossary term" },
    },
    (req, reply) => handler.glossaryDelete(req, reply)
  );

  app.get(
    "/ai/glossary",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI", "Localization"], summary: "List the account's glossary by locale" },
    },
    (req, reply) => handler.glossaryList(req, reply)
  );

  app.post(
    "/ai/style-guide",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI", "Localization"], summary: "Upsert a style-guide rule" },
    },
    (req, reply) => handler.styleRuleUpsert(req, reply)
  );

  app.delete(
    "/ai/style-guide/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["AI", "Localization"], summary: "Delete a style-guide rule" },
    },
    (req, reply) => handler.styleRuleDelete(req, reply)
  );

  app.get(
    "/ai/style-guide",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["AI", "Localization"],
        summary: "List the account's style-guide rules by locale",
      },
    },
    (req, reply) => handler.styleRuleList(req, reply)
  );
};
