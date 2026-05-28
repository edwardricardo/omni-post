/**
 * @file GetFirstCommentQuery.ts
 * @description Application query for retrieving the first comment of a post.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { FirstCommentRepository } from "@core/domain/repositories/FirstCommentRepository.js";

/**
 * Input parameters for the query
 */
export interface GetFirstCommentQueryParams {
  postId: string;
}

/**
 * Output DTO for the first comment
 */
export interface FirstCommentDTO {
  id: string;
  postId: string;
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  providerCommentId?: string;
  error?: string;
}

/**
 * @class GetFirstCommentQuery
 * @description Retrieves the first comment for a given post, returning a DTO.
 */
export class GetFirstCommentQuery implements UseCase<
  GetFirstCommentQueryParams,
  FirstCommentDTO | null,
  UseCaseError
> {
  constructor(private readonly firstCommentRepo: FirstCommentRepository) {}

  /**
   * @method execute
   * @description Fetches the first comment for a post by its post ID.
   * @param params - Query parameters containing postId
   * @returns Result containing the DTO or null if none exists
   */
  async execute(
    params: GetFirstCommentQueryParams
  ): Promise<Result<FirstCommentDTO | null, UseCaseError>> {
    const findResult = await this.firstCommentRepo.findByPostId(params.postId);

    if (!findResult.ok) {
      return err(
        new UseCaseError(findResult.error.message, USE_CASE_ERRORS.INTERNAL_ERROR, findResult.error)
      );
    }

    const data = findResult.value;
    if (!data) {
      return ok(null);
    }

    return ok({
      id: data.id,
      postId: data.postId,
      body: data.body,
      status: data.status,
      createdAt: data.createdAt.toISOString(),
      updatedAt: data.updatedAt.toISOString(),
      ...(data.publishedAt !== undefined && { publishedAt: data.publishedAt.toISOString() }),
      ...(data.providerCommentId !== undefined && { providerCommentId: data.providerCommentId }),
      ...(data.error !== undefined && { error: data.error }),
    });
  }
}
