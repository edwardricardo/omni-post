// ✅ Phase 6.3: Migrated to BaseRouteHandler Pattern

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { AIService } from "./aiService.js";
import { TOKENS } from "../infrastructure/container/types.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const MessageSchema = z.object({
  role: z.string(),
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
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

class AiRouteHandler extends BaseRouteHandler {
  protected routeName = "ai";

  constructor(private readonly aiService: AIService) {
    super();
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

      const { messages, options } = validation.value;
      const result = await this.aiService.generateContent(messages, options);

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

      const { content, platform, brandVoice } = validation.value;
      const result = await this.aiService.optimizeContent(content, platform, brandVoice);

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

      const results = await this.aiService.smartAnalysis(validation.value);

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
  const handler = new AiRouteHandler(aiService);

  // Health check removed - use main /health endpoint instead

  fastify.post("/generate", async (request, reply) => handler.generateContent(request, reply));

  fastify.post("/analyze", async (request, reply) => handler.analyzeContent(request, reply));

  fastify.post("/optimize", async (request, reply) => handler.optimizeContent(request, reply));

  fastify.post("/predict", async (request, reply) => handler.predictPerformance(request, reply));

  fastify.post("/variations", async (request, reply) => handler.generateVariations(request, reply));

  fastify.post("/smart-analysis", async (request, reply) => handler.smartAnalysis(request, reply));

  // Metrics endpoint removed - use main /metrics endpoint instead

  fastify.delete("/cache", async (request, reply) => handler.clearCache(request, reply));
};

export default aiRoutes;
