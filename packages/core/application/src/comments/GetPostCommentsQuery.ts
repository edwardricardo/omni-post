/**
 * @file GetPostCommentsQuery.ts
 * @description Application query for retrieving threaded comments on a post.
 *   Returns DTOs with top-level comments and their nested replies.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { PostCommentRepository } from "@core/domain/repositories/PostCommentRepository.js";
import type { PostCommentAggregate } from "@core/domain/aggregates/PostCommentAggregate.js";

/**
 * Input parameters for the query
 */
export interface GetPostCommentsQueryParams {
  postId: string;
  cursor?: string;
  limit?: number;
  parentOnly?: boolean;
}

/**
 * DTO for a single comment in the response
 */
export interface CommentDTO {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  mentions: string[];
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  editedAt?: string;
  replies?: CommentDTO[];
}

/**
 * Output DTO for the query result
 */
export interface GetPostCommentsOutput {
  items: CommentDTO[];
  totalCount: number;
  nextCursor?: string;
}

/**
 * @class GetPostCommentsQuery
 * @description Retrieves comments for a post with threaded structure.
 *   For top-level comments, replies are loaded and attached as nested DTOs.
 */
export class GetPostCommentsQuery implements UseCase<
  GetPostCommentsQueryParams,
  GetPostCommentsOutput,
  UseCaseError
> {
  constructor(private readonly commentRepo: PostCommentRepository) {}

  /**
   * @method execute
   * @description Fetches paginated comments for a post, including replies for each top-level comment.
   * @param params - Query parameters (postId, cursor, limit, parentOnly)
   * @returns Result containing threaded comment DTOs with pagination info
   */
  async execute(
    params: GetPostCommentsQueryParams
  ): Promise<Result<GetPostCommentsOutput, UseCaseError>> {
    try {
      const limit = params.limit ?? 20;
      const parentOnly = params.parentOnly ?? true;

      // Fetch top-level comments with pagination
      const result = await this.commentRepo.findByPost(params.postId, {
        limit,
        ...(params.cursor !== undefined && { cursor: params.cursor }),
        ...(parentOnly !== undefined && { parentOnly }),
      });

      // For each top-level comment, load replies
      const itemsWithReplies: CommentDTO[] = [];

      for (const comment of result.items) {
        const dto = this.toDTO(comment);

        // Only load replies for top-level comments
        if (!comment.isReply()) {
          const replies = await this.commentRepo.findReplies(comment.id.value);
          if (replies.length > 0) {
            dto.replies = replies.map((reply) => this.toDTO(reply));
          }
        }

        itemsWithReplies.push(dto);
      }

      // Get total count for the post
      const totalCount = await this.commentRepo.countByPost(params.postId);

      return ok({
        items: itemsWithReplies,
        totalCount,
        ...(result.nextCursor !== undefined && { nextCursor: result.nextCursor }),
      });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          `Failed to fetch comments: ${error instanceof Error ? error.message : String(error)}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
  }

  /**
   * @method toDTO
   * @description Maps a PostCommentAggregate to a CommentDTO.
   * @param comment - The aggregate to map
   * @returns A plain DTO object
   */
  private toDTO(comment: PostCommentAggregate): CommentDTO {
    return {
      id: comment.id.value,
      postId: comment.postId,
      authorId: comment.authorId,
      body: comment.body,
      mentions: [...comment.mentions],
      isEdited: comment.isEdited,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      ...(comment.parentId !== undefined && { parentId: comment.parentId }),
      ...(comment.editedAt !== undefined && { editedAt: comment.editedAt.toISOString() }),
    };
  }
}
