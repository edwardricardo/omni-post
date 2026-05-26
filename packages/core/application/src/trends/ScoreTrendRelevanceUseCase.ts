/**
 * @file ScoreTrendRelevanceUseCase.ts
 * @description AI-powered relevance scoring for trending topics. Calls the
 *              schema-validated `AIServicePort.generateStructured` path with
 *              `trendScoringSpec`; ranks each topic 1-10 against the account's
 *              brand voice + performance insights, returning only topics that
 *              clear the relevance threshold.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { AIMessage, StructuredOutputSpec } from "@core/domain/ai/AiServiceContract.js";
import type { TrendScoresClassification } from "@core/domain/ai/AiStructuredOutputs.js";
import type { TrendingTopic } from "./FetchTrendingTopicsUseCase.js";

export interface ScoredTrend {
  topic: string;
  platform: string;
  source: TrendingTopic["source"];
  sourceUrl: string | null;
  relevanceScore: number;
  postIdea: string | null;
  bestPlatform: string | null;
  urgency: "NOW" | "TODAY" | "THIS_WEEK";
  volume: number | null;
}

export interface ScoreTrendInput {
  accountId: string;
  topics: TrendingTopic[];
  limit?: number;
}

export interface ScoreTrendOutput {
  scored: ScoredTrend[];
}

export interface ScoreTrendContextPort {
  getBrandVoice(accountId: string): Promise<string | undefined>;
  getPerformanceInsights(accountId: string): Promise<string[]>;
}

const RELEVANCE_THRESHOLD = 6;
const DEFAULT_LIMIT = 10;

export class ScoreTrendRelevanceUseCase implements UseCase<
  ScoreTrendInput,
  ScoreTrendOutput,
  UseCaseError
> {
  constructor(
    private readonly aiServicePort: AIServicePort,
    private readonly trendScoringSpec: StructuredOutputSpec<TrendScoresClassification>,
    private readonly contextPort?: ScoreTrendContextPort
  ) {}

  async execute(input: ScoreTrendInput): Promise<Result<ScoreTrendOutput, UseCaseError>> {
    try {
      if (input.topics.length === 0) {
        return ok({ scored: [] });
      }

      const limit = input.limit ?? DEFAULT_LIMIT;

      let brandVoice = "";
      let insights: string[] = [];
      if (this.contextPort) {
        brandVoice = (await this.contextPort.getBrandVoice(input.accountId)) ?? "";
        insights = await this.contextPort.getPerformanceInsights(input.accountId);
      }

      const topicsList = input.topics
        .map(
          (t, i) =>
            `${i + 1}. "${t.topic}" (source: ${t.source}${t.platform ? `, platform: ${t.platform}` : ""}${
              t.volume ? `, volume: ${t.volume}` : ""
            })`
        )
        .join("\n");

      const systemPrompt = [
        "You score trending topics for brand relevance.",
        "Rules:",
        "- Score each topic 1-10 (10 = perfect brand fit, 1 = irrelevant).",
        "- For topics scoring 6+, propose a concrete post idea and best platform.",
        "- For topics below 6, OMIT them from the response.",
        "- Urgency: NOW (ride within the hour), TODAY (within 24h), THIS_WEEK (slower-moving theme).",
        "- Index field MUST match the 1-based position in the input list.",
      ].join("\n");

      const userPrompt = [
        brandVoice ? `Brand Voice: ${brandVoice}` : "",
        insights.length > 0 ? `Performance insights: ${insights.join("; ")}` : "",
        "",
        "Topics:",
        topicsList,
      ]
        .filter(Boolean)
        .join("\n");

      const messages: AIMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      const result = await this.aiServicePort.generateStructured(
        messages,
        this.trendScoringSpec,
        { temperature: 0.3 },
        input.accountId
      );

      if (!result.ok) {
        return ok({ scored: [] });
      }

      const scored: ScoredTrend[] = [];
      for (const s of result.value.scores) {
        if (s.score < RELEVANCE_THRESHOLD) continue;
        const topic = input.topics[s.index - 1];
        if (!topic) continue;
        scored.push({
          topic: topic.topic,
          platform: topic.platform ?? "",
          source: topic.source,
          sourceUrl: topic.sourceUrl ?? null,
          relevanceScore: s.score,
          postIdea: s.postIdea,
          bestPlatform: s.bestPlatform,
          urgency: s.urgency,
          volume: topic.volume,
        });
      }

      const sorted = scored.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
      return ok({ scored: sorted });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to score trend relevance",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
