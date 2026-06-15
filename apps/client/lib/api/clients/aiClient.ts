/**
 * @file aiClient.ts
 * @description AI content domain client. Generates, optimizes, and analyzes
 *              social-post content via the backend AI orchestration layer.
 * @layer infrastructure
 */

import type { ApiResponse } from "../types.js";
import { request } from "./request.js";

export type AiContentType = "post" | "caption" | "hashtags";
export type AiTone = "professional" | "casual" | "friendly" | "formal";
export type AiLength = "short" | "medium" | "long";
export type AiLanguage = "en" | "es";

export interface GenerateContentOptions {
  type?: AiContentType;
  tone?: AiTone;
  length?: AiLength;
  language?: AiLanguage;
}

export interface GeneratedContent {
  content: string;
  metadata?: unknown;
}

export interface OptimizedContent {
  optimized: string;
  suggestions?: string[];
}

export interface ContentAnalysis {
  analysis: unknown;
  score?: number;
}

/**
 * @class AiClient
 * @description Client for `/ai/*` endpoints.
 */
export class AiClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method generateContent
   * @description Generates new content from a prompt.
   * @param prompt - Free-form prompt
   * @param options - Optional tone, length, type, and language
   */
  async generateContent(
    prompt: string,
    options?: GenerateContentOptions
  ): Promise<ApiResponse<GeneratedContent>> {
    return request<ApiResponse<GeneratedContent>>(this.baseUrl, "/ai/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, ...options }),
    });
  }

  /**
   * @method optimizeContent
   * @description Optimizes existing content for a specific platform.
   * @param content - Content to optimize
   * @param platform - Optional target platform identifier
   */
  async optimizeContent(
    content: string,
    platform?: string
  ): Promise<ApiResponse<OptimizedContent>> {
    return request<ApiResponse<OptimizedContent>>(this.baseUrl, "/ai/optimize", {
      method: "POST",
      body: JSON.stringify({ content, platform }),
    });
  }

  /**
   * @method analyzeContent
   * @description Analyzes content and returns scores and breakdown.
   * @param content - Content to analyze
   */
  async analyzeContent(content: string): Promise<ApiResponse<ContentAnalysis>> {
    return request<ApiResponse<ContentAnalysis>>(this.baseUrl, "/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }
}
