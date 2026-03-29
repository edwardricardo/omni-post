/**
 * @file CreateAssetFolderUseCase.ts
 * @description Creates a new asset folder for an account. Validates the folder name
 *   and verifies parent folder ownership when a parentId is provided.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type AssetFolderRepository,
  type AssetFolderDTO,
} from "../../domain/repositories/AssetFolderRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for creating an asset folder.
 */
export interface CreateAssetFolderInput {
  accountId: string;
  name: string;
  parentId?: string;
}

/**
 * @class CreateAssetFolderUseCase
 * @description Validates folder name, verifies parent folder ownership if applicable,
 *   and delegates persistence to the repository.
 */
export class CreateAssetFolderUseCase implements UseCase<
  CreateAssetFolderInput,
  AssetFolderDTO,
  UseCaseError
> {
  constructor(
    private readonly assetFolderRepository: AssetFolderRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates a new asset folder.
   * @param input - Folder name, account ID, and optional parent folder ID
   * @returns Result<AssetFolderDTO> on success, UseCaseError on failure
   */
  async execute(input: CreateAssetFolderInput): Promise<Result<AssetFolderDTO, UseCaseError>> {
    // 1. Validate folder name
    if (!input.name || input.name.trim().length === 0) {
      return err(
        new UseCaseError("Folder name must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // 2. Verify parent folder ownership if applicable
    if (input.parentId !== undefined) {
      const parent = await this.assetFolderRepository.findById(input.parentId, input.accountId);
      if (!parent) {
        return err(
          new UseCaseError(`Parent folder not found: ${input.parentId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }
    }

    // 3. Persist via repository (atomically via UoW when available)
    const doWork = async (): Promise<Result<AssetFolderDTO, UseCaseError>> => {
      const saveResult = await this.assetFolderRepository.save({
        accountId: input.accountId,
        name: input.name.trim(),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
      });

      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to create asset folder",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok(saveResult.value);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<AssetFolderDTO, UseCaseError> = ok({
          id: "",
          accountId: input.accountId,
          name: input.name.trim(),
          parentId: input.parentId ?? null,
          createdAt: new Date(),
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
          "Failed to create asset folder",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
