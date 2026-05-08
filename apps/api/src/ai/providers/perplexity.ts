/**
 * @file perplexity.ts
 * @description Perplexity AI provider adapter implementing the AIProvider interface
 *              for content generation, analysis, optimization, and predictions.
 * @layer infrastructure
 */
import {
  AIProvider,
  AIMessage,
  GenerationOptions,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
  AIProviderConfig,
} from "../types.js";
import { AppError } from "../../lib/errors/AppError.js";
import { logger } from "../../lib/logger.js";

const aiLogger = logger.child({ module: "ai", provider: "perplexity" });

export class PerplexityProvider implements AIProvider {
  name = "perplexity" as const;
  private config: AIProviderConfig;
  private baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://api.perplexity.ai";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model || "llama-3.1-sonar-small-128k-online",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 10,
        }),
        // Health check — short timeout (10s) per LLM provider docs.
        signal: AbortSignal.timeout(10_000),
      });

      return response.ok;
    } catch (_error: unknown) {
      aiLogger.error({ err: _error }, "Perplexity availability check failed");
      return false;
    }
  }

  async generateText(messages: AIMessage[], options: GenerationOptions = {}): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model || this.config.model || "llama-3.1-sonar-small-128k-online",
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
        }),
        // LLM responses can be slow; 120s upper bound per Anthropic/OpenAI defaults.
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        throw AppError.externalService(
          "Perplexity",
          `Perplexity API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || "";
    } catch (_error: unknown) {
      aiLogger.error({ err: _error }, "Perplexity generation failed");
      throw AppError.externalService("Perplexity", `Perplexity generation failed: ${_error}`);
    }
  }

  async analyzeContent(
    content: string,
    analysisType: "sentiment" | "tone" | "readability" | "engagement"
  ): Promise<Partial<ContentAnalysis>> {
    const prompts = {
      sentiment: `Search for the latest research on sentiment analysis techniques and apply them to analyze this content. Return a JSON response with score (-1 to 1), label, and confidence:

"${content}"`,

      tone: `Research current best practices for tone analysis and apply them to this content. Return a JSON response with detected tone, confidence, and improvement suggestions:

"${content}"`,

      readability: `Use current readability assessment standards to analyze this content. Return a JSON response with score (0-100), level, and suggestions:

"${content}"`,

      engagement: `Research the latest social media engagement factors and analyze this content accordingly. Return a JSON response with score and engagement factors:

"${content}"`,
    };

    try {
      const response = await this.generateText([
        {
          role: "system",
          content:
            "You are an expert content analyst with access to current research. Always respond with valid JSON only.",
        },
        { role: "user", content: prompts[analysisType] },
      ]);

      return JSON.parse(response);
    } catch (_error: unknown) {
      aiLogger.error({ err: _error }, "Perplexity analysis failed");
      throw AppError.externalService("Perplexity", `Perplexity analysis failed: ${_error}`);
    }
  }

  async optimizeContent(
    content: string,
    platform: string,
    brandVoice?: string
  ): Promise<ContentOptimization> {
    const prompt = `Research the latest ${platform} algorithm updates and best practices for 2024. Optimize this content accordingly${brandVoice ? ` while maintaining a ${brandVoice} brand voice` : ""}.

Return a JSON response with optimizedText, changes, hashtags, mentions, mediasuggestions, and platformSpecific optimizations.

Content: "${content}"`;

    try {
      const response = await this.generateText([
        {
          role: "system",
          content:
            "You are an expert social media optimizer with access to current platform data and research. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ]);

      return JSON.parse(response);
    } catch (_error: unknown) {
      aiLogger.error({ err: _error }, "Perplexity optimization failed");
      throw AppError.externalService("Perplexity", `Perplexity optimization failed: ${_error}`);
    }
  }

  async predictPerformance(
    content: string,
    platform: string,
    historicalData?: unknown[]
  ): Promise<PerformancePrediction> {
    const prompt = `Research current ${platform} performance trends, algorithm preferences, and user behavior patterns. Estimate the likely performance of this content based on latest data and trends.

${historicalData ? `Historical context: ${JSON.stringify(historicalData.slice(0, 3))}` : ""}

Return a JSON response with platform, metrics (expectedEngagement, expectedReach, viralPotential, conversionPotential), optimalTiming, and competitiveAnalysis.

Content: "${content}"`;

    try {
      const response = await this.generateText([
        {
          role: "system",
          content:
            "You are an expert social media performance analyst with access to current platform data and trends. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ]);

      return JSON.parse(response);
    } catch (_error: unknown) {
      aiLogger.error({ err: _error }, "Perplexity prediction failed");
      throw AppError.externalService("Perplexity", `Perplexity prediction failed: ${_error}`);
    }
  }

  async generateVariations(
    content: string,
    variationType: "tone" | "length" | "audience",
    count: number
  ): Promise<string[]> {
    const prompt = `Research current content creation best practices and generate ${count} high-quality variations of this content, varying the ${variationType}. Base your approach on latest research in content optimization and audience engagement.

Return as a JSON array of exactly ${count} strings.

Original content: "${content}"`;

    try {
      const response = await this.generateText([
        {
          role: "system",
          content:
            "You are an expert content creator with access to current research and trends. Always respond with a valid JSON array of strings only.",
        },
        { role: "user", content: prompt },
      ]);

      return JSON.parse(response);
    } catch (_error: unknown) {
      aiLogger.error({ err: _error }, "Perplexity variation generation failed");
      throw AppError.externalService(
        "Perplexity",
        `Perplexity variation generation failed: ${_error}`
      );
    }
  }
}
