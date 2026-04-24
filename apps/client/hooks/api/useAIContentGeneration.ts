/**
 * @file useAIContentGeneration.ts
 * @description TanStack Query mutation hook for generating AI-optimized social media content.
 * Calls the /ai/generate endpoint and falls back to client-side template rendering on failure.
 */
import { useMutation } from "@tanstack/react-query";
import type { GeneratedContent, ContentTemplate, GenerationSettings } from "../../types/ai-content";
import {
  optimizeForPlatform,
  generateVariations,
  generateBrandSuggestions,
} from "../../lib/ai-content-utils";

const API_URL = "/api/backend";

interface GenerateContentParams {
  template: ContentTemplate;
  formData: Record<string, string>;
  settings: GenerationSettings;
}

/**
 * @hook useAIContentGeneration
 * @description Mutation hook for generating AI-optimized social media content.
 *              Calls the /ai/generate endpoint and falls back to client-side template rendering on failure.
 * @returns TanStack Query mutation with generated content array
 */
export function useAIContentGeneration() {
  return useMutation({
    mutationFn: async ({
      template,
      formData,
      settings,
    }: GenerateContentParams): Promise<GeneratedContent[]> => {
      // Try real API first
      try {
        const response = await fetch(`${API_URL}/ai/generate`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                role: "user",
                content: `Generate content for template "${template.name}" with these variables: ${JSON.stringify(formData)}`,
              },
            ],
            options: {
              platforms: settings.platforms,
              generateVariations: settings.generateVariations,
            },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.ok && data.value) {
            return data.value;
          }
        }
      } catch {
        // AI API unavailable — fall back to client-side generation
      }

      // Fallback: client-side generation with static estimates when the API is unavailable
      const content: GeneratedContent[] = settings.platforms.map((platform) => {
        const platformOptimized = optimizeForPlatform(
          template.template,
          platform,
          formData,
          settings
        );

        return {
          id: `${platform}-${Date.now()}`,
          platform,
          content: {
            text: platformOptimized.text,
            hashtags: platformOptimized.hashtags,
            mentions: platformOptimized.mentions,
            media: platformOptimized.media,
          },
          metrics: {
            characterCount: platformOptimized.text.length,
            wordCount: platformOptimized.text.split(" ").length,
            hashtagCount: platformOptimized.hashtags.length,
          },
          variations: settings.generateVariations
            ? generateVariations(platformOptimized.text, platform)
            : [],
          brandConsistency: {
            score: 85,
            suggestions: generateBrandSuggestions(),
            voiceMatch: true,
          },
        };
      });

      return content;
    },
  });
}
