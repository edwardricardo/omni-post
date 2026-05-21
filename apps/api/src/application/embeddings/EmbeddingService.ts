/**
 * @file EmbeddingService.ts
 * @description Application service that wraps `AIServicePort.generateEmbeddings`
 *              with a `Result`-typed return. Consumers obtain a typed
 *              vector matrix and a `UseCaseError` on failure instead of
 *              the port's raw `"AI_ERROR"` literal. Provider selection
 *              and fallback live in the orchestrator behind the port.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { AIServicePort } from "../../domain/repositories/AIServicePort.js";

export interface EmbeddingsOptions {
  model?: string;
  dimensions?: number;
}

export class EmbeddingService {
  constructor(private readonly aiPort: AIServicePort) {}

  /**
   * @method embed
   * @description Generates embeddings for one or more texts. Returns the
   *   ordered matrix of vectors (`texts.length × dimensions`).
   * @param texts - Strings to embed.
   * @param options - Override the embedding model or dimensions.
   * @param accountId - Optional per-account routing key.
   * @returns Result with the embedding matrix or a UseCaseError.
   */
  async embed(
    texts: string[],
    options?: EmbeddingsOptions,
    accountId?: string
  ): Promise<Result<number[][], UseCaseError>> {
    if (texts.length === 0) {
      return ok([]);
    }

    const result = await this.aiPort.generateEmbeddings(texts, options, accountId);
    if (!result.ok) {
      return err(
        new UseCaseError(
          "Embeddings provider failed across all configured providers",
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
    return ok(result.value);
  }

  /**
   * @method embedSingle
   * @description Convenience method for the common single-text case.
   * @param text - String to embed.
   * @param options - Override the embedding model or dimensions.
   * @param accountId - Optional per-account routing key.
   * @returns Result with the embedding vector or a UseCaseError.
   */
  async embedSingle(
    text: string,
    options?: EmbeddingsOptions,
    accountId?: string
  ): Promise<Result<number[], UseCaseError>> {
    const result = await this.embed([text], options, accountId);
    if (!result.ok) return result;
    const vector = result.value[0];
    if (!vector) {
      return err(
        new UseCaseError(
          "Embeddings provider returned an empty result",
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
    return ok(vector);
  }
}
