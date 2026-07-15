/**
 * @file GeneratedImageRepository.ts
 * @description Domain port interface for GeneratedImage persistence.
 *              Defines the contract that infrastructure adapters must fulfill.
 * @layer domain
 */

import { type Result } from "@shared/types";

/**
 * Data transfer object for generated image persistence
 */
export interface GeneratedImageData {
  id: string;
  accountId: string;
  projectId: string;
  prompt: string;
  revisedPrompt: string;
  imageUrl: string;
  size: string;
  quality: string;
  style: string;
  createdAt: Date;
}

/**
 * GeneratedImageRepository - Port interface for GeneratedImage persistence
 *
 * This is a PORT in hexagonal architecture - it defines the contract
 * that adapters (implementations) must fulfill.
 */
export interface GeneratedImageRepository {
  /**
   * Save a generated image record
   */
  save(image: GeneratedImageData): Promise<Result<GeneratedImageData, Error>>;

  /**
   * Find generated images by project ID, ordered by most recent first
   */
  findByProjectId(projectId: string, limit?: number): Promise<Result<GeneratedImageData[], Error>>;
}
