/**
 * @file PrismaPostCommentRepository.ts
 * @description Infrastructure adapter implementing PostCommentRepository port
 *   using Prisma ORM. Maps between Prisma database types and PostCommentAggregate
 *   domain objects. Supports cursor-based pagination and soft-delete.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  PostCommentRepository,
  PostCommentFindOptions,
  PostCommentPaginatedResult,
} from "@core/domain/repositories/PostCommentRepository.js";
import { PostCommentAggregate } from "@core/domain/aggregates/PostCommentAggregate.js";
import { CommentId } from "@core/domain/value-objects/CommentId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaPostCommentRow {
  id: string;
  postId: string;
  /** Nullable since `PostComment.authorId` became `ON DELETE SET NULL`. */
  authorId: string | null;
  parentId: string | null;
  body: string;
  mentions: string[];
  isEdited: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaPostCommentRepository
 * @description Adapter for PostCommentRepository using Prisma.
 *   Converts between Prisma database records and PostCommentAggregate domain objects.
 */
export class PrismaPostCommentRepository implements PostCommentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a comment by its unique identifier.
   * @param id - The comment ID string
   * @returns Result containing aggregate on success, EntityNotFoundError if missing
   */
  async findById(id: string): Promise<Result<PostCommentAggregate, EntityNotFoundError>> {
    try {
      const row = await this.prisma.postComment.findUnique({
        where: { id },
      });

      if (!row) {
        return err(new EntityNotFoundError("PostComment", id));
      }

      return ok(this.toDomain(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "PostComment",
          `${id} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method findByPost
   * @description Retrieves comments for a post with cursor-based pagination.
   *   When parentOnly is true, only top-level comments (no parentId) are returned.
   *   Excludes soft-deleted comments.
   * @param postId - The post ID to find comments for
   * @param options - Pagination and filter options
   * @returns Paginated result with comments and optional next cursor
   */
  async findByPost(
    postId: string,
    options: PostCommentFindOptions
  ): Promise<PostCommentPaginatedResult> {
    const limit = Math.min(options.limit, 100);

    // Build where clause: filter by post, exclude soft-deleted
    const where: Record<string, unknown> = {
      postId,
      deletedAt: null,
    };

    if (options.parentOnly) {
      where.parentId = null;
    }

    // Apply cursor-based pagination using createdAt + id
    if (options.cursor) {
      const cursorRow = await this.prisma.postComment.findUnique({
        where: { id: options.cursor },
        select: { createdAt: true, id: true },
      });

      if (cursorRow) {
        where.OR = [
          { createdAt: { lt: cursorRow.createdAt } },
          {
            createdAt: cursorRow.createdAt,
            id: { lt: cursorRow.id },
          },
        ];
      }
    }

    const rows = await this.prisma.postComment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const lastItem = items[items.length - 1];

    return {
      items: items.map((row) => this.toDomain(row)),
      ...(hasMore && lastItem ? { nextCursor: lastItem.id } : {}),
    };
  }

  /**
   * @method findReplies
   * @description Retrieves all direct replies to a given comment.
   *   Excludes soft-deleted replies. Ordered by creation time ascending.
   * @param parentId - The parent comment ID
   * @returns Array of reply comment aggregates
   */
  async findReplies(parentId: string): Promise<PostCommentAggregate[]> {
    const rows = await this.prisma.postComment.findMany({
      where: {
        parentId,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * @method save
   * @description Persists a comment aggregate (create or update via upsert).
   * @param comment - The PostCommentAggregate to save
   */
  async save(comment: PostCommentAggregate): Promise<void> {
    const data = {
      postId: comment.postId,
      authorId: comment.authorId,
      parentId: comment.parentId ?? null,
      body: comment.body,
      mentions: [...comment.mentions],
      isEdited: comment.isEdited,
      editedAt: comment.editedAt ?? null,
      deletedAt: comment.deletedAt ?? null,
    };

    await this.prisma.postComment.upsert({
      where: { id: comment.id.value },
      create: {
        id: comment.id.value,
        ...data,
      },
      update: {
        body: data.body,
        mentions: data.mentions,
        isEdited: data.isEdited,
        editedAt: data.editedAt,
        deletedAt: data.deletedAt,
      },
    });
  }

  /**
   * @method softDelete
   * @description Marks a comment as soft-deleted by setting deletedAt.
   * @param id - The comment ID string
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  async softDelete(id: string): Promise<Result<void, EntityNotFoundError>> {
    try {
      const existing = await this.prisma.postComment.findUnique({
        where: { id },
      });

      if (!existing) {
        return err(new EntityNotFoundError("PostComment", id));
      }

      await this.prisma.postComment.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "PostComment",
          `softDelete failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method countByPost
   * @description Counts non-deleted comments for a given post.
   * @param postId - The post ID
   * @returns The count of active (non-deleted) comments
   */
  async countByPost(postId: string): Promise<number> {
    return this.prisma.postComment.count({
      where: {
        postId,
        deletedAt: null,
      },
    });
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row to a PostCommentAggregate domain object.
   * @param row - Raw Prisma record
   * @returns Reconstituted PostCommentAggregate
   */
  private toDomain(row: PrismaPostCommentRow): PostCommentAggregate {
    return PostCommentAggregate.reconstitute({
      id: CommentId.fromStringUnsafe(row.id),
      postId: row.postId,
      authorId: row.authorId,
      body: row.body,
      mentions: [...row.mentions],
      isEdited: row.isEdited,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: 0,
      ...(row.parentId !== null && { parentId: row.parentId }),
      ...(row.editedAt !== null && { editedAt: row.editedAt }),
      ...(row.deletedAt !== null && { deletedAt: row.deletedAt }),
    });
  }
}
