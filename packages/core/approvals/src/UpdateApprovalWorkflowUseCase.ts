/**
 * @file UpdateApprovalWorkflowUseCase.ts
 * @description Application use case for updating an existing approval workflow.
 *   Validates ownership, replaces levels if provided.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { ApprovalWorkflowRepository } from "@core/domain/repositories/ApprovalWorkflowRepository.js";
import {
  ApprovalWorkflow,
  type WorkflowLevelInput,
} from "@core/domain/entities/ApprovalWorkflow.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { randomUUID } from "crypto";

/**
 * Input DTO for updating an approval workflow
 */
export interface UpdateApprovalWorkflowCommand {
  workflowId: string;
  accountId: string;
  name?: string;
  description?: string;
  levels?: WorkflowLevelInput[];
  isDefault?: boolean;
  isActive?: boolean;
}

/**
 * @class UpdateApprovalWorkflowUseCase
 * @description Updates an existing approval workflow. Replaces levels if provided.
 */
export class UpdateApprovalWorkflowUseCase implements UseCase<
  UpdateApprovalWorkflowCommand,
  void,
  UseCaseError
> {
  constructor(
    private readonly workflowRepo: ApprovalWorkflowRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Loads the workflow, validates ownership, applies updates.
   * @param command - The update parameters
   * @returns Result<void> on success
   */
  async execute(command: UpdateApprovalWorkflowCommand): Promise<Result<void, UseCaseError>> {
    // Load existing workflow
    const findResult = await this.workflowRepo.findById(command.workflowId);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Approval workflow not found: ${command.workflowId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const existing = findResult.value;

    // Guard: belongs to accountId
    if (existing.accountId !== command.accountId) {
      return err(
        new UseCaseError("Workflow does not belong to this account", USE_CASE_ERRORS.FORBIDDEN)
      );
    }

    // Build updated levels
    const newLevels = command.levels
      ? command.levels.map((l) => ({
          id: randomUUID(),
          order: l.order,
          ...(l.role !== undefined && { role: l.role }),
          ...(l.assigneeId !== undefined && { assigneeId: l.assigneeId }),
          requireAll: l.requireAll ?? false,
        }))
      : [...existing.levels];

    // Recreate with updated fields
    const updateResult = ApprovalWorkflow.create({
      id: existing.id,
      accountId: existing.accountId,
      name: command.name ?? existing.name,
      ...(command.description !== undefined
        ? { description: command.description }
        : existing.description !== undefined
          ? { description: existing.description }
          : {}),
      levels: newLevels,
      isDefault: command.isDefault ?? existing.isDefault,
      isActive: command.isActive ?? existing.isActive,
      createdAt: existing.createdAt,
    });

    if (!updateResult.ok) {
      return err(
        new UseCaseError(
          updateResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          updateResult.error
        )
      );
    }

    const workflow = updateResult.value;

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      // If setting as default, unset previous default
      if (workflow.isDefault && !existing.isDefault) {
        const currentDefault = await this.workflowRepo.findDefaultByAccountId(command.accountId);
        if (currentDefault && currentDefault.id !== workflow.id) {
          const updatedResult = ApprovalWorkflow.create({
            id: currentDefault.id,
            accountId: currentDefault.accountId,
            name: currentDefault.name,
            ...(currentDefault.description !== undefined && {
              description: currentDefault.description,
            }),
            levels: [...currentDefault.levels],
            isDefault: false,
            isActive: currentDefault.isActive,
            createdAt: currentDefault.createdAt,
            updatedAt: currentDefault.updatedAt,
          });

          if (updatedResult.ok) {
            await this.workflowRepo.save(updatedResult.value);
          }
        }
      }

      const saveResult = await this.workflowRepo.save(workflow);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save approval workflow",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to update approval workflow",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
