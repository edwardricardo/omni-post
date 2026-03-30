/**
 * @file GeneratePlatformVariantsUseCase.ts
 * @description Generates platform-native content variants from a brief.
 *              Each platform gets a genuinely different version, not truncation.
 *              Uses Brand Voice + performance data for context.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { PLATFORM_CONTENT_PROFILES } from "../../domain/ai/PlatformContentProfile.js";
import { buildEnhancedSystemPrompt } from "./buildEnhancedSystemPrompt.js";
import type { GetTopPerformersContextUseCase } from "./GetTopPerformersContextUseCase.js";

export interface PlatformVariantsInput {
  accountId: string;
  brief: string;
  platforms: string[];
  tone?: string;
  usePerformanceData?: boolean;
  brandVoice?: string;
}

export interface PlatformVariant {
  platform: string;
  content: string;
  charCount: number;
  charLimit: number;
  hashtags: string[];
}

export interface PlatformVariantsOutput {
  variants: PlatformVariant[];
  generationMs: number;
}

export interface AIGeneratePort {
  generateContent(
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>
  ): Promise<{ success: boolean; value?: string }>;
}

export class GeneratePlatformVariantsUseCase implements UseCase<
  PlatformVariantsInput,
  PlatformVariantsOutput,
  UseCaseError
> {
  constructor(
    private readonly aiPort: AIGeneratePort,
    private readonly topPerformersUseCase?: GetTopPerformersContextUseCase
  ) {}

  async execute(
    input: PlatformVariantsInput
  ): Promise<Result<PlatformVariantsOutput, UseCaseError>> {
    try {
      const startMs = Date.now();
      const usePerf = input.usePerformanceData !== false;

      let performanceContext = null;
      if (usePerf && this.topPerformersUseCase) {
        const perfResult = await this.topPerformersUseCase.execute({
          accountId: input.accountId,
        });
        if (perfResult.ok) {
          performanceContext = perfResult.value;
        }
      }

      const systemPrompt = buildEnhancedSystemPrompt({
        ...(input.brandVoice ? { brandVoice: input.brandVoice } : {}),
        ...(performanceContext ? { performanceContext } : {}),
      });

      const variantPromises = input.platforms.map(async (platform) => {
        const profile = PLATFORM_CONTENT_PROFILES[platform];
        if (!profile) {
          return {
            platform,
            content: input.brief,
            charCount: input.brief.length,
            charLimit: 280,
            hashtags: [],
          };
        }

        const userPrompt = `Write a native ${profile.name} post for this brief:
"${input.brief}"

Platform rules:
- Max ${profile.maxChars} characters
- Style: ${profile.style}
- Hashtag strategy: ${profile.hashtagStrategy}
- Tone: ${profile.toneNotes}
- Structure: ${profile.structure}
- Avoid: ${profile.avoidances}
${input.tone ? `- Additional tone: ${input.tone}` : ""}

Write ONLY the post content. No explanations, no meta-commentary.`;

        const result = await this.aiPort.generateContent([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);

        let content = result.value ?? input.brief;
        if (content.length > profile.maxChars) {
          content = content.slice(0, profile.maxChars - 3) + "...";
        }

        const hashtags = content.match(/#\w+/g) ?? [];

        return {
          platform,
          content,
          charCount: content.length,
          charLimit: profile.maxChars,
          hashtags,
        };
      });

      const variants = await Promise.all(variantPromises);
      const generationMs = Date.now() - startMs;

      return ok({ variants, generationMs });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to generate platform variants",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
