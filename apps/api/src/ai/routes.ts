// ✅ Phase 6.3: Migrated to BaseRouteHandler Pattern

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { AIService } from "./aiService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GetBrandVoiceQuery } from "../application/brand-voice/GetBrandVoiceQuery.js";
import { authenticateMiddleware } from "../auth/authMiddleware.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const GenerateOptionsSchema = z
  .object({
    model: z.string().optional(),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
  })
  .optional();

const GenerateContentBodySchema = z.object({
  messages: z.array(MessageSchema).min(1, { message: "Messages array cannot be empty" }),
  options: GenerateOptionsSchema,
  provider: z.string().optional(),
  accountId: z.string().uuid().optional(),
});

const AnalysisTypeSchema = z.enum(["sentiment", "tone", "readability", "engagement"]);

const AnalyzeContentBodySchema = z.object({
  content: z.string().min(1),
  analysisType: AnalysisTypeSchema,
  provider: z.string().optional(),
});

const OptimizeContentBodySchema = z.object({
  content: z.string().min(1),
  platform: z.string().min(1),
  brandVoice: z.string().optional(),
  provider: z.string().optional(),
  accountId: z.string().uuid().optional(),
});

const PredictPerformanceBodySchema = z.object({
  content: z.string().min(1),
  platform: z.string().min(1),
  historicalData: z.array(z.any()).optional(),
  provider: z.string().optional(),
});

const VariationTypeSchema = z.enum(["tone", "length", "audience"]);

const GenerateVariationsBodySchema = z.object({
  content: z.string().min(1),
  variationType: VariationTypeSchema,
  count: z.number().int().min(1).max(10),
  provider: z.string().optional(),
});

