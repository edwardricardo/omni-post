/**
 * @file CreateAssetTagUseCase.ts
 * @description Creates a new asset tag for an account. Validates the tag name
 *   and handles unique constraint violations.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type AssetTagRepository,
  type AssetTagDTO,
} from "../../domain/repositories/AssetTagRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for creating an asset tag.
 */
export interface CreateAssetTagInput {
  accountId: string;
  name: string;
  color?: string;
}

/**
 * @class CreateAssetTagUseCase
 * @description Validates tag name and delegates persistence to the repository.
 *   Handles unique constraint errors for duplicate tag names within an account.
 */
export class CreateAssetTagUseCase implements UseCase<
  CreateAssetTagInput,
  AssetTagDTO,
  UseCaseError
> {
  constructor(
    private readonly assetTagRepository: AssetTagRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates a new asset tag.
   * @param input - Tag name, account ID, and optional color
   * @returns Result<AssetTagDTO> on success, UseCaseError on failure
   */
  async execute(input: CreateAssetTagInput): Promise<Result<AssetTagDTO, UseCaseError>> {
    // 1. Validate tag name
    if (!input.name || input.name.trim().length === 0) {
      return err(new UseCaseError("Tag name must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // 2. Persist via repository (atomically via UoW when available)
    const doWork = async (): Promise<Result<AssetTagDTO, UseCaseError>> => {
      const saveResult = await this.assetTagRepository.save({
        accountId: input.accountId,
        name: input.name.trim(),
        ...(input.color !== undefined && { color: input.color }),
      });

      if (!saveResult.ok) {
        const isUniqueViolation =
          saveResult.error.message.includes("unique") ||
          saveResult.error.message.includes("duplicate");

        if (isUniqueViolation) {
          return err(
            new UseCaseError(
              `Tag "${input.name}" already exists for this account`,
              USE_CASE_ERRORS.CONFLICT,
              saveResult.error
            )
          );
        }

        return err(
          new UseCaseError(
            "Failed to create asset tag",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok(saveResult.value);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<AssetTagDTO, UseCaseError> = ok({
          id: "",
          accountId: input.accountId,
          name: input.name.trim(),
          color: input.color ?? "",
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
          "Failed to create asset tag",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
