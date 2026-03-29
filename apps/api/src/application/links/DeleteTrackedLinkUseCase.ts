/**
 * @file DeleteTrackedLinkUseCase.ts
 * @description Deletes a tracked link and all associated click data after verifying existence.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { TrackedLinkId, type TrackedLinkRepository } from "../../domain/index.js";
import { type DeleteLinkInput } from "./types.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * @class DeleteTrackedLinkUseCase
 * @description Validates link existence and delegates deletion to the repository.
 */
export class DeleteTrackedLinkUseCase implements UseCase<DeleteLinkInput, void, UseCaseError> {
  constructor(
    private readonly repository: TrackedLinkRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Deletes a tracked link after verifying it exists.
   * @param input - Link ID to delete
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(input: DeleteLinkInput): Promise<Result<void, UseCaseError>> {
    // 1. Validate link ID
    const linkIdResult = TrackedLinkId.fromString(input.linkId);
    if (!linkIdResult.ok) {
      return err(
        new UseCaseError(`Invalid link ID: ${input.linkId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // 2. Verify link exists
    const findResult = await this.repository.findById(linkIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Tracked link not found: ${input.linkId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    // 3. Delete the link (atomically via UoW when available)
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const deleteResult = await this.repository.delete(linkIdResult.value);
      if (!deleteResult.ok) {
        return err(
          new UseCaseError(
            "Failed to delete tracked link",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            deleteResult.error
          )
        );
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to delete tracked link",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
