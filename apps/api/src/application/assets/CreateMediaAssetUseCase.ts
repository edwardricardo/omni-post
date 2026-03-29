/**
 * @file CreateMediaAssetUseCase.ts
 * @description Orchestrates media asset creation: validates input, constructs the
 *   MediaAsset entity via its factory method, and persists it through the repository.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type MediaAssetRepository } from "../../domain/repositories/MediaAssetRepository.js";
import { MediaAsset } from "../../domain/entities/MediaAsset.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for creating a media asset.
 */
export interface CreateMediaAssetInput {
  accountId: string;
  projectId?: string;
  name: string;
  description?: string;
  url: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  duration?: number;
  folderId?: string;
}

/**
 * Output DTO for a successfully created media asset.
 */
export interface CreateMediaAssetOutput {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * @class CreateMediaAssetUseCase
 * @description Creates a new media asset entity and persists it via the repository.
 */
export class CreateMediaAssetUseCase implements UseCase<
  CreateMediaAssetInput,
  CreateMediaAssetOutput,
  UseCaseError
> {
  constructor(
    private readonly mediaAssetRepository: MediaAssetRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates a new media asset and persists it.
   * @param input - Validated creation parameters
   * @returns Result<CreateMediaAssetOutput> on success, UseCaseError on failure
   */
  async execute(
    input: CreateMediaAssetInput
  ): Promise<Result<CreateMediaAssetOutput, UseCaseError>> {
    // 1. Create MediaAsset entity via domain factory
    const createResult = MediaAsset.create({
      accountId: input.accountId,
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
      url: input.url,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ...(input.width !== undefined && { width: input.width }),
      ...(input.height !== undefined && { height: input.height }),
      ...(input.duration !== undefined && { duration: input.duration }),
      ...(input.folderId !== undefined && { folderId: input.folderId }),
    });

    if (!createResult.ok) {
      return err(
        new UseCaseError(
          createResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          createResult.error
        )
      );
    }

    const asset = createResult.value;

    // 2. Persist via repository (atomically via UoW when available)
    const doWork = async (): Promise<Result<CreateMediaAssetOutput, UseCaseError>> => {
      const saveResult = await this.mediaAssetRepository.save(asset);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save media asset",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({
        id: asset.id.value,
        name: asset.name,
        url: asset.url,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateMediaAssetOutput, UseCaseError> = ok({
          id: asset.id.value,
          name: asset.name,
          url: asset.url,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save media asset",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
