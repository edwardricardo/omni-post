/**
 * @file ScoreTrendRelevanceUseCase.ts
 * @description AI-powered relevance scoring for trending topics.
 *              Scores each topic against the account's Brand Voice and industry.
 *              Suggests post ideas for relevant topics (score >= 6).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TrendingTopic } from "./FetchTrendingTopicsUseCase.js";

export interface ScoredTrend {
  topic: string;
  platform: string;
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

export interface ScoreTrendAIPort {
  generateContent(
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>
  ): Promise<{ success: boolean; value?: string }>;
}

export interface ScoreTrendContextPort {
  getBrandVoice(accountId: string): Promise<string | undefined>;
  getPerformanceInsights(accountId: string): Promise<string[]>;
}

export class ScoreTrendRelevanceUseCase implements UseCase<
  ScoreTrendInput,
  ScoreTrendOutput,
  UseCaseError
> {
  constructor(
    private readonly aiPort: ScoreTrendAIPort,
    private readonly contextPort?: ScoreTrendContextPort
  ) {}

  async execute(input: ScoreTrendInput): Promise<Result<ScoreTrendOutput, UseCaseError>> {
    try {
      if (input.topics.length === 0) {
        return ok({ scored: [] });
      }

      const limit = input.limit ?? 10;

      let brandVoice = "";
      let insights: string[] = [];
      if (this.contextPort) {
        brandVoice = (await this.contextPort.getBrandVoice(input.accountId)) ?? "";
        insights = await this.contextPort.getPerformanceInsights(input.accountId);
      }

      const topicsList = input.topics
        .map(
          (t, i) => `${i + 1}. "${t.topic}" (${t.platform}${t.volume ? `, ${t.volume} posts` : ""})`
        )
        .join("\n");

      const prompt = `Rate each trending topic 1-10 for brand relevance and suggest post ideas.
${brandVoice ? `Brand Voice: ${brandVoice}` : ""}
${insights.length > 0 ? `Performance insights: ${insights.join("; ")}` : ""}

Topics:
${topicsList}

Return ONLY valid JSON:
{
  "scores": [
    {
      "index": 1,
      "score": 8,
      "postIdea": "Post idea connecting this trend to the brand",
      "bestPlatform": "INSTAGRAM",
      "urgency": "NOW|TODAY|THIS_WEEK"
    }
  ]
}

Only include topics with score >= 6. For topics below 6, omit them.`;

      const result = await this.aiPort.generateContent([{ role: "user", content: prompt }]);

      if (!result.success || !result.value) {
        return ok({ scored: [] });
      }

      const parsed = this.parseScoreResponse(result.value, input.topics);
      const sorted = parsed.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);

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

  private parseScoreResponse(raw: string, topics: TrendingTopic[]): ScoredTrend[] {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const data = JSON.parse(jsonMatch[0]) as {
        scores?: Array<{
          index?: number;
          score?: number;
          postIdea?: string;
          bestPlatform?: string;
          urgency?: string;
        }>;
      };

      const validUrgencies = new Set(["NOW", "TODAY", "THIS_WEEK"]);

      return (data.scores ?? [])
        .filter((s) => s.index && s.score && s.score >= 6)
        .map((s) => {
          const topicIdx = (s.index ?? 1) - 1;
          const topic = topics[topicIdx];
          if (!topic) return null;

          return {
            topic: topic.topic,
            platform: topic.platform,
            relevanceScore: Math.min(10, Math.max(1, s.score ?? 1)),
            postIdea: s.postIdea ?? null,
            bestPlatform: s.bestPlatform ?? null,
            urgency: (validUrgencies.has(s.urgency ?? "")
              ? s.urgency
              : "THIS_WEEK") as ScoredTrend["urgency"],
            volume: topic.volume,
          };
        })
        .filter((s): s is ScoredTrend => s !== null);
    } catch {
      return [];
    }
  }
}
