/**
 * @file ApprovalWorkflowRepository.ts
 * @description Port interface for ApprovalWorkflow entity persistence.
 *   Defines the contract that infrastructure adapters must fulfill
 *   for multi-level approval workflow management.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { ApprovalWorkflow } from "../entities/ApprovalWorkflow.js";
import type { DomainError, EntityNotFoundError } from "../errors/index.js";

/**
 * @interface ApprovalWorkflowRepository
 * @description Repository port for ApprovalWorkflow entity persistence.
 *   Returns domain objects, never raw Prisma types.
 */
export interface ApprovalWorkflowRepository {
  /**
   * @method findById
   * @description Finds an approval workflow by its unique identifier, including levels.
   * @param id - The workflow ID string
   * @returns Result containing the workflow on success, EntityNotFoundError if not found
   */
  findById(id: string): Promise<Result<ApprovalWorkflow, EntityNotFoundError>>;

  /**
   * @method findByAccountId
   * @description Retrieves all approval workflows for a given account.
   * @param accountId - The account ID to search by
   * @returns Array of matching ApprovalWorkflow instances
   */
  findByAccountId(accountId: string): Promise<ApprovalWorkflow[]>;

  /**
   * @method findDefaultByAccountId
   * @description Retrieves the default approval workflow for a given account.
   * @param accountId - The account ID to search by
   * @returns The default workflow or null if none is set as default
   */
  findDefaultByAccountId(accountId: string): Promise<ApprovalWorkflow | null>;

  /**
   * @method save
   * @description Persists an approval workflow (create or update via upsert).
   *   Replaces all levels on save.
   * @param workflow - The ApprovalWorkflow to save
   * @returns Result<void> on success, DomainError on failure
   */
  save(workflow: ApprovalWorkflow): Promise<Result<void, DomainError>>;

  /**
   * @method delete
   * @description Deletes an approval workflow by its unique identifier.
   * @param id - The workflow ID string
   * @returns Result<void> on success, EntityNotFoundError if not found
   */
  delete(id: string): Promise<Result<void, EntityNotFoundError>>;

  /**
   * @method hasActiveRequests
   * @description Checks if a workflow has any PENDING approval requests.
   * @param workflowId - The workflow ID string
   * @returns true if there are active (PENDING) requests using this workflow
   */
  hasActiveRequests(workflowId: string): Promise<boolean>;
}
