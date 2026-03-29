import OpenAI from "openai";
import {
  AIProvider,
  AIMessage,
  AIResponse,
  GenerationOptions,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
  AIProviderConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from "../types.js";
import { AppError } from "../../lib/errors/AppError.js";
import { logger } from "../../lib/logger.js";

const aiLogger = logger.child({ module: "ai", provider: "openai" });

export class OpenAIProvider implements AIProvider {
  name = "openai" as const;
  private client: OpenAI;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "OpenAI availability check failed");
      return false;
    }
  }

  async generateText(messages: AIMessage[], options: GenerationOptions = {}): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: options.model || this.config.model || "gpt-4",
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7,
        top_p: options.topP || 1,
        frequency_penalty: options.frequencyPenalty || 0,
        presence_penalty: options.presencePenalty || 0,
        stream: false,
      });

      return response.choices[0]?.message?.content || "";
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "OpenAI generation failed");
      throw AppError.externalService("OpenAI", `OpenAI generation failed: ${error}`);
    }
  }

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
      aiLogger.error({ err: error }, "OpenAI analysis failed");
      throw AppError.externalService("OpenAI", `OpenAI analysis failed: ${error}`);
    }
  }

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
      aiLogger.error({ err: error }, "OpenAI optimization failed");
      throw AppError.externalService("OpenAI", `OpenAI optimization failed: ${error}`);
    }
  }

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
      aiLogger.error({ err: error }, "OpenAI prediction failed");
      throw AppError.externalService("OpenAI", `OpenAI prediction failed: ${error}`);
    }
  }

  /**
   * @method generateImage
   * @description Generates an image using OpenAI DALL-E 3 from a text prompt.
   * @param options - Image generation options including prompt, size, quality, and style
   * @returns AIResponse containing the image URL and revised prompt on success
   */
  async generateImage(options: ImageGenerationOptions): Promise<AIResponse<ImageGenerationResult>> {
    const startTime = Date.now();
    try {
      const response = await this.client.images.generate({
        model: "dall-e-3",
        prompt: options.prompt,
        n: 1,
        size: options.size || "1024x1024",
        quality: options.quality || "standard",
        style: options.style || "vivid",
      });

      const responseData = response.data;
      const imageData = responseData?.[0];
      if (!imageData?.url) {
        return {
          ok: false,
          error: {
            code: "IMAGE_GENERATION_FAILED",
            message: "No image URL returned from OpenAI",
            provider: "openai",
            retryable: true,
          },
          metadata: {
            provider: "openai",
            model: "dall-e-3",
            tokensUsed: 0,
            latency: Date.now() - startTime,
            cached: false,
          },
        };
      }

      return {
        ok: true,
        value: {
          imageUrl: imageData.url,
          revisedPrompt: imageData.revised_prompt || options.prompt,
        },
        metadata: {
          provider: "openai",
          model: "dall-e-3",
          tokensUsed: 0,
          latency: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "OpenAI image generation failed");
      return {
        ok: false,
        error: {
          code: "IMAGE_GENERATION_FAILED",
          message: error instanceof Error ? error.message : String(error),
          provider: "openai",
          retryable: true,
        },
        metadata: {
          provider: "openai",
          model: "dall-e-3",
          tokensUsed: 0,
          latency: Date.now() - startTime,
          cached: false,
        },
      };
    }
  }

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
      aiLogger.error({ err: error }, "OpenAI variation generation failed");
      throw AppError.externalService("OpenAI", `OpenAI variation generation failed: ${error}`);
    }
  }
}
