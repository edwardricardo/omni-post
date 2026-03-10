/**
 * @file PrismaGeneratedImageRepository.ts
 * @description Infrastructure adapter that implements the GeneratedImageRepository port
 *              using Prisma ORM for persistence operations.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  GeneratedImageRepository,
  GeneratedImageData,
} from "../../domain/repositories/GeneratedImageRepository.js";

/**
 * PrismaGeneratedImageRepository - Implements GeneratedImageRepository using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture - it implements
 * the repository PORT defined in the domain layer.
 */
export class PrismaGeneratedImageRepository implements GeneratedImageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Persists a generated image record to the database.
   * @param image - The generated image data to save
   * @returns Result with the saved image data or an error
   */
  async save(image: GeneratedImageData): Promise<Result<GeneratedImageData, Error>> {
    try {
      const created = await this.prisma.generatedImage.create({
        data: {
          id: image.id,
          projectId: image.projectId,
          prompt: image.prompt,
          revisedPrompt: image.revisedPrompt,
          imageUrl: image.imageUrl,
          size: image.size,
          quality: image.quality,
          style: image.style,
          createdAt: image.createdAt,
        },
      });

      return ok({
        id: created.id,
        projectId: created.projectId,
        prompt: created.prompt,
        revisedPrompt: created.revisedPrompt ?? "",
        imageUrl: created.imageUrl,
        size: created.size,
        quality: created.quality,
        style: created.style,
        createdAt: created.createdAt,
      });
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method findByProjectId
   * @description Retrieves generated images for a given project, sorted by most recent.
   * @param projectId - The project ID to filter by
   * @param limit - Maximum number of results (default 20)
   * @returns Result with an array of generated image data or an error
   */
  async findByProjectId(
    projectId: string,
    limit: number = 20
  ): Promise<Result<GeneratedImageData[], Error>> {
    try {
      const images = await this.prisma.generatedImage.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return ok(
        images.map((img) => ({
          id: img.id,
          projectId: img.projectId,
          prompt: img.prompt,
          revisedPrompt: img.revisedPrompt ?? "",
          imageUrl: img.imageUrl,
          size: img.size,
          quality: img.quality,
          style: img.style,
          createdAt: img.createdAt,
        }))
      );
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
