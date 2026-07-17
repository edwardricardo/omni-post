/**
 * @file GenerateImageUseCase.ts
 * @description Orchestrates AI image generation: validates input, delegates to
 *              the AI service for image creation, and persists the result via
 *              the GeneratedImageRepository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { randomUUID } from "crypto";
import type {
  GeneratedImageRepository,
  GeneratedImageData,
} from "@core/domain/repositories/GeneratedImageRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { ImageGenerationPort } from "@core/domain/repositories/ImageGenerationPort.js";
import { ProjectId } from "@core/domain/value-objects/EntityId.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

/**
 * Input DTO for the GenerateImage use case
 */
export interface GenerateImageInput {
  projectId: string;
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
  quality?: "standard" | "hd";
  style?: "natural" | "vivid";
}

/**
 * @class GenerateImageUseCase
 * @description Creates an AI-generated image from a text prompt, then persists
 *              the result (URL, revised prompt, parameters) in the database.
 */
export class GenerateImageUseCase {
  constructor(
    private readonly repository: GeneratedImageRepository,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly imageGenerator: ImageGenerationPort
  ) {}

  /**
   * @method execute
   * @description Generates an image via the AI provider and saves the record.
   * @param input - Validated generation parameters
   * @returns Result<GeneratedImageData> on success, UseCaseError on failure
   */
  async execute(input: GenerateImageInput): Promise<Result<GeneratedImageData, UseCaseError>> {
    const { projectId, prompt, size, quality, style } = input;

    // Validate prompt is not empty after trimming
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0) {
      return err(new UseCaseError("Prompt cannot be empty", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Validate the project ID shape before resolving ownership.
    const projectIdResult = ProjectId.fromString(projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid projectId: ${projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          projectIdResult.error
        )
      );
    }

    // Ownership check BEFORE the paid AI call: resolve the project through the
    // guard-scoped repository. A foreign or nonexistent projectId resolves to
    // EntityNotFoundError under the caller's tenant context. Returning NOT_FOUND
    // here (anti-enumeration: never 403) guarantees a foreign project burns
    // ZERO AI spend and persists nothing.
    const projectResult = await this.projectRepository.findById(projectIdResult.value);
    if (!projectResult.ok) {
      return err(new UseCaseError(projectResult.error.message, USE_CASE_ERRORS.NOT_FOUND));
    }

    const accountId = projectResult.value.accountId.toString();

    // Delegate to the image-generation port. `ok` guarantees a payload; any
    // provider/transport/empty-payload failure resolves to `err(message)`.
    const aiResult = await this.imageGenerator.generateImage({
      prompt: trimmedPrompt,
      ...(size && { size }),
      ...(quality && { quality }),
      ...(style && { style }),
    });

    if (!aiResult.ok) {
      return err(new UseCaseError(aiResult.error, USE_CASE_ERRORS.INTERNAL_ERROR));
    }

    const generatedValue = aiResult.value;

    // Persist the generated image record
    const imageData: GeneratedImageData = {
      id: randomUUID(),
      accountId,
      projectId,
      prompt: trimmedPrompt,
      revisedPrompt: generatedValue.revisedPrompt,
      imageUrl: generatedValue.imageUrl,
      size: size ?? "1024x1024",
      quality: quality ?? "standard",
      style: style ?? "vivid",
      createdAt: new Date(),
    };

    const saveResult = await this.repository.save(imageData);
    if (!saveResult.ok) {
      return err(
        new UseCaseError(
          "Failed to persist generated image",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          saveResult.error
        )
      );
    }

    return ok(saveResult.value);
  }
}
