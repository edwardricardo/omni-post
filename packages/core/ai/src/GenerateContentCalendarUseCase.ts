/**
 * @file GenerateContentCalendarUseCase.ts
 * @description Generates a full month of content ideas using AI.
 *              Single LLM call with structured JSON response.
 *              Uses Brand Voice + performance data for context.
 *              Option A: response only, no DB persistence.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { buildEnhancedSystemPrompt } from "./buildEnhancedSystemPrompt.js";
import type { GetTopPerformersContextUseCase } from "./GetTopPerformersContextUseCase.js";
import type { AIGeneratePort } from "./GeneratePlatformVariantsUseCase.js";

export interface ContentCalendarInput {
  accountId: string;
  month: string;
  goal: string;
  industry: string;
  platforms: string[];
  postsPerWeek?: number;
  contentMix?: {
    educational: number;
    promotional: number;
    engagement: number;
    behindScenes: number;
  };
  brandVoice?: string;
}

export interface CalendarItem {
  suggestedDate: string;
  platform: string;
  contentType: "educational" | "promotional" | "engagement" | "behind_scenes";
  ideaTitle: string;
  ideaBrief: string;
  suggestedHashtags: string[];
}

export interface ContentCalendarOutput {
  month: string;
  totalPosts: number;
  calendarItems: CalendarItem[];
  summary: string;
}

export class GenerateContentCalendarUseCase implements UseCase<
  ContentCalendarInput,
  ContentCalendarOutput,
  UseCaseError
> {
  constructor(
    private readonly aiPort: AIGeneratePort,
    private readonly topPerformersUseCase?: GetTopPerformersContextUseCase
  ) {}

  async execute(input: ContentCalendarInput): Promise<Result<ContentCalendarOutput, UseCaseError>> {
    try {
      const postsPerWeek = input.postsPerWeek ?? 4;
      const weeksInMonth = 4;
      const totalPosts = Math.min(postsPerWeek * input.platforms.length * weeksInMonth, 60);

      const mix = input.contentMix ?? {
        educational: 30,
        promotional: 20,
        engagement: 30,
        behindScenes: 20,
      };

      let performanceInsights = "";
      if (this.topPerformersUseCase) {
        const perfResult = await this.topPerformersUseCase.execute({
          accountId: input.accountId,
        });
        if (perfResult.ok && perfResult.value.insights.length > 0) {
          performanceInsights = `\nPerformance insights from your data:\n${perfResult.value.insights.map((i) => `- ${i}`).join("\n")}`;
        }
      }

      const systemPrompt = buildEnhancedSystemPrompt({
        ...(input.brandVoice ? { brandVoice: input.brandVoice } : {}),
      });

      const userPrompt = `Generate a content calendar for ${input.month} for a ${input.industry} brand.
Goal: ${input.goal}
${performanceInsights}

Generate exactly ${totalPosts} post ideas distributed across these platforms: ${input.platforms.join(", ")}

Content mix:
- Educational: ${mix.educational}%
- Promotional: ${mix.promotional}%
- Engagement: ${mix.engagement}%
- Behind the scenes: ${mix.behindScenes}%

Distribute posts evenly across the month. Vary content types according to the mix percentages.

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "summary": "Brief 2-sentence strategy summary",
  "items": [
    {
      "date": "YYYY-MM-DD",
      "platform": "PLATFORM_NAME",
      "contentType": "educational|promotional|engagement|behind_scenes",
      "title": "Short idea title",
      "brief": "2-3 sentence description of the post idea",
      "hashtags": ["tag1", "tag2"]
    }
  ]
}`;

      const result = await this.aiPort.generateContent([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      if (!result.success || !result.value) {
        return ok({
          month: input.month,
          totalPosts: 0,
          calendarItems: [],
          summary: "Unable to generate calendar. Please try again.",
        });
      }

      const parsed = this.parseCalendarResponse(result.value, input.month);

      return ok({
        month: input.month,
        totalPosts: parsed.items.length,
        calendarItems: parsed.items,
        summary: parsed.summary,
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to generate content calendar",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private parseCalendarResponse(
    raw: string,
    month: string
  ): { summary: string; items: CalendarItem[] } {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { summary: "Calendar generated.", items: [] };
      }

      const data = JSON.parse(jsonMatch[0]) as {
        summary?: string;
        items?: Array<{
          date?: string;
          platform?: string;
          contentType?: string;
          title?: string;
          brief?: string;
          hashtags?: string[];
        }>;
      };

      const validTypes = new Set(["educational", "promotional", "engagement", "behind_scenes"]);
      const items: CalendarItem[] = (data.items ?? [])
        .filter((item) => item.date && item.platform && item.title)
        .map((item) => ({
          suggestedDate: item.date ?? `${month}-01`,
          platform: item.platform ?? "X",
          contentType: (validTypes.has(item.contentType ?? "")
            ? item.contentType
            : "educational") as CalendarItem["contentType"],
          ideaTitle: item.title ?? "Untitled",
          ideaBrief: item.brief ?? "",
          suggestedHashtags: item.hashtags ?? [],
        }));

      return {
        summary: data.summary ?? "Content calendar generated.",
        items,
      };
    } catch {
      return { summary: "Calendar generated (parsing fallback).", items: [] };
    }
  }
}
