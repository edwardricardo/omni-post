/**
 * @file EditCommentUseCase.ts
 * @description Application use case for editing an existing comment body.
 *   Only the original author can edit their comment.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { PostCommentRepository } from "@core/domain/repositories/PostCommentRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for editing a comment
 */
export interface EditCommentCommand {
  commentId: string;
  editorId: string;
  body: string;
}

/**
 * @class EditCommentUseCase
 * @description Loads an existing comment, applies the body edit via the aggregate,
 *   and persists the updated state.
 */
export class EditCommentUseCase implements UseCase<EditCommentCommand, void, UseCaseError> {
  constructor(
    private readonly commentRepo: PostCommentRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Edits the body of an existing comment.
   * @param command - The edit parameters (commentId, editorId, new body)
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(command: EditCommentCommand): Promise<Result<void, UseCaseError>> {
    // Load comment by ID
    const findResult = await this.commentRepo.findById(command.commentId);

    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.NOT_FOUND, findResult.error)
      );
    }

    const comment = findResult.value;

    // Apply the edit via aggregate behavior
    const editResult = comment.editBody(command.body, command.editorId);

    if (!editResult.ok) {
      return err(
        new UseCaseError(
          editResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          editResult.error
        )
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
          "Failed to save comment",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
