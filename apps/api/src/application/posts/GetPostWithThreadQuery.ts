/**
 * Application Layer - Get Post With Thread Query
 *
 * CQRS read-side query that retrieves a post enriched with its thread data
 * (tweets ordered by sequence number). Uses PostQueryRepository.getByIdWithThread()
 * for a single optimized query instead of separate post + thread lookups.
 *
 * Part of P2-ARCH-1: Migrate postRoutes Prisma direct calls to use cases.
 *
 * @module application/posts/GetPostWithThreadQuery
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  PostId,
  type PostQueryRepository,
  type PostReadModelWithThread,
} from "../../domain/index.js";

/**
 * Input DTO for getting a post with thread data.
 *
 * @property postId - UUID of the post to retrieve.
 */
export interface GetPostWithThreadInput {
  postId: string;
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
export class GetPostWithThreadQuery
  implements UseCase<GetPostWithThreadInput, PostReadModelWithThread, UseCaseError>
{
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

    // Query the read model with thread enrichment
    const findResult = await this.postQueryRepository.getByIdWithThread(postIdResult.value);
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
