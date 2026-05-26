/**
 * @file gemini.ts
 * @description Google Gemini AI provider adapter implementing the AIProvider interface
 *              for content generation, analysis, optimization, and predictions.
 * @layer infrastructure
 */
import { GoogleGenAI } from "@google/genai";
import {
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
import {
  analysisSpec,
  optimizationSpec,
  predictionSpec,
  variationsSpec,
} from "../structuredSchemas.js";

const aiLogger = logger.child({ module: "ai", provider: "gemini" });

export class GeminiProvider implements AIProvider {
  name = "gemini" as const;
  readonly supportsEmbeddings = true;
  private client: GoogleGenAI;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.client.models.generateContent({
        model: this.config.model || "gemini-1.5-flash",
        contents: "Hi",
      });
      return !!result.text;
    } catch {
      return false;
    }
  }

  private convertMessagesToPrompt(messages: AIMessage[]): string {
    return messages
      .map((msg) => {
        switch (msg.role) {
          case "system":
            return `System: ${msg.content}`;
          case "user":
            return `User: ${msg.content}`;
          case "assistant":
            return `Assistant: ${msg.content}`;
          default:
            return msg.content;
        }
      })
      .join("\n\n");
  }

  async generateText(messages: AIMessage[], options: GenerationOptions = {}): Promise<string> {
    try {
      const prompt = this.convertMessagesToPrompt(messages);
      const result = await this.client.models.generateContent({
        model: options.model || this.config.model || "gemini-1.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: options.maxTokens || 1000,
          temperature: options.temperature || 0.7,
          topP: options.topP || 1,
        },
      });

      return result.text || "";
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Gemini generation failed");
      throw AppError.externalService("Gemini", `Gemini generation failed: ${error}`);
    }
  }

  /**
   * @method generateStructured
   * @description Schema-validated generation via Gemini native structured
   *   output (`responseMimeType: "application/json"` + `responseSchema`).
   *   Output is routed through `spec.parse` so callers get a validated `T`,
   *   never raw text.
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
      const prompt = this.convertMessagesToPrompt(messages);
      const result = await this.client.models.generateContent({
        model: options.model || this.config.model || "gemini-1.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: options.maxTokens || 1000,
          temperature: options.temperature ?? 0.7,
          responseMimeType: "application/json",
          responseSchema: spec.jsonSchema,
        },
      });

      return spec.parse(JSON.parse(result.text || ""));
    } catch (error: unknown) {
      aiLogger.error({ err: error }, "Gemini structured generation failed");
      throw AppError.externalService("Gemini", `Gemini structured generation failed: ${error}`);
    }
  }

  async analyzeContent(
    content: string,
    analysisType: "sentiment" | "tone" | "readability" | "engagement"
  ): Promise<Partial<ContentAnalysis>> {
    const prompts = {
      sentiment: `As an expert in natural language processing and sentiment analysis, analyze the sentiment of this content with high precision.

Consider:
- Explicit emotional indicators
- Implicit sentiment through word choice
- Context and cultural nuances
- Sarcasm or irony

Return only a JSON response with:
- score: precise number between -1 (very negative) and 1 (very positive)
- label: "positive", "negative", or "neutral"
- confidence: number between 0 and 1

Content to analyze: "${content}"`,

      tone: `As an expert in communication and linguistics, analyze the tone and voice of this content.

Consider:
- Formality level
- Emotional undertones
- Authority and confidence
- Personality traits expressed

Return only a JSON response with:
- detected: the primary tone (e.g., "professional", "casual", "humorous", "authoritative", "friendly")
- confidence: number between 0 and 1
- suggestions: array of specific recommendations for tone improvement

Content to analyze: "${content}"`,

      readability: `As an expert in readability assessment and educational psychology, analyze how accessible this content is to different audiences.

Consider:
- Sentence complexity and length
- Vocabulary difficulty
- Concept complexity
- Structural clarity

Return only a JSON response with:
- score: number between 0-100 (higher = more readable)
- level: specific reading level (e.g., "8th Grade", "High School", "College", "Graduate")
- suggestions: array of specific improvements for better readability

Content to analyze: "${content}"`,

      engagement: `As an expert in social psychology and digital marketing, analyze the engagement potential of this content.

Consider:
- Psychological triggers and hooks
- Social sharing motivators
- Emotional resonance factors
- Call-to-action effectiveness

Return only a JSON response with:
- score: number between 0-100
- factors: array of objects with {factor: string, impact: number 0-100, suggestion: string}

Content to analyze: "${content}"`,
    };

    return this.generateStructured(
      [{ role: "user", content: prompts[analysisType] }],
      analysisSpec(analysisType)
    );
  }

  async optimizeContent(
    content: string,
    platform: string,
    brandVoice?: string
  ): Promise<ContentOptimization> {
    const prompt = `As an expert social media strategist and content optimizer, enhance this content for maximum performance on ${platform}.

Platform-specific considerations for ${platform}:
- Character limits and formatting preferences
- Algorithm ranking factors
- Audience behavior patterns
- Visual content integration
- Hashtag and mention strategies

${
  brandVoice
    ? `Brand voice requirements:
- Maintain ${brandVoice} tone throughout
- Ensure voice consistency with brand personality
- Adapt voice appropriately for platform while staying authentic`
    : ""
}

Return only a JSON response with:
- optimizedText: the enhanced content text
- changes: array of {type: "added"|"removed"|"modified", original: string, optimized: string, reason: string}
- hashtags: array of relevant hashtags (without # symbol)
- mentions: array of strategic @mentions (without @ symbol)
- mediasuggestions: array of {type: "image"|"video", description: string, dimensions: string}
- platformSpecific: object with platform-optimized versions for different use cases

Original content to optimize: "${content}"`;

    return this.generateStructured([{ role: "user", content: prompt }], optimizationSpec);
  }

  async predictPerformance(
    content: string,
    platform: string,
    historicalData?: unknown[]
  ): Promise<PerformancePrediction> {
    const prompt = `As a social media content analyst, estimate the likely performance of this content on ${platform}.

Analysis framework:
- Content quality assessment using proven engagement metrics
- Platform algorithm compatibility scoring
- Audience behavior estimation based on content type
- Timing optimization recommendations
- Competitive positioning analysis

${
  historicalData
    ? `Historical performance context:
${JSON.stringify(historicalData.slice(0, 5), null, 2)}`
    : ""
}

Return only a JSON response with:
- platform: string (the platform name)
- metrics: {
    expectedEngagement: {value: number, confidence: number 0-1, range: {min: number, max: number}},
    expectedReach: {value: number, confidence: number 0-1, range: {min: number, max: number}},
    viralPotential: number 0-100,
    conversionPotential: number 0-100
  }
- optimalTiming: {hour: number 0-23, day: string, timezone: string, confidence: number 0-1}
- competitiveAnalysis: {benchmarkScore: number 0-100, opportunities: array of strings, threats: array of strings}

Content to analyze: "${content}"`;

    return this.generateStructured([{ role: "user", content: prompt }], predictionSpec);
  }

  async generateVariations(
    content: string,
    variationType: "tone" | "length" | "audience",
    count: number
  ): Promise<string[]> {
    const variationStrategies = {
      tone: `Create ${count} variations with distinctly different tones:
- Professional/Corporate
- Casual/Conversational
- Humorous/Playful
- Authoritative/Expert
- Friendly/Personal
- Inspirational/Motivational`,

      length: `Create ${count} variations with different content lengths:
- Ultra-concise (Twitter-optimized)
- Medium-length (Instagram/Facebook)
- Detailed/Comprehensive
- Long-form (LinkedIn article style)`,

      audience: `Create ${count} variations targeting different audiences:
- C-suite executives
- Marketing professionals
- Small business owners
- Students/Early career
- General consumers
- Industry specialists`,
    };

    const prompt = `As an expert content strategist and copywriter, generate exactly ${count} high-quality variations of this content.

Variation strategy - ${variationType}:
${variationStrategies[variationType]}

Requirements for each variation:
- Maintain the core message and value proposition
- Ensure each variation is meaningfully different
- Optimize for engagement and clarity
- Make each variation feel natural and authentic
- Preserve any important information or calls-to-action

Return only a JSON array of exactly ${count} strings. No additional formatting, explanations, or text.

Original content: "${content}"`;

    return this.generateStructured([{ role: "user", content: prompt }], variationsSpec());
  }

  /**
   * @method generateEmbeddings
   * @description Generates dense vector embeddings via the Gemini embedding
   *   API. Uses `outputDimensionality` so the output aligns with the
   *   project's uniform embedding dimension across providers.
   * @param texts - One or more strings to embed.
   * @param options - Override the model or output dimensions.
   * @returns Array of embedding vectors, one per input text.
   */
  async generateEmbeddings(
    texts: string[],
    options: { model?: string; dimensions?: number } = {}
  ): Promise<number[][]> {
    const model = options.model ?? "gemini-embedding-001";
    const outputDimensionality = options.dimensions ?? 768;
    const result = await this.client.models.embedContent({
      model,
      contents: texts,
      config: { outputDimensionality },
    });
    const embeddings = result.embeddings ?? [];
    return embeddings.map((entry) => entry.values ?? []);
  }
}
