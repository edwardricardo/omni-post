/**
 * @file PrismaRecurringPostRepository.ts
 * @description Infrastructure adapter implementing RecurringPostRepository port
 *   using Prisma ORM. Maps between Prisma database types and RecurringPostData DTOs.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  RecurringPostRepository,
  RecurringPostData,
} from "@core/domain/repositories/RecurringPostRepository.js";
import { EntityNotFoundError, type DomainError } from "@core/domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaRecurringPostRow {
  id: string;
  projectId: string;
  templatePostId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  startDate: Date;
  endDate: Date | null;
  maxOccurrences: number | null;
  occurrenceCount: number;
  isActive: boolean;
  lastScheduledAt: Date | null;
  nextScheduledAt: Date | null;
  channels: string[];
  contentVariation: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaRecurringPostRepository
 * @description Adapter for RecurringPostRepository using Prisma.
 *   Converts between Prisma database records and RecurringPostData DTOs.
 */
export class PrismaRecurringPostRepository implements RecurringPostRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Persists a recurring post via upsert on id.
   */
  async save(post: RecurringPostData): Promise<Result<RecurringPostData, DomainError>> {
    try {
      const row = await this.prisma.recurringPost.upsert({
        where: { id: post.id },
        create: {
          id: post.id,
          projectId: post.projectId,
          templatePostId: post.templatePostId,
          name: post.name,
          cronExpression: post.cronExpression,
          timezone: post.timezone,
          startDate: post.startDate,
          endDate: post.endDate ?? null,
          maxOccurrences: post.maxOccurrences ?? null,
          occurrenceCount: post.occurrenceCount,
          isActive: post.isActive,
          lastScheduledAt: post.lastScheduledAt ?? null,
          nextScheduledAt: post.nextScheduledAt ?? null,
          channels: post.channels,
          contentVariation: post.contentVariation,
        },
        update: {
          name: post.name,
          cronExpression: post.cronExpression,
          timezone: post.timezone,
          startDate: post.startDate,
          endDate: post.endDate ?? null,
          maxOccurrences: post.maxOccurrences ?? null,
          occurrenceCount: post.occurrenceCount,
          isActive: post.isActive,
          lastScheduledAt: post.lastScheduledAt ?? null,
          nextScheduledAt: post.nextScheduledAt ?? null,
          channels: post.channels,
          contentVariation: post.contentVariation,
        },
      });

      return ok(this.toData(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "RecurringPost",
          `save failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method findById
   * @description Finds a recurring post by its unique identifier.
   */
  async findById(id: string): Promise<Result<RecurringPostData, DomainError>> {
    try {
      const row = await this.prisma.recurringPost.findUnique({ where: { id } });

      if (!row) {
        return err(new EntityNotFoundError("RecurringPost", id));
      }

      return ok(this.toData(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "RecurringPost",
          `findById failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method findByProjectId
   * @description Finds all recurring posts belonging to a project.
   */
  async findByProjectId(projectId: string): Promise<Result<RecurringPostData[], DomainError>> {
    try {
      const rows = await this.prisma.recurringPost.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });

      return ok(rows.map((row) => this.toData(row)));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "RecurringPost",
          `findByProjectId failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method findActiveByNextScheduled
   * @description Finds active recurring posts whose nextScheduledAt is at or before the given date.
   */
  async findActiveByNextScheduled(before: Date): Promise<Result<RecurringPostData[], DomainError>> {
    try {
      const rows = await this.prisma.recurringPost.findMany({
        where: {
          isActive: true,
          nextScheduledAt: { lte: before },
        },
        orderBy: { nextScheduledAt: "asc" },
      });

      return ok(rows.map((row) => this.toData(row)));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "RecurringPost",
          `findActiveByNextScheduled failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method delete
   * @description Removes a recurring post by its unique identifier.
   */
  async delete(id: string): Promise<Result<void, DomainError>> {
    try {
      const existing = await this.prisma.recurringPost.findUnique({ where: { id } });

      if (!existing) {
        return err(new EntityNotFoundError("RecurringPost", id));
      }

      await this.prisma.recurringPost.delete({ where: { id } });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "RecurringPost",
          `delete failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method toData
   * @description Maps a Prisma row to a RecurringPostData DTO.
   */
  private toData(row: PrismaRecurringPostRow): RecurringPostData {
    return {
      id: row.id,
      projectId: row.projectId,
      templatePostId: row.templatePostId,
      name: row.name,
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      startDate: row.startDate,
      occurrenceCount: row.occurrenceCount,
      isActive: row.isActive,
      channels: row.channels,
      contentVariation: row.contentVariation,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.endDate !== null && { endDate: row.endDate }),
      ...(row.maxOccurrences !== null && { maxOccurrences: row.maxOccurrences }),
      ...(row.lastScheduledAt !== null && { lastScheduledAt: row.lastScheduledAt }),
      ...(row.nextScheduledAt !== null && { nextScheduledAt: row.nextScheduledAt }),
    };
  }
}
