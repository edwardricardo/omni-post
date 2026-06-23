/**
 * @file GetPostWithThreadQuery.ts
 * @description CQRS read-side query that retrieves a post enriched with its thread data (tweets ordered by sequence) via a single optimized PostQueryRepository call.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  AccountId,
  PostId,
  type PostQueryRepository,
  type PostReadModelWithThread,
} from "@core/domain/index.js";

/**
 * Input DTO for getting a post with thread data.
 *
 * @property postId - UUID of the post to retrieve.
 * @property callerAccountId - Cross-tenant isolation gate (CWE-639). Post is
 *   transitively tenant-scoped (FK -> Project.accountId); when set, the query
 *   repository adds a `project: { accountId }` joined filter and a post owned
 *   by another tenant resolves to NOT_FOUND (anti-enumeration). Optional for
 *   admin/internal callers that legitimately read across tenants.
 */
export interface GetPostWithThreadInput {
  postId: string;
  callerAccountId?: string;
}

/**
 * Get Post With Thread Query
 *
 * Retrieves a post read model enriched with thread data (if the post has an
 * associated thread). Uses the CQRS read side for optimized flat queries.
 *
 * @param postQueryRepository - Read-optimized query repository port.
 *
 * @returns PostReadModelWithThread on success, which includes the standard
 *   PostReadModel fields plus an optional `thread` property containing tweets.
 *
 * @throws UseCaseError with code VALIDATION_FAILED for invalid post ID format.
 * @throws UseCaseError with code NOT_FOUND when the post does not exist.
 *
 * @example
 * const query = new GetPostWithThreadQuery(postQueryRepository);
 * const result = await query.execute({ postId: "550e8400-..." });
 * if (result.ok) {
 *   console.log(result.value.thread?.tweets.length); // number of tweets
 * }
 */
export class GetPostWithThreadQuery implements UseCase<
  GetPostWithThreadInput,
  PostReadModelWithThread,
  UseCaseError
> {
  constructor(private readonly postQueryRepository: PostQueryRepository) {}

  async execute(
    input: GetPostWithThreadInput
  ): Promise<Result<PostReadModelWithThread, UseCaseError>> {
    // Validate post ID format
    const postIdResult = PostId.fromString(input.postId);
    if (!postIdResult.ok) {
      return err(
        new UseCaseError(`Invalid post ID: ${input.postId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Cross-tenant isolation gate (CWE-639). Pass the caller's accountId so the
    // query repository scopes by Project.accountId — a foreign post resolves to
    // not-found rather than leaking another tenant's data + thread.
    const callerAccountId =
      input.callerAccountId !== undefined
        ? AccountId.fromStringUnsafe(input.callerAccountId)
        : undefined;

    // Query the read model with thread enrichment
    const findResult = await this.postQueryRepository.getByIdWithThread(
      postIdResult.value,
      callerAccountId
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
