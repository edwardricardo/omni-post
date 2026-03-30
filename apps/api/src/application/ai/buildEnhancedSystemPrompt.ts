/**
 * @file buildEnhancedSystemPrompt.ts
 * @description Combines Brand Voice + performance data into an enhanced system prompt.
 *              Gracefully handles missing data — always returns a valid prompt.
 * @layer application
 */

import type { TopPerformersContext } from "./GetTopPerformersContextUseCase.js";

export interface EnhancedPromptInput {
  brandVoice?: string;
  performanceContext?: TopPerformersContext | null;
}

export function buildEnhancedSystemPrompt(input: EnhancedPromptInput): string {
  const sections: string[] = [];

  if (input.brandVoice) {
    sections.push(`BRAND VOICE:\n${input.brandVoice}`);
  }

  if (input.performanceContext && input.performanceContext.posts.length > 0) {
    const ctx = input.performanceContext;
    const postExamples = ctx.posts
      .map((p, i) => {
        const multiplier =
          ctx.accountAvgEngagement > 0
            ? Math.round(p.engagementRate / ctx.accountAvgEngagement)
            : 1;
        return `Post ${i + 1} (Engagement: ${p.engagementRate}%${multiplier > 1 ? ` — ${multiplier}x your average` : ""}):\n"${p.content.slice(0, 300)}"\nPlatform: ${p.platform} | Published: ${p.publishedAt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`;
      })
      .join("\n\n");

    let perfSection = `WHAT WORKS FOR THIS BRAND (based on real performance data):\nTop performing posts in the last 90 days:\n\n${postExamples}`;

    if (ctx.insights.length > 0) {
      perfSection += `\n\nKey insights:\n${ctx.insights.map((i) => `• ${i}`).join("\n")}`;
    }

    perfSection +=
      "\n\nGenerate content that follows the same patterns as these top performers while being original. Match the tone, style, and structure that works.";

    sections.push(perfSection);
  }

  if (sections.length === 0) {
    return "You are a social media content expert. Generate engaging, platform-appropriate content.";
  }

  return sections.join("\n\n---\n\n");
}
