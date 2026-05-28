/**
 * @file setupAIImageUseCases.ts
 * @description Registers AI image generation use cases and repository in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { GeneratedImageRepository } from "@core/domain/repositories/GeneratedImageRepository.js";
import type { ImageGenerationPort } from "@core/domain/repositories/ImageGenerationPort.js";
import type { AIService } from "../../ai/aiService.js";
import { PrismaGeneratedImageRepository } from "../repositories/PrismaGeneratedImageRepository.js";
import { AiServiceImageGenerationAdapter } from "../adapters/AiServiceImageGenerationAdapter.js";
import { GenerateImageUseCase } from "@core/ai-image/GenerateImageUseCase.js";
import { ListGeneratedImagesQuery } from "@core/ai-image/ListGeneratedImagesQuery.js";

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

  // Image generation port — adapts AIService to the technology-free contract.
  container.register<ImageGenerationPort>(
    TOKENS.ImageGenerationPort,
    () => new AiServiceImageGenerationAdapter(container.resolve<AIService>(TOKENS.AIService)),
    true
  );

  // Generate image use case (needs repo + image-generation port)
  container.register(
    TOKENS.GenerateImageUseCase,
    () =>
      new GenerateImageUseCase(
        repo(),
        container.resolve<ImageGenerationPort>(TOKENS.ImageGenerationPort)
      ),
    true
  );

  // List generated images query (read-only, needs repo only)
  container.register(
    TOKENS.ListGeneratedImagesQuery_AIImage,
    () => new ListGeneratedImagesQuery(repo()),
    true
  );
}
