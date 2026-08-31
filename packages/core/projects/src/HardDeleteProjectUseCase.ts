/**
 * @file HardDeleteProjectUseCase.ts
 * @description Orchestrates the IRREVERSIBLE removal of a project and every row that references
 *              it. Deliberately separate from the normal (soft) delete path so the destructive
 *              operation can only be reached by naming it, and only by an admin caller.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import {
  type CommandUseCase,
  UseCaseError,
  USE_CASE_ERRORS,
  classifyPersistenceFailure,
} from "@core/application/UseCase.js";
import { ProjectId, type AdminActorId } from "@core/domain/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { HardDeleteContext, UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Upper bound on the cascade a single hard-delete transaction will attempt,
 * measured in posts (the dominant per-row cascade cost). Sized to complete
 * comfortably within the dedicated hard-delete transaction budget; a project
 * above it is refused with an actionable error rather than left to time out
 * — and time out forever — inside the transaction. A guardrail, tunable.
 */
export const HARD_DELETE_MAX_POSTS = 50_000;

/**
 * Required caller context for a hard delete. Single-variant on purpose: unlike
 * {@link import("./DeleteProjectUseCase.js").DeleteProjectCaller}, there is no
 * `customer` variant, so a customer-facing call site cannot construct a valid
 * input for this use case at all. The gate is the type, not a runtime check
 * someone can forget. `reason` is mandatory and flows into the tombstone context
 * and the caller's audit record.
 */
export interface HardDeleteProjectCaller {
  type: "admin";
  /**
   * Branded ({@link AdminActorId}) so a call site cannot pass a placeholder such
   * as `"unknown"`: the only way to obtain one is to validate a real principal.
   */
  adminUserId: AdminActorId;
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
 * This use case OPENS the transaction (via the injected Unit of Work) rather
 * than leaving the adapter to open its own. That is load-bearing, not
 * ceremony: the dedicated hard-delete Unit of Work runs at Serializable
 * isolation and, under the route's `withSystemContext`, binds the
 * `app.account_id` RLS GUC for the whole transaction. Without it the adapter's
 * standalone transaction would leave the GUC unbound, so the day RLS is
 * enforced the tombstone write and the cascade would be gated by the tenant
 * policy. The adapter's `hardDelete` JOINS this transaction rather than nesting.
 *
 * @example
 * const useCase = new HardDeleteProjectUseCase(projectRepository, unitOfWork);
 * const result = await useCase.execute({
 *   projectId: 'project-123',
 *   caller: { type: 'admin', adminUserId, reason: 'GDPR erasure request' },
 * });
 */
export class HardDeleteProjectUseCase implements CommandUseCase<
  HardDeleteProjectInput,
  UseCaseError
> {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly unitOfWork: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates the id and the admin caller, refuses a project too large to remove
   *              atomically, then irreversibly removes the project and its dependent rows inside
   *              a Serializable, tenant-bound transaction.
   * @param input - Project id plus the required admin caller context
   * @returns Ok on success; VALIDATION_FAILED on a malformed id or empty reason;
   *          OPERATION_TOO_LARGE when the cascade exceeds the single-transaction ceiling;
   *          NOT_FOUND when no project (including a soft-deleted one) carries that id;
   *          CONFLICT on a foreign-key interlock; TRANSIENT_FAILURE on a timeout or write conflict
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

    const projectId = projectIdResult.value;

    try {
      // Pre-flight size guard, BEFORE opening the transaction: a project whose
      // cascade is too large to finish inside the transaction budget is refused
      // with an actionable error, not left to time out with the clock running.
      const impact = await this.projectRepository.countHardDeleteImpact(projectId);
      if (impact > HARD_DELETE_MAX_POSTS) {
        return err(
          new UseCaseError(
            `Hard delete refused: this project owns ${impact} posts, above the ` +
              `${HARD_DELETE_MAX_POSTS} ceiling for a single transaction. Reduce the project ` +
              `(delete posts first) before erasing it.`,
            USE_CASE_ERRORS.OPERATION_TOO_LARGE
          )
        );
      }

      const context: HardDeleteContext = {
        deletedBy: input.caller.adminUserId,
        reason: input.caller.reason,
      };

      // The transaction is opened HERE so its Serializable isolation and its
      // RLS-GUC binding cover the adapter's tombstone-then-delete cascade, which
      // joins this transaction rather than opening its own. The adapter's Result
      // is returned out of the transaction so its error is inspected here.
      const hardDeleteResult = await this.unitOfWork.executeInTransaction(() =>
        this.projectRepository.hardDelete(projectId, context)
      );

      if (!hardDeleteResult.ok) {
        return err(
          new UseCaseError(
            `Project not found: ${input.projectId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            hardDeleteResult.error
          )
        );
      }
      return ok(undefined);
    } catch (error: unknown) {
      const code = classifyPersistenceFailure(error);
      const message =
        code === USE_CASE_ERRORS.CONFLICT
          ? "Cannot hard-delete project: a protected relationship still references it"
          : code === USE_CASE_ERRORS.TRANSIENT_FAILURE
            ? "Hard-delete of project failed due to a transient database conflict or timeout; retry"
            : "Failed to hard-delete project";
      return err(new UseCaseError(message, code, error instanceof Error ? error : undefined));
    }
  }
}
