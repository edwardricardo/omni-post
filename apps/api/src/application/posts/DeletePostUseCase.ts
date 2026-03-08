/**
 * Application Layer - Delete Post Use Case
 *
 * Part of Sprint 8: DDD Architecture Implementation
 * Handles deleting a post.
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { PostId, type PostRepository } from "../../domain/index.js";
import { incrementPostDeleted } from "../../metrics/businessMetrics.js";

/**
 * Input DTO for deleting a post
 */
export interface DeletePostInput {
  postId: string;
}

/**
 * Delete Post Use Case
 *
 * Deletes a post by its ID.
 * Note: Only draft and failed posts can be deleted. Published posts should be cancelled first.
 *
 * @example
 * const useCase = new DeletePostUseCase(postRepository);
 * const result = await useCase.execute({ postId: 'post-123' });
 */
export class DeletePostUseCase implements CommandUseCase<DeletePostInput, UseCaseError> {
  constructor(private readonly postRepository: PostRepository) {}

  async execute(input: DeletePostInput): Promise<Result<void, UseCaseError>> {
    // Validate post ID
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Find the post to check if it can be deleted
    const findResult = await this.postRepository.findById(postIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Post not found: ${input.postId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const post = findResult.value;

    // Only allow deletion of editable posts
    if (!post.isEditable && !post.status.isCancelled()) {
      return err(
        new UseCaseError(
          `Cannot delete post in status: ${post.status.value}. Only draft, failed, or cancelled posts can be deleted.`,
          USE_CASE_ERRORS.FORBIDDEN
        )
      );
    }

    // Delete the post
    const deleteResult = await this.postRepository.delete(postIdResult.value);
    if (!deleteResult.ok) {
      return err(
        new UseCaseError(
          "Failed to delete post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          deleteResult.error
        )
      );
    }

    // Business metric: post successfully deleted
    incrementPostDeleted();

    return ok(undefined);
  }
}
