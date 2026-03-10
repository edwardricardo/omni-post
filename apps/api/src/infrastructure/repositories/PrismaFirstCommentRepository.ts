/**
 * @file PrismaFirstCommentRepository.ts
 * @description Infrastructure adapter implementing FirstCommentRepository port
 *   using Prisma ORM. Maps between Prisma database types and FirstCommentData DTOs.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  FirstCommentRepository,
  FirstCommentData,
} from "../../domain/repositories/FirstCommentRepository.js";
import { EntityNotFoundError, type DomainError } from "../../domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaFirstCommentRow {
  id: string;
  postId: string;
  body: string;
  status: string;
  publishedAt: Date | null;
  providerCommentId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaFirstCommentRepository
 * @description Adapter for FirstCommentRepository using Prisma.
 *   Converts between Prisma database records and FirstCommentData DTOs.
 */
export class PrismaFirstCommentRepository implements FirstCommentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Persists a first comment via upsert on postId (unique constraint).
   * @param comment - The first comment data to persist
   * @returns Result containing persisted data on success
   */
  async save(comment: FirstCommentData): Promise<Result<FirstCommentData, DomainError>> {
    try {
      const row = await this.prisma.firstComment.upsert({
        where: { postId: comment.postId },
        create: {
          id: comment.id,
          postId: comment.postId,
          body: comment.body,
          status: comment.status,
        },
        update: {
          body: comment.body,
          status: comment.status,
        },
      });

      return ok(this.toData(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "FirstComment",
          `save failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method findByPostId
   * @description Finds the first comment associated with a given post.
   * @param postId - The post ID to look up
   * @returns Result containing data or null if none exists
   */
  async findByPostId(postId: string): Promise<Result<FirstCommentData | null, DomainError>> {
    try {
      const row = await this.prisma.firstComment.findUnique({
        where: { postId },
      });

      if (!row) {
        return ok(null);
      }

      return ok(this.toData(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "FirstComment",
          `findByPostId failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method delete
   * @description Removes the first comment for a given post.
   * @param postId - The post ID whose first comment to delete
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  async delete(postId: string): Promise<Result<void, DomainError>> {
    try {
      const existing = await this.prisma.firstComment.findUnique({
        where: { postId },
      });

      if (!existing) {
        return err(new EntityNotFoundError("FirstComment", postId));
      }

      await this.prisma.firstComment.delete({
        where: { postId },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "FirstComment",
          `delete failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method updateStatus
   * @description Updates publishing status and optional result fields.
   * @param postId - The post ID whose first comment status to update
   * @param status - New status value
   * @param result - Optional publish result data
   * @returns Result<void> on success
   */
  async updateStatus(
    postId: string,
    status: string,
    result?: { providerCommentId?: string; error?: string }
  ): Promise<Result<void, DomainError>> {
    try {
      const existing = await this.prisma.firstComment.findUnique({
        where: { postId },
      });

      if (!existing) {
        return err(new EntityNotFoundError("FirstComment", postId));
      }

      await this.prisma.firstComment.update({
        where: { postId },
        data: {
          status,
          ...(status === "PUBLISHED" && { publishedAt: new Date() }),
          ...(result?.providerCommentId !== undefined && {
            providerCommentId: result.providerCommentId,
          }),
          ...(result?.error !== undefined && { error: result.error }),
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "FirstComment",
          `updateStatus failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method toData
   * @description Maps a Prisma row to a FirstCommentData DTO.
   * @param row - Raw Prisma record
   * @returns Plain FirstCommentData object
   */
  private toData(row: PrismaFirstCommentRow): FirstCommentData {
    return {
      id: row.id,
      postId: row.postId,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.publishedAt !== null && { publishedAt: row.publishedAt }),
      ...(row.providerCommentId !== null && { providerCommentId: row.providerCommentId }),
      ...(row.error !== null && { error: row.error }),
    };
  }
}
