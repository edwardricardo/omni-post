/**
 * @file ImageGenerationPort.ts
 * @description Application-layer port for AI image generation. The
 *              `GenerateImageUseCase` depends on this interface, not on the
 *              concrete `AIService` adapter in infrastructure. The contract is
 *              technology-free and returns a `Result` (not the provider's
 *              `AIResponse` wrapper): `ok` guarantees a value; any provider,
 *              transport, or empty-payload failure resolves to `err(message)`.
 * @layer domain
 */

import type { Result } from "@shared/types";

/** Parameters for an image-generation request. */
export interface ImageGenerationOptions {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
  quality?: "standard" | "hd";
  style?: "natural" | "vivid";
  n?: number;
}

/** A single generated image: its URL and the provider's revised prompt. */
export interface ImageGenerationResult {
  imageUrl: string;
  revisedPrompt: string;
}

/**
 * Port for generating images from a text prompt. The infrastructure adapter
 * backs this with the AI service/orchestrator; the error is the human-readable
 * message surfaced to the caller.
 */
export interface ImageGenerationPort {
  generateImage(options: ImageGenerationOptions): Promise<Result<ImageGenerationResult, string>>;
}
