/**
 * @file RemoveFirstCommentUseCase.ts
 * @description Application use case for removing the first comment from a post.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { FirstCommentRepository } from "../../domain/repositories/FirstCommentRepository.js";

/**
 * Input DTO for removing a first comment
 */
export interface RemoveFirstCommentCommand {
  postId: string;
}

/**
 * @class RemoveFirstCommentUseCase
 * @description Removes the first comment associated with a post.
 *   Returns NOT_FOUND error if no first comment exists for the given post.
 */
export class RemoveFirstCommentUseCase
  implements CommandUseCase<RemoveFirstCommentCommand, UseCaseError>
{
  constructor(private readonly firstCommentRepo: FirstCommentRepository) {}

  /**
   * @method execute
   * @description Deletes the first comment for a given post.
   * @param command - Contains the post ID
   * @returns Result<void> on success, UseCaseError on failure
   */
  async execute(command: RemoveFirstCommentCommand): Promise<Result<void, UseCaseError>> {
    const deleteResult = await this.firstCommentRepo.delete(command.postId);

    if (!deleteResult.ok) {
      return err(
        new UseCaseError(
          `First comment not found for post ${command.postId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          deleteResult.error
        )
      );
    }

    return ok(undefined);
  }
}
