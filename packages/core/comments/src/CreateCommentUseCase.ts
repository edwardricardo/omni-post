/**
 * @file CreateCommentUseCase.ts
 * @description Application use case for creating a new in-context comment on a post.
 *   Validates input, creates the PostCommentAggregate, and persists it.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { PostCommentRepository } from "@core/domain/repositories/PostCommentRepository.js";
import type { PostRepository } from "@core/domain/index.js";
import { PostId } from "@core/domain/value-objects/EntityId.js";
import { PostCommentAggregate } from "@core/domain/aggregates/PostCommentAggregate.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for creating a comment
 */
export interface CreateCommentCommand {
  postId: string;
  authorId: string;
  body: string;
  parentId?: string;
  /**
   * Cross-tenant ownership gate (CWE-639 create-on-foreign-post). When set, the
   * use case resolves the target post's owner via `PostRepository` (post ->
   * project -> accountId) and rejects a foreign caller with NOT_FOUND
   * (anti-enumeration) before any save. Optional for system/admin callers.
   */
  callerAccountId?: string;
}

/**
 * Output DTO for created comment
 */
export interface CreateCommentOutput {
  id: string;
  mentions: string[];
}

/**
 * @class CreateCommentUseCase
 * @description Creates a new post comment, persists it via the repository,
 *   and returns the comment ID along with extracted mentions.
 */
export class CreateCommentUseCase implements UseCase<
  CreateCommentCommand,
  CreateCommentOutput,
  UseCaseError
> {
  constructor(
    private readonly commentRepo: PostCommentRepository,
    private readonly postRepository?: PostRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates a new comment on a post.
   * @param command - The comment creation parameters
   * @returns Result<{ id, mentions }> on success, UseCaseError on failure
   */
  async execute(command: CreateCommentCommand): Promise<Result<CreateCommentOutput, UseCaseError>> {
    // Cross-tenant ownership gate (CWE-639 create-on-foreign-post). Resolve the
    // target post's owning accountId (post -> project -> accountId) and reject a
    // caller who does not own it with NOT_FOUND (anti-enumeration), before any
    // save. Reuses the PostRepository owner resolver added for IDOR-POSTS.
    if (command.callerAccountId !== undefined && this.postRepository) {
      const postIdResult = PostId.fromString(command.postId);
      if (!postIdResult.ok) {
        return err(
          new UseCaseError(`Post not found: ${command.postId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }
      const ownerAccountId = await this.postRepository.findOwnerAccountId(postIdResult.value);
      if (!ownerAccountId || ownerAccountId.value !== command.callerAccountId) {
        return err(
          new UseCaseError(`Post not found: ${command.postId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }
    }

    // Create the aggregate via the domain factory
    const createResult = PostCommentAggregate.create({
      postId: command.postId,
      authorId: command.authorId,
      body: command.body,
      ...(command.parentId !== undefined && { parentId: command.parentId }),
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

    const comment = createResult.value;

    // Persist (atomically via UoW when available)
    const doWork = async (): Promise<Result<CreateCommentOutput, UseCaseError>> => {
      await this.commentRepo.save(comment);

      return ok({
        id: comment.id.value,
        mentions: [...comment.mentions],
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateCommentOutput, UseCaseError> = ok({
          id: comment.id.value,
          mentions: [...comment.mentions],
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
          "Failed to save comment",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
