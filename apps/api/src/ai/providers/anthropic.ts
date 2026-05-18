/**
 * @file anthropic.ts
 * @description Anthropic provider adapter implementing the AIProvider interface.
 *   Supports Claude models for content generation, analysis, optimization,
 *   performance prediction, and content variations.
 * @layer infrastructure
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  AIMessage,
  GenerationOptions,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
  AIProviderConfig,
  StructuredOutputSpec,
} from "../types.js";
import { AppError } from "../../lib/errors/AppError.js";
import { logger } from "../../lib/logger.js";

const aiLogger = logger.child({ module: "ai", provider: "anthropic" });

/**
 * @class AnthropicProvider
 * @description Anthropic (Claude) provider for AI content operations.
 */
export class AnthropicProvider implements AIProvider {
  name = "anthropic" as const;
  private client: Anthropic;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeout,
    });
  }

  /**
   * @method isAvailable
   * @description Checks if the Anthropic API is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.config.model || "claude-sonnet-4-6",
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Anthropic availability check failed");
      return false;
    }
  }

  /**
   * @method generateText
   * @description Generates text using Claude messages API.
   * @param messages - Conversation messages
   * @param options - Generation options (model, temperature, maxTokens)
   * @returns Generated text string
   */
  async generateText(messages: AIMessage[], options: GenerationOptions = {}): Promise<string> {
    try {
      const systemMessage = messages.find((m) => m.role === "system");
      const userMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const response = await this.client.messages.create({
        model: options.model || this.config.model || "claude-sonnet-4-6",
        max_tokens: options.maxTokens || 1000,
        ...(systemMessage && { system: systemMessage.content }),
        messages: userMessages,
        temperature: options.temperature ?? 0.7,
      });

      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.text ?? "";
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Anthropic generation failed");
      throw AppError.externalService("Anthropic", `Anthropic generation failed: ${error}`);
    }
  }

  /**
   * @method generateStructured
   * @description Schema-validated generation via Claude forced tool-use: the
   *   schema is registered as a single tool and `tool_choice` forces it, so
   *   Claude returns structured `input` matching the schema. Output is routed
   *   through `spec.parse` so callers get a validated `T`, never raw text.
   * @param messages - Conversation messages.
   * @param spec - Technology-free structured-output spec (name/schema/parse).
   * @param options - Generation options (model, tokens, temperature).
   * @returns The validated structured value `T`.
   */
  async generateStructured<T>(
    messages: AIMessage[],
    spec: StructuredOutputSpec<T>,
    options: GenerationOptions = {}
  ): Promise<T> {
    try {
      const systemMessage = messages.find((m) => m.role === "system");
      const userMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const response = await this.client.messages.create({
        model: options.model || this.config.model || "claude-sonnet-4-6",
        max_tokens: options.maxTokens || 1000,
        ...(systemMessage && { system: systemMessage.content }),
        messages: userMessages,
        temperature: options.temperature ?? 0.7,
        tools: [
          {
            name: spec.name,
            ...(spec.description !== undefined && { description: spec.description }),
            input_schema: spec.jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: spec.name },
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw AppError.externalService(
          "Anthropic",
          "Anthropic returned no tool_use block for structured output"
        );
      }
      return spec.parse(toolUse.input);
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Anthropic structured generation failed");
      throw AppError.externalService(
        "Anthropic",
        `Anthropic structured generation failed: ${error}`
      );
    }
  }

  /**
   * @method analyzeContent
   * @description Analyzes content using Claude for sentiment, tone, readability, or engagement.
   */
  async analyzeContent(
    content: string,
    analysisType: "sentiment" | "tone" | "readability" | "engagement"
  ): Promise<Partial<ContentAnalysis>> {
    const prompts = {
      sentiment: `Analyze the sentiment of this content and return a JSON response with score (-1 to 1), label (positive/negative/neutral), and confidence (0-1):\n\n"${content}"`,
      tone: `Analyze the tone of this content and return a JSON response with detected tone, confidence (0-1), and suggestions for improvement:\n\n"${content}"`,
      readability: `Analyze the readability of this content and return a JSON response with score (0-100), level description, and suggestions:\n\n"${content}"`,
      engagement: `Analyze the engagement potential of this content and return a JSON response with score (0-100) and specific factors that impact engagement:\n\n"${content}"`,
    };

    try {
      const response = await this.generateText([
        {
          role: "system",
          content: "You are an expert content analyzer. Always respond with valid JSON only.",
        },
        { role: "user", content: prompts[analysisType] },
      ]);
      return JSON.parse(response);
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Anthropic analysis failed");
      throw AppError.externalService("Anthropic", `Anthropic analysis failed: ${error}`);
    }
  }

  /**
   * @method optimizeContent
   * @description Optimizes content for a specific platform using Claude.
   */
  async optimizeContent(
    content: string,
    platform: string,
    brandVoice?: string
  ): Promise<ContentOptimization> {
    const prompt = `Optimize this content for ${platform}${brandVoice ? ` with a ${brandVoice} brand voice` : ""}.

Return a JSON response with:
- optimizedText: the improved content
- changes: array of modifications made
- hashtags: relevant hashtags for the platform
- mentions: suggested mentions if applicable
- mediasuggestions: recommended media types
- platformSpecific: platform-optimized versions

Content to optimize:
"${content}"`;

    try {
      const response = await this.generateText([
        {
          role: "system",
          content:
            "You are an expert social media content optimizer. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ]);
      return JSON.parse(response);
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Anthropic optimization failed");
      throw AppError.externalService("Anthropic", `Anthropic optimization failed: ${error}`);
    }
  }

  /**
   * @method predictPerformance
   * @description Predicts content performance on a given platform using Claude.
   */
  async predictPerformance(
    content: string,
    platform: string,
    historicalData?: unknown[]
  ): Promise<PerformancePrediction> {
    const prompt = `Estimate the likely performance of this content on ${platform}.
    ${historicalData ? `Historical data: ${JSON.stringify(historicalData.slice(0, 5))}` : ""}

Return a JSON response with:
- platform: the platform name
- metrics: expectedEngagement, expectedReach, viralPotential, conversionPotential
- optimalTiming: best time to post
- competitiveAnalysis: how it compares to competitors

Content:
"${content}"`;

    try {
      const response = await this.generateText([
        {
          role: "system",
          content:
            "You are an expert social media performance analyst. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ]);
      return JSON.parse(response);
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Anthropic prediction failed");
      throw AppError.externalService("Anthropic", `Anthropic prediction failed: ${error}`);
    }
  }

  /**
   * @method generateVariations
   * @description Generates content variations by tone, length, or audience using Claude.
   */
  async generateVariations(
    content: string,
    variationType: "tone" | "length" | "audience",
    count: number
  ): Promise<string[]> {
    const prompt = `Generate ${count} variations of this content, varying the ${variationType}:

"${content}"

Return as a JSON array of strings.`;

    try {
      const response = await this.generateText([
        {
          role: "system",
          content:
            "You are an expert content variation generator. Always respond with a valid JSON array of strings only.",
        },
        { role: "user", content: prompt },
      ]);
      return JSON.parse(response);
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Anthropic variation generation failed");
      throw AppError.externalService(
        "Anthropic",
        `Anthropic variation generation failed: ${error}`
      );
    }
  }
}
