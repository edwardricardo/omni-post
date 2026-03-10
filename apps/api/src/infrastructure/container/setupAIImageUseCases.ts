/**
 * @file setupAIImageUseCases.ts
 * @description Registers AI image generation use cases and repository in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { GeneratedImageRepository } from "../../domain/repositories/GeneratedImageRepository.js";
import type { AIService } from "../../ai/aiService.js";
import { PrismaGeneratedImageRepository } from "../repositories/PrismaGeneratedImageRepository.js";
import { GenerateImageUseCase } from "../../application/ai-image/GenerateImageUseCase.js";
import { ListGeneratedImagesQuery } from "../../application/ai-image/ListGeneratedImagesQuery.js";

/**
 * @method setupAIImageUseCases
 * @description Registers all AI image generation dependencies as singletons.
 */
export function setupAIImageUseCases(container: Container): void {
  // Repository
  container.register<GeneratedImageRepository>(
    TOKENS.GeneratedImageRepository,
    () => new PrismaGeneratedImageRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  const repo = () => container.resolve<GeneratedImageRepository>(TOKENS.GeneratedImageRepository);

  // Generate image use case (needs repo + AI service)
  container.register(
    TOKENS.GenerateImageUseCase,
    () => new GenerateImageUseCase(repo(), container.resolve<AIService>(TOKENS.AIService)),
    true
  );

  // List generated images query (read-only, needs repo only)
  container.register(
    TOKENS.ListGeneratedImagesQuery_AIImage,
    () => new ListGeneratedImagesQuery(repo()),
    true
  );
}
