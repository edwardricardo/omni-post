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
import {
  HARD_DELETE_MAX_CASCADE_ROWS,
  HARD_DELETE_MAX_POSTS,
} from "@core/application/hardDeletePolicy.js";
import {
  WRITE_CONFLICT_MAX_ATTEMPTS,
  type WriteConflictRetryOptions,
  retryOnWriteConflict,
} from "@core/application/retryOnWriteConflict.js";
import { ProjectId, type AdminActorId } from "@core/domain/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { HardDeleteContext, UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for a hard delete. Single-variant on purpose: there is
 * no `customer` variant, so a customer-facing call site cannot construct a valid
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
 * is no recovery.
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
/**
 * Translates a persistence failure into the typed use-case error the route maps to a
 * status. It lives here, called from BOTH the retry's exhausted branch and the outer
 * catch, because those two paths answer for the same failure and a second copy of this
 * mapping is a second chance for them to disagree.
 */
function toPersistenceFailure(error: unknown): UseCaseError {
  const code = classifyPersistenceFailure(error);
  const message =
    code === USE_CASE_ERRORS.CONFLICT
      ? "Cannot hard-delete project: a protected relationship still references it"
      : code === USE_CASE_ERRORS.TRANSIENT_FAILURE
        ? `Hard-delete of project failed after ${WRITE_CONFLICT_MAX_ATTEMPTS} attempts ` +
          `because the database kept aborting it (a write conflict or a transaction ` +
          `timeout). A write conflict means the project is still taking writes: retrying ` +
          `will keep losing until it is quiesced — soft-delete it first, then erase.`
        : "Failed to hard-delete project";
  return new UseCaseError(message, code, error instanceof Error ? error : undefined);
}

export class HardDeleteProjectUseCase implements CommandUseCase<
  HardDeleteProjectInput,
  UseCaseError
> {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly unitOfWork: UnitOfWork,
    /**
     * Backoff/attempt seams for the write-conflict retry. Production leaves it
     * undefined and takes the policy defaults; a test injects a no-op sleep so the
     * retry SCHEDULE is exercised without spending its wall-clock in the suite.
     */
    private readonly retryOptions?: WriteConflictRetryOptions
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
      // TWO bounds, because the transaction budget is spent on two dimensions that
      // fail independently. Posts alone let a project with few posts and a huge child
      // population through — and that project then cannot finish inside the budget,
      // which is the failure the posts-only guard was blind to.
      if (impact.posts > HARD_DELETE_MAX_POSTS) {
        return err(
          new UseCaseError(
            `Hard delete refused: this project owns ${impact.posts} posts, above the ` +
              `${HARD_DELETE_MAX_POSTS} ceiling for a single transaction. Reduce the project ` +
              `(delete posts first) before erasing it.`,
            USE_CASE_ERRORS.OPERATION_TOO_LARGE
          )
        );
      }
      if (impact.childRows > HARD_DELETE_MAX_CASCADE_ROWS) {
        return err(
          new UseCaseError(
            `Hard delete refused: this project's cascade would touch ${impact.childRows} ` +
              `dependent rows (tasks and webhook events), above the ` +
              `${HARD_DELETE_MAX_CASCADE_ROWS} ceiling for a single transaction — the cost is ` +
              `posts MULTIPLIED BY the rows that reference them, not posts alone. Reduce the ` +
              `project (prune webhook events and tasks first) before erasing it.`,
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
      //
      // Wrapped in a bounded retry because Serializable is what makes the tombstone
      // snapshot trustworthy, and the price of that is aborting when a concurrent
      // writer touches the project mid-transaction. Without a retry the only
      // convergent path left to the operator is re-running a minutes-long cascade
      // by hand. Only a write conflict is retried; a timeout or an interlock is not
      // (see `isRetryableWriteConflict`). The retry does NOT make an erasure
      // converge against a project under continuous write load — the exhausted
      // error below says exactly that.
      const attempt = await retryOnWriteConflict(
        () =>
          this.unitOfWork.executeInTransaction(() =>
            this.projectRepository.hardDelete(projectId, context)
          ),
        this.retryOptions
      );
      if (!attempt.ok) {
        return err(toPersistenceFailure(attempt.error));
      }
      const hardDeleteResult = attempt.value;

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
      return err(toPersistenceFailure(error));
    }
  }
}
