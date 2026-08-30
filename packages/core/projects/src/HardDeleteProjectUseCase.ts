/**
 * @file HardDeleteProjectUseCase.ts
 * @description Orchestrates the IRREVERSIBLE removal of a project and every row that references
 *              it. Deliberately separate from the normal (soft) delete path so the destructive
 *              operation can only be reached by naming it, and only by an admin caller.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ProjectId } from "@core/domain/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";

/**
 * Required caller context for a hard delete. Single-variant on purpose: unlike
 * {@link import("./DeleteProjectUseCase.js").DeleteProjectCaller}, there is no
 * `customer` variant, so a customer-facing call site cannot construct a valid
 * input for this use case at all. The gate is the type, not a runtime check
 * someone can forget. `reason` is mandatory and flows into the caller's audit
 * record.
 */
export interface HardDeleteProjectCaller {
  type: "admin";
  adminUserId: string;
  reason: string;
}

/**
 * Input DTO for hard-deleting a project.
 */
export interface HardDeleteProjectInput {
  projectId: string;
  /** Required admin caller context — see {@link HardDeleteProjectCaller}. */
  caller: HardDeleteProjectCaller;
}

/**
 * Hard Delete Project Use Case
 *
 * Permanently removes a project and all of its data. This destroys rows; there
 * is no recovery. The normal deletion path is `DeleteProjectUseCase` (soft).
 *
 * Atomicity is the repository adapter's responsibility: `hardDelete` writes the
 * project's tombstone and destroys the rows inside a single transaction, so a
 * mid-way failure leaves the project fully intact instead of half-destroyed —
 * and no destruction can commit without its durable record.
 *
 * The acting admin travels to the adapter in the `HardDeleteContext`, because
 * the tombstone is written where the transaction is and nothing the delete
 * leaves behind could name the principal afterwards.
 *
 * NOTE: this use case does NOT open a Unit of Work of its own. The adapter's
 * `hardDelete` is already transactional and UoW-aware; wrapping it in a second,
 * outer interactive transaction would only widen the lock window without adding
 * atomicity.
 *
 * @example
 * const useCase = new HardDeleteProjectUseCase(projectRepository);
 * const result = await useCase.execute({
 *   projectId: 'project-123',
 *   caller: { type: 'admin', adminUserId: 'admin-1', reason: 'GDPR erasure request' },
 * });
 */
export class HardDeleteProjectUseCase implements CommandUseCase<
  HardDeleteProjectInput,
  UseCaseError
> {
  constructor(private readonly projectRepository: ProjectRepositoryPort) {}

  /**
   * @method execute
   * @description Validates the id and the admin caller, then irreversibly removes the project
   *              and its dependent rows through the repository's transactional cascade.
   * @param input - Project id plus the required admin caller context
   * @returns Ok on success; VALIDATION_FAILED on a malformed id or empty reason; NOT_FOUND when
   *          no project (including a soft-deleted one) carries that id
   */
  async execute(input: HardDeleteProjectInput): Promise<Result<void, UseCaseError>> {
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project ID: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // A blank reason defeats the audit trail this operation exists to leave
    // behind, so it is rejected rather than recorded as an empty string.
    if (input.caller.reason.trim().length === 0) {
      return err(
        new UseCaseError(
          "A non-empty reason is required to hard-delete a project",
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    try {
      const result = await this.projectRepository.hardDelete(projectIdResult.value, {
        deletedBy: input.caller.adminUserId,
      });
      if (!result.ok) {
        return err(
          new UseCaseError(
            `Project not found: ${input.projectId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            result.error
          )
        );
      }
      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to hard-delete project",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
