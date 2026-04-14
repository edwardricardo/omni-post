/**
 * @file setupTrendUseCases.ts
 * @description DI registrations for trend scoring use cases.
 *              Wires AI and context adapters for ScoreTrendRelevanceUseCase.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";

import { PrismaScoreTrendContextAdapter } from "../repositories/PrismaScoreTrendContextAdapter.js";
import type { ScoreTrendAIPort } from "../../application/trends/ScoreTrendRelevanceUseCase.js";
import type { ScoreTrendContextPort } from "../../application/trends/ScoreTrendRelevanceUseCase.js";
import { ScoreTrendRelevanceUseCase } from "../../application/trends/ScoreTrendRelevanceUseCase.js";
import type { AIService } from "../../ai/aiService.js";

/**
 * @method setupTrendUseCases
 * @description Registers trend scoring ports, adapters, and use cases.
 */
export function setupTrendUseCases(container: Container): void {
  // ScoreTrendContextPort — Prisma adapter for brand voice + performance insights
  container.registerInstance<ScoreTrendContextPort>(
    TOKENS.ScoreTrendContextPort,
    new PrismaScoreTrendContextAdapter(prisma)
  );

  // ScoreTrendAIPort — wraps AIService to match the port interface
  container.register<ScoreTrendAIPort>(
    TOKENS.ScoreTrendAIPort,
    () => {
      const aiService = container.resolve<AIService>(TOKENS.AIService);
      return {
        async generateContent(
          messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
          _options?: Record<string, unknown>
        ): Promise<{ success: boolean; value?: string }> {
          try {
            const result = await aiService.generateContent(messages);
            const value = typeof result.content === "string" ? result.content : undefined;
            return { success: true, ...(value !== undefined && { value }) };
          } catch {
            return { success: false };
          }
        },
      };
    },
    true
  );

  // ScoreTrendRelevanceUseCase
  container.register<ScoreTrendRelevanceUseCase>(
    TOKENS.ScoreTrendRelevanceUseCase,
    () =>
      new ScoreTrendRelevanceUseCase(
        container.resolve<ScoreTrendAIPort>(TOKENS.ScoreTrendAIPort),
        container.resolve<ScoreTrendContextPort>(TOKENS.ScoreTrendContextPort)
      ),
    true
  );
}
