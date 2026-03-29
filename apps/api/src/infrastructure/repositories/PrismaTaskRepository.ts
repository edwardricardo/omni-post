/**
 * @file PrismaTaskRepository.ts
 * @description Infrastructure adapter implementing TaskRepository using Prisma ORM.
 *   Maps between Prisma database records and Task domain entities.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { TaskRepository, TaskFilters } from "../../domain/repositories/TaskRepository.js";
import {
  Task,
  type TaskProps,
  type TaskStatusValue,
  type TaskPriorityValue,
} from "../../domain/entities/Task.js";

/**
 * Priority ordering for descending sort (higher priority first).
 */
const PRIORITY_ORDER: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Raw Prisma row shape for type-safe mapping.
 */
interface PrismaTaskRow {
  id: string;
  accountId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  createdById: string;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  postId: string | null;
}

/**
 * @class PrismaTaskRepository
 * @description Adapter for TaskRepository using Prisma.
 */
export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a task by its unique identifier.
   * @param id - The task ID
   * @returns Result containing entity on success, Error if not found
   */
  async findById(id: string): Promise<Result<Task, Error>> {
    try {
      const row = await this.prisma.task.findUnique({
        where: { id },
      });

      if (!row) {
        return err(new Error(`Task not found: ${id}`));
      }

      return ok(this.toDomain(row as PrismaTaskRow));
    } catch (error: unknown) {
      return err(
        new Error(
          `Failed to find Task ${id}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method findByAccountId
   * @description Returns all non-deleted tasks for an account with optional filters.
   *   Orders by priority descending, then createdAt descending.
   * @param accountId - The account ID
   * @param filters - Optional filters for status, priority, assigneeId, projectId, limit, offset
   * @returns Array of Task domain entities
   */
  async findByAccountId(accountId: string, filters?: TaskFilters): Promise<Task[]> {
    const where: Record<string, unknown> = {
      accountId,
      deletedAt: null,
    };

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.priority) {
      where.priority = filters.priority;
    }
    if (filters?.assigneeId) {
      where.assigneeId = filters.assigneeId;
    }
    if (filters?.projectId) {
      where.projectId = filters.projectId;
    }

    const rows = await this.prisma.task.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      ...(filters?.limit !== undefined && { take: filters.limit }),
      ...(filters?.offset !== undefined && { skip: filters.offset }),
    });

    // Sort by priority descending in JS since Prisma enum ordering is alphabetical
    const mapped = (rows as PrismaTaskRow[]).map((row) => this.toDomain(row));
    mapped.sort((a, b) => {
      const aPrio = PRIORITY_ORDER[a.priority] ?? 0;
      const bPrio = PRIORITY_ORDER[b.priority] ?? 0;
      if (bPrio !== aPrio) return bPrio - aPrio;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return mapped;
  }

  /**
   * @method save
   * @description Persists a task via upsert (create if new, update if exists).
   * @param task - The Task domain entity
   * @returns Result<void, Error>
   */
  async save(task: Task): Promise<Result<void, Error>> {
    try {
      const json = task.toJSON();
      const data = {
        accountId: json.accountId,
        title: json.title,
        status: json.status,
        priority: json.priority,
        createdById: json.createdById,
        updatedAt: json.updatedAt,
        ...(json.projectId !== null && { projectId: json.projectId }),
        ...(json.description !== null && { description: json.description }),
        ...(json.assigneeId !== null && { assigneeId: json.assigneeId }),
        ...(json.dueDate !== null && { dueDate: json.dueDate }),
        ...(json.completedAt !== null && { completedAt: json.completedAt }),
        ...(json.deletedAt !== null && { deletedAt: json.deletedAt }),
        ...(json.postId !== null && { postId: json.postId }),
      };

      await this.prisma.task.upsert({
        where: { id: json.id },
        create: {
          id: json.id,
          ...data,
          createdAt: json.createdAt,
        },
        update: data,
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new Error(`Failed to save Task: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }

  /**
   * @method softDelete
   * @description Sets deletedAt on a task without physical removal.
   * @param id - The task ID
   * @returns Result<void, Error>
   */
  async softDelete(id: string): Promise<Result<void, Error>> {
    try {
      const existing = await this.prisma.task.findUnique({
        where: { id },
      });

      if (!existing) {
        return err(new Error(`Task not found: ${id}`));
      }

      await this.prisma.task.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new Error(
          `Failed to soft-delete Task ${id}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row to a Task domain entity.
   */
  private toDomain(row: PrismaTaskRow): Task {
    return Task.reconstitute({
      id: row.id,
      accountId: row.accountId,
      projectId: row.projectId,
      title: row.title,
      description: row.description,
      status: row.status as TaskStatusValue,
      priority: row.priority as TaskPriorityValue,
      assigneeId: row.assigneeId,
      createdById: row.createdById,
      dueDate: row.dueDate,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      postId: row.postId,
    } satisfies TaskProps);
  }
}
