/**
 * @file GetPostUseCase.ts
 * @description CQRS read-side query that retrieves a single post by ID via PostQueryRepository and returns Result<PostDTO>.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  AccountId,
  PostId,
  type PostQueryRepository,
  type PostReadModel,
} from "@core/domain/index.js";

/**
 * Input DTO for getting a post
 */
export interface GetPostInput {
  postId: string;
  /**
   * Server-derived caller account (from `request.customerUser.accountId`, never
   * client input). REQUIRED — the read is scoped to it so a foreign-account post
   * resolves to NOT_FOUND (CWE-639). Fail-closed by construction: no call site
   * can obtain an unscoped read by omitting it.
   */
  callerAccountId: string;
}

/**
 * Output DTO for post details.
 * Aliased to PostReadModel — the query repo returns the read model directly,
 * so no manual aggregate-to-DTO mapping is required.
 */
export type PostDTO = PostReadModel;

/**
 * Get Post Use Case
 *
 * Retrieves a post read model by its ID.
 * Uses PostQueryRepository (CQRS read side) for optimised flat queries.
 *
 * @example
 * const useCase = new GetPostUseCase(postQueryRepository);
 * const result = await useCase.execute({ postId: 'post-123' });
 */
export class GetPostUseCase implements UseCase<GetPostInput, PostDTO, UseCaseError> {
  constructor(private readonly postQueryRepository: PostQueryRepository) {}

  async execute(input: GetPostInput): Promise<Result<PostDTO, UseCaseError>> {
    // Validate post ID
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Validate the server-derived caller account (CWE-639 read scope).
    const accountIdResult = AccountId.fromString(input.callerAccountId);
    if (!accountIdResult.ok) {
      return err(new UseCaseError("Invalid caller account", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Query the read model directly — no aggregate loading overhead. The account
    // scope makes a foreign-owned post resolve to NOT_FOUND (anti-enumeration).
    const findResult = await this.postQueryRepository.getById(
      postIdResult.value,
      accountIdResult.value
    );
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Post not found: ${input.postId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    return ok(findResult.value);
  }
}
