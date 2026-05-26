/**
 * @file PrismaApprovalWorkflowRepository.ts
 * @description Infrastructure adapter implementing ApprovalWorkflowRepository port
 *   using Prisma ORM. Maps between Prisma database types and domain entities.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { ApprovalWorkflowRepository } from "@core/domain/repositories/ApprovalWorkflowRepository.js";
import { ApprovalWorkflow, type WorkflowLevel } from "@core/domain/entities/ApprovalWorkflow.js";
import { EntityNotFoundError, type DomainError } from "@core/domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaWorkflowRow {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  levels: PrismaWorkflowLevelRow[];
}

/**
 * Raw Prisma row shape for a single workflow level
 */
interface PrismaWorkflowLevelRow {
  id: string;
  workflowId: string;
  order: number;
  role: string | null;
  assigneeId: string | null;
  requireAll: boolean;
  createdAt: Date;
}

/**
 * @class PrismaApprovalWorkflowRepository
 * @description Adapter for ApprovalWorkflowRepository using Prisma.
 *   Converts between Prisma database records and ApprovalWorkflow domain entities.
 */
export class PrismaApprovalWorkflowRepository implements ApprovalWorkflowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds an approval workflow by its unique identifier, including levels.
   */
  async findById(id: string): Promise<Result<ApprovalWorkflow, EntityNotFoundError>> {
    try {
      const row = await this.prisma.approvalWorkflow.findUnique({
        where: { id },
        include: { levels: { orderBy: { order: "asc" } } },
      });

      if (!row) {
        return err(new EntityNotFoundError("ApprovalWorkflow", id));
      }

      return this.toDomain(row);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "ApprovalWorkflow",
          `${id} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method findByAccountId
   * @description Retrieves all approval workflows for a given account, including levels.
   */
  async findByAccountId(accountId: string): Promise<ApprovalWorkflow[]> {
    const rows = await this.prisma.approvalWorkflow.findMany({
      where: { accountId },
      include: { levels: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
    });

    const workflows: ApprovalWorkflow[] = [];
    for (const row of rows) {
      const result = this.toDomain(row);
      if (result.ok) {
        workflows.push(result.value);
      }
    }
    return workflows;
  }

  /**
   * @method findDefaultByAccountId
   * @description Retrieves the default approval workflow for a given account.
   */
  async findDefaultByAccountId(accountId: string): Promise<ApprovalWorkflow | null> {
    const row = await this.prisma.approvalWorkflow.findFirst({
      where: { accountId, isDefault: true, isActive: true },
      include: { levels: { orderBy: { order: "asc" } } },
    });

    if (!row) {
      return null;
    }

    const result = this.toDomain(row);
    return result.ok ? result.value : null;
  }

  /**
   * @method save
   * @description Persists an approval workflow (upsert + replace all levels).
   */
  async save(workflow: ApprovalWorkflow): Promise<Result<void, DomainError>> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Upsert the workflow
        await tx.approvalWorkflow.upsert({
          where: { id: workflow.id },
          create: {
            id: workflow.id,
            accountId: workflow.accountId,
            name: workflow.name,
            description: workflow.description ?? null,
            isDefault: workflow.isDefault,
            isActive: workflow.isActive,
          },
          update: {
            name: workflow.name,
            description: workflow.description ?? null,
            isDefault: workflow.isDefault,
            isActive: workflow.isActive,
          },
        });

        // Delete old levels and create new ones
        await tx.approvalWorkflowLevel.deleteMany({
          where: { workflowId: workflow.id },
        });

        const levels = workflow.levels;
        if (levels.length > 0) {
          await tx.approvalWorkflowLevel.createMany({
            data: levels.map((l) => ({
              id: l.id,
              workflowId: workflow.id,
              order: l.order,
              role: l.role ?? null,
              assigneeId: l.assigneeId ?? null,
              requireAll: l.requireAll,
            })),
          });
        }
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "ApprovalWorkflow",
          `save failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method delete
   * @description Deletes an approval workflow by its unique identifier.
   */
  async delete(id: string): Promise<Result<void, EntityNotFoundError>> {
    try {
      await this.prisma.approvalWorkflow.delete({ where: { id } });
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "ApprovalWorkflow",
          `${id} (delete failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method hasActiveRequests
   * @description Checks if a workflow has any PENDING approval requests.
   */
  async hasActiveRequests(workflowId: string): Promise<boolean> {
    const count = await this.prisma.approvalRequest.count({
      where: { workflowId, status: "PENDING" },
    });
    return count > 0;
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row (with levels) to an ApprovalWorkflow domain entity.
   */
  private toDomain(row: PrismaWorkflowRow): Result<ApprovalWorkflow, EntityNotFoundError> {
    const levels: WorkflowLevel[] = row.levels.map((l) => ({
      id: l.id,
      order: l.order,
      ...(l.role !== null && { role: l.role }),
      ...(l.assigneeId !== null && { assigneeId: l.assigneeId }),
      requireAll: l.requireAll,
    }));

    const result = ApprovalWorkflow.create({
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      ...(row.description !== null && { description: row.description }),
      levels,
      isDefault: row.isDefault,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });

    if (!result.ok) {
      return err(
        new EntityNotFoundError(
          "ApprovalWorkflow",
          `reconstitution failed: ${result.error.message}`
        )
      );
    }

    return ok(result.value);
  }
}
