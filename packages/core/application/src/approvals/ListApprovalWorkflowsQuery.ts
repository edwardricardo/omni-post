/**
 * @file ListApprovalWorkflowsQuery.ts
 * @description Application query for listing all approval workflows for an account.
 *   Returns DTOs, never domain objects (CQRS read side).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { ApprovalWorkflowRepository } from "@core/domain/repositories/ApprovalWorkflowRepository.js";

/**
 * Input DTO for listing workflows
 */
export interface ListApprovalWorkflowsInput {
  accountId: string;
}

/**
 * Workflow level DTO returned in query results
 */
export interface WorkflowLevelDTO {
  id: string;
  order: number;
  role?: string;
  assigneeId?: string;
  requireAll: boolean;
}

/**
 * Approval workflow DTO returned in query results
 */
export interface ApprovalWorkflowDTO {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  levels: WorkflowLevelDTO[];
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * @class ListApprovalWorkflowsQuery
 * @description Retrieves all approval workflows for an account as DTOs.
 */
export class ListApprovalWorkflowsQuery implements UseCase<
  ListApprovalWorkflowsInput,
  ApprovalWorkflowDTO[],
  UseCaseError
> {
  constructor(private readonly workflowRepo: ApprovalWorkflowRepository) {}

  /**
   * @method execute
   * @description Loads all workflows for an account and maps them to DTOs.
   * @param input - The query parameters
   * @returns Result<ApprovalWorkflowDTO[]> on success
   */
  async execute(
    input: ListApprovalWorkflowsInput
  ): Promise<Result<ApprovalWorkflowDTO[], UseCaseError>> {
    try {
      const workflows = await this.workflowRepo.findByAccountId(input.accountId);

      const dtos: ApprovalWorkflowDTO[] = workflows.map((w) => {
        const json = w.toJSON();
        const levels = json.levels as Array<Record<string, unknown>>;

        return {
          id: json.id as string,
          accountId: json.accountId as string,
          name: json.name as string,
          ...(json.description !== undefined && { description: json.description as string }),
          levels: levels.map((l) => ({
            id: l.id as string,
            order: l.order as number,
            ...(l.role !== undefined && { role: l.role as string }),
            ...(l.assigneeId !== undefined && { assigneeId: l.assigneeId as string }),
            requireAll: l.requireAll as boolean,
          })),
          isDefault: json.isDefault as boolean,
          isActive: json.isActive as boolean,
          createdAt: json.createdAt as string,
          updatedAt: json.updatedAt as string,
        };
      });

      return ok(dtos);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          `Failed to list approval workflows: ${error instanceof Error ? error.message : String(error)}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
  }
}
