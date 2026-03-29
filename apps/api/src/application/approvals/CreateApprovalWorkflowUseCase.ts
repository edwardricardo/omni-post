/**
 * @file CreateApprovalWorkflowUseCase.ts
 * @description Application use case for creating a multi-level approval workflow.
 *   Validates uniqueness of name per account and handles default workflow logic.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalWorkflowRepository } from "../../domain/repositories/ApprovalWorkflowRepository.js";
import {
  ApprovalWorkflow,
  type WorkflowLevelInput,
} from "../../domain/entities/ApprovalWorkflow.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { randomUUID } from "crypto";

/**
 * Input DTO for creating an approval workflow
 */
export interface CreateApprovalWorkflowCommand {
  accountId: string;
  name: string;
  description?: string;
  levels: WorkflowLevelInput[];
  isDefault?: boolean;
}

/**
 * Output DTO after successful creation
 */
export interface CreateApprovalWorkflowResult {
  workflowId: string;
}

/**
 * @class CreateApprovalWorkflowUseCase
 * @description Creates a new multi-level approval workflow for an account.
 *   If isDefault is true, unsets the previous default for the account.
 */
export class CreateApprovalWorkflowUseCase implements UseCase<
  CreateApprovalWorkflowCommand,
  CreateApprovalWorkflowResult,
  UseCaseError
> {
  constructor(
    private readonly workflowRepo: ApprovalWorkflowRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input, checks for duplicate names, creates the workflow.
   * @param command - The creation parameters
   * @returns Result<CreateApprovalWorkflowResult> with the new workflow ID on success
   */
  async execute(
    command: CreateApprovalWorkflowCommand
  ): Promise<Result<CreateApprovalWorkflowResult, UseCaseError>> {
    // Check for duplicate name within account
    const existingWorkflows = await this.workflowRepo.findByAccountId(command.accountId);
    const duplicateName = existingWorkflows.find(
      (w) => w.name.toLowerCase() === command.name.trim().toLowerCase()
    );

    if (duplicateName) {
      return err(
        new UseCaseError(
          `A workflow with name "${command.name}" already exists for this account`,
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }

    // Build workflow levels with generated IDs
    const levels = command.levels.map((l) => ({
      id: randomUUID(),
      order: l.order,
      ...(l.role !== undefined && { role: l.role }),
      ...(l.assigneeId !== undefined && { assigneeId: l.assigneeId }),
      requireAll: l.requireAll ?? false,
    }));

    const workflowId = randomUUID();

    // Create domain entity
    const createResult = ApprovalWorkflow.create({
      id: workflowId,
      accountId: command.accountId,
      name: command.name,
      ...(command.description !== undefined && { description: command.description }),
      levels,
      isDefault: command.isDefault ?? false,
    });

    if (!createResult.ok) {
      return err(
        new UseCaseError(
          createResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          createResult.error
        )
      );
    }

    const workflow = createResult.value;

    const doWork = async (): Promise<Result<CreateApprovalWorkflowResult, UseCaseError>> => {
      // If setting as default, unset previous default
      if (workflow.isDefault) {
        const currentDefault = await this.workflowRepo.findDefaultByAccountId(command.accountId);
        if (currentDefault) {
          // Save the old default with isDefault=false
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
            const saveOldResult = await this.workflowRepo.save(updatedResult.value);
            if (!saveOldResult.ok) {
              return err(
                new UseCaseError(
                  "Failed to unset previous default workflow",
                  USE_CASE_ERRORS.INTERNAL_ERROR,
                  saveOldResult.error
                )
              );
            }
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

      return ok({ workflowId: workflow.id });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateApprovalWorkflowResult, UseCaseError> = ok({
          workflowId: workflow.id,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to create approval workflow",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
