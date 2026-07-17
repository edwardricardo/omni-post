/**
 * @file DeletePostUseCase.ts
 * @description Orchestrates post deletion by validating the post state (only draft/failed), removing via repository within UoW, and incrementing deletion metrics.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { AccountId, PostId, type PostRepository } from "@core/domain/index.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for a delete (CWE-639 gate). Discriminated union so
 * the compiler forces every call site to declare its authorization surface:
 * a `customer` caller is ownership-gated against stored ownership; a `system`
 * caller (e.g. saga compensation) skips the gate explicitly and auditably.
 * Omitting the context is a compile error — no call site can obtain an ungated
 * delete by forgetting a parameter.
 */
export type DeletePostCaller =
  | { type: "customer"; accountId: string }
  | { type: "system"; source: string };

/**
 * Input DTO for deleting a post
 */
export interface DeletePostInput {
  postId: string;
  /**
   * Required auth context. Customer callers are ownership-gated against stored
   * ownership; system callers skip the gate explicitly (see {@link DeletePostCaller}).
   */
  caller: DeletePostCaller;
}

/**
 * Delete Post Use Case
 *
 * Deletes a post by its ID.
 * Note: Only draft and failed posts can be deleted. Published posts should be cancelled first.
 *
 * @example
 * const useCase = new DeletePostUseCase(postRepository, businessMetrics);
 * const result = await useCase.execute({
 *   postId: 'post-123',
 *   caller: { type: 'customer', accountId: 'account-abc' },
 * });
 */
export class DeletePostUseCase implements CommandUseCase<DeletePostInput, UseCaseError> {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly businessMetrics: BusinessMetricsPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: DeletePostInput): Promise<Result<void, UseCaseError>> {
    // Validate post ID
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Caller-context ownership gate (CWE-639). Runs BEFORE load, status check,
    // and delete so a foreign id never reaches the mutation and non-owners
    // cannot observe the status-based FORBIDDEN branch. The switch is
    // exhaustive over DeletePostCaller; the `never` default fails closed if a
    // future variant is added without handling it here.
    const { caller } = input;
    switch (caller.type) {
      case "customer": {
        const ownerAccountId = await this.postRepository.findOwnerAccountId(postIdResult.value);
        const callerAccountId = AccountId.fromString(caller.accountId);
        if (
          !ownerAccountId ||
          !callerAccountId.ok ||
          !ownerAccountId.equals(callerAccountId.value)
        ) {
          // Mismatch and nonexistent are indistinguishable — NOT_FOUND, never
          // FORBIDDEN — so no signal reveals a foreign id exists (anti-enumeration).
          return err(
            new UseCaseError(`Post not found: ${input.postId}`, USE_CASE_ERRORS.NOT_FOUND)
          );
        }
        break;
      }
      case "system":
        // Explicit, auditable bypass of the ownership gate for internal callers.
        break;
      default: {
        const exhaustive: never = caller;
        throw new Error(`Unhandled delete caller type: ${JSON.stringify(exhaustive)}`);
      }
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

    // Delete the post (atomically via UoW when available)
    const doDelete = async (): Promise<Result<void, UseCaseError>> => {
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
      this.businessMetrics.incrementPostDeleted();

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doDelete();
        });
        return result;
      }
      return await doDelete();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to delete post",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
