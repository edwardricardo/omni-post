/**
 * @file AiServiceImageGenerationAdapter.ts
 * @description Infrastructure adapter implementing `ImageGenerationPort` by
 *              delegating to `AIService.generateImage` (orchestrator + circuit
 *              breaker). Maps the provider's `AIResponse` wrapper to the port's
 *              `Result`: a successful response with a payload becomes `ok`,
 *              everything else (provider error, empty payload) becomes
 *              `err(message)`.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import type {
  ImageGenerationPort,
  ImageGenerationOptions,
  ImageGenerationResult,
} from "@core/domain/repositories/ImageGenerationPort.js";
import type { AIService } from "../../ai/aiService.js";

/**
 * @class AiServiceImageGenerationAdapter
 * @description Bridges the technology-free `ImageGenerationPort` to the
 *   concrete `AIService`, narrowing `AIResponse<ImageGenerationResult>` to
 *   `Result<ImageGenerationResult, string>`.
 */
export class AiServiceImageGenerationAdapter implements ImageGenerationPort {
  constructor(private readonly aiService: AIService) {}

  async generateImage(
    options: ImageGenerationOptions
  ): Promise<Result<ImageGenerationResult, string>> {
    const response = await this.aiService.generateImage(options);
    if (response.ok && response.value) {
      return ok(response.value);
    }
    return err(response.error?.message ?? "Image generation failed");
  }
}
