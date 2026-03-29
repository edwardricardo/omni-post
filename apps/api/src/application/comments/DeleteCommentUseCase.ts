/**
 * @file DeleteCommentUseCase.ts
 * @description Application use case for soft-deleting a comment.
 *   The comment author or an admin can delete a comment.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { PostCommentRepository } from "../../domain/repositories/PostCommentRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Input DTO for deleting a comment
 */
export interface DeleteCommentCommand {
  commentId: string;
  deleterId: string;
  isAdmin: boolean;
}

/**
 * @class DeleteCommentUseCase
 * @description Loads an existing comment, applies soft-delete via the aggregate,
 *   and persists the updated state.
 */
export class DeleteCommentUseCase implements UseCase<DeleteCommentCommand, void, UseCaseError> {
  constructor(
    private readonly commentRepo: PostCommentRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Soft-deletes an existing comment.
   * @param command - The delete parameters (commentId, deleterId, isAdmin)
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(command: DeleteCommentCommand): Promise<Result<void, UseCaseError>> {
    // Load comment by ID
    const findResult = await this.commentRepo.findById(command.commentId);

    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    const comment = findResult.value;

    // Apply soft-delete via aggregate behavior
    const deleteResult = comment.softDelete(command.deleterId, command.isAdmin);

    if (!deleteResult.ok) {
      return err(
        new UseCaseError(deleteResult.error.message, USE_CASE_ERRORS.FORBIDDEN, deleteResult.error)
      );
    }

    // Persist updated state (atomically via UoW when available)
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      await this.commentRepo.save(comment);
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
          "Failed to delete comment",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