const SmartAnalysisBodySchema = z.object({
  content: z.string().min(1),
  platform: z.string().optional().default("twitter"),
  brandVoice: z.string().optional(),
  includeOptimization: z.boolean().optional().default(true),
  includePrediction: z.boolean().optional().default(true),
  includeVariations: z.boolean().optional().default(false),
  variationCount: z.number().int().min(1).max(10).optional().default(3),
  accountId: z.string().uuid().optional(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

class AiRouteHandler extends BaseRouteHandler {
  protected routeName = "ai";

  constructor(
    private readonly aiService: AIService,
    private readonly getBrandVoiceQuery?: GetBrandVoiceQuery
  ) {
    super();
  }

  /**
   * Resolves the active brand voice system prompt for the given account.
   * Returns undefined when no brand voice is configured or accountId is absent.
   */
  private async resolveBrandVoicePrompt(accountId?: string): Promise<string | undefined> {
    if (!accountId || !this.getBrandVoiceQuery) {
      return undefined;
    }
    const result = await this.getBrandVoiceQuery.execute({ accountId });
    if (!result.ok || !result.value || !result.value.isActive) {
      return undefined;
    }
    return result.value.systemPrompt;
  }

  /**
   * Health check for AI services
   * GET /health
   */
  async healthCheck(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const result = await this.aiService.healthCheck();
      reply.send(result);
    } catch (error: unknown) {
      this.sendError(ctx, 500, error instanceof Error ? error.message : "Unknown error");
    }
  }

  /**
   * Generate content with AI
   * POST /generate
   */
  async generateContent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const validation = await this.validateBody(ctx, GenerateContentBodySchema);
      if (!validation.ok) {
        return this.sendError(ctx, 400, "Messages array is required");
      }

      const { messages, options, accountId } = validation.value;
      const brandVoicePrompt = await this.resolveBrandVoicePrompt(accountId);
      const effectiveMessages =
        brandVoicePrompt && !messages.some((m) => m.role === "system")
          ? [{ role: "system" as const, content: brandVoicePrompt }, ...messages]
          : messages;
      const result = await this.aiService.generateContent(
        effectiveMessages,
        options as import("./types.js").GenerationOptions | undefined
      );

      this.sendSuccess(ctx, result, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Analyze content (sentiment, tone, readability, engagement)
   * POST /analyze
   */
  async analyzeContent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const validation = await this.validateBody(ctx, AnalyzeContentBodySchema);
      if (!validation.ok) {
        return this.sendError(ctx, 400, "Content and analysisType are required");
      }

      const { content, analysisType } = validation.value;
      const result = await this.aiService.analyzeContent(content, analysisType);

      this.sendSuccess(ctx, result, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Optimize content for platform
   * POST /optimize
   */
  async optimizeContent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const validation = await this.validateBody(ctx, OptimizeContentBodySchema);
      if (!validation.ok) {
        return this.sendError(ctx, 400, "Content and platform are required");
      }

      const { content, platform, brandVoice, accountId } = validation.value;
      const effectiveBrandVoice = brandVoice ?? (await this.resolveBrandVoicePrompt(accountId));
      const result = await this.aiService.optimizeContent(content, platform, effectiveBrandVoice);

      this.sendSuccess(ctx, result, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Estimate content performance using AI provider analysis.
   * POST /predict
   *
   * Delegates to an external AI provider (OpenAI, Gemini, Perplexity) for
   * content-based performance estimation. The endpoint name "predict" is
   * retained for API compatibility; results are AI-assisted estimates, not
   * statistically validated predictions.
   */
  async predictPerformance(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const validation = await this.validateBody(ctx, PredictPerformanceBodySchema);
      if (!validation.ok) {
        return this.sendError(ctx, 400, "Content and platform are required");
      }

      const { content, platform, historicalData } = validation.value;
      const result = await this.aiService.predictPerformance(content, platform, historicalData);

      this.sendSuccess(ctx, result, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Generate content variations
   * POST /variations
   */
  async generateVariations(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const validation = await this.validateBody(ctx, GenerateVariationsBodySchema);
      if (!validation.ok) {
        return this.sendError(ctx, 400, "Content, variationType, and count are required");
      }

      const { content, variationType, count } = validation.value;
      const result = await this.aiService.generateVariations(content, variationType, count);

      this.sendSuccess(ctx, result, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Combined content analysis (runs multiple analyses in parallel).
   * POST /smart-analysis
   *
   * Orchestrates sentiment, tone, readability, and engagement analyses
   * via external AI providers. Despite the "smart" naming, this is a
   * parallel aggregation of AI provider responses, not a proprietary
   * ML pipeline.
   */
  async smartAnalysis(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const validation = await this.validateBody(ctx, SmartAnalysisBodySchema);
      if (!validation.ok) {
        return this.sendError(ctx, 400, "Content is required");
      }

      const { accountId, ...analysisParams } = validation.value;
      const brandVoicePrompt = await this.resolveBrandVoicePrompt(accountId);
      const effectiveParams = brandVoicePrompt
        ? { ...analysisParams, brandVoice: analysisParams.brandVoice ?? brandVoicePrompt }
        : analysisParams;
      const results = await this.aiService.smartAnalysis(effectiveParams);

      this.sendSuccess(
        ctx,
        {
          success: true,
          ...results,
        },
        200
      );
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Get AI usage metrics
   * GET /metrics
   */
  async getMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const result = await this.aiService.getMetrics();
      this.sendSuccess(ctx, result, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }

  /**
   * Clear AI cache
   * DELETE /cache
   */
  async clearCache(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const result = await this.aiService.clearCache();
      this.sendSuccess(ctx, result, 200);
    } catch (error: unknown) {
      this.handleUnexpectedError(ctx, error);
    }
  }
}

// ============================================================================
// Schema Exports (for tests and external consumers)
// ============================================================================

export {
  MessageSchema,
  GenerateOptionsSchema,
  GenerateContentBodySchema,
  AnalysisTypeSchema,
  AnalyzeContentBodySchema,
  OptimizeContentBodySchema,
  PredictPerformanceBodySchema,
  VariationTypeSchema,
  GenerateVariationsBodySchema,
  SmartAnalysisBodySchema,
};

// ============================================================================
// Fastify Plugin Export
// ============================================================================

const aiRoutes: FastifyPluginAsync = async (fastify) => {
  const aiService = fastify.container!.resolve<AIService>(TOKENS.AIService);
  const getBrandVoiceQuery = fastify.container!.resolve<GetBrandVoiceQuery>(
    TOKENS.GetBrandVoiceQuery
  );
  const handler = new AiRouteHandler(aiService, getBrandVoiceQuery);

  // Health check removed - use main /health endpoint instead

  fastify.post(
    "/generate",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["AI"], summary: "Generate content with AI" },
    },
    async (request, reply) => handler.generateContent(request, reply)
  );

  fastify.post(
    "/analyze",
    { preHandler: [authenticateMiddleware], schema: { tags: ["AI"], summary: "Analyze content" } },
    async (request, reply) => handler.analyzeContent(request, reply)
  );

  fastify.post(
    "/optimize",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["AI"], summary: "Optimize content for platform" },
    },
    async (request, reply) => handler.optimizeContent(request, reply)
  );

  fastify.post(
    "/predict",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["AI"], summary: "Estimate content performance" },
    },
    async (request, reply) => handler.predictPerformance(request, reply)
  );

  fastify.post(
    "/variations",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["AI"], summary: "Generate content variations" },
    },
    async (request, reply) => handler.generateVariations(request, reply)
  );

  fastify.post(
    "/smart-analysis",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["AI"], summary: "Combined content analysis" },
    },
    async (request, reply) => handler.smartAnalysis(request, reply)
  );

  // Metrics endpoint removed - use main /metrics endpoint instead

  fastify.delete(
    "/cache",
    { preHandler: [authenticateMiddleware], schema: { tags: ["AI"], summary: "Clear AI cache" } },
    async (request, reply) => handler.clearCache(request, reply)
  );
};

export default aiRoutes;
