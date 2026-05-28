/**
 * @file DeleteApprovalWorkflowUseCase.ts
 * @description Application use case for deleting an approval workflow.
 *   Guards against deletion when active (PENDING) requests use the workflow.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { ApprovalWorkflowRepository } from "@core/domain/repositories/ApprovalWorkflowRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for deleting an approval workflow
 */
export interface DeleteApprovalWorkflowCommand {
  workflowId: string;
  accountId: string;
}

/**
 * @class DeleteApprovalWorkflowUseCase
 * @description Deletes an approval workflow after verifying ownership
 *   and that no PENDING approval requests reference it.
 */
export class DeleteApprovalWorkflowUseCase implements UseCase<
  DeleteApprovalWorkflowCommand,
  void,
  UseCaseError
> {
  constructor(
    private readonly workflowRepo: ApprovalWorkflowRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates ownership, checks for active requests, and deletes.
   * @param command - The deletion parameters
   * @returns Result<void> on success
   */
  async execute(command: DeleteApprovalWorkflowCommand): Promise<Result<void, UseCaseError>> {
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

    // Guard: no active (PENDING) approval requests using this workflow
    const hasActive = await this.workflowRepo.hasActiveRequests(command.workflowId);
    if (hasActive) {
      return err(
        new UseCaseError(
          "Cannot delete workflow with active (PENDING) approval requests",
          USE_CASE_ERRORS.CONFLICT
        )
      );
    }

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const deleteResult = await this.workflowRepo.delete(command.workflowId);
      if (!deleteResult.ok) {
        return err(
          new UseCaseError(
            "Failed to delete approval workflow",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            deleteResult.error
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
          "Failed to delete approval workflow",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
