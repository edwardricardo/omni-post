/**
 * @file HardDeleteProjectUseCase.ts
 * @description Orchestrates the IRREVERSIBLE removal of a project and every row that references
 *              it. Deliberately separate from the normal (soft) delete path so the destructive
 *              operation can only be reached by naming it — and only over a project that path
 *              already soft-deleted, by an admin or by the owning tenant itself.
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
 * Required caller context for a hard delete. A discriminated union so the
 * compiler forces every call site to declare its authorization surface: an
 * `admin` caller erases across accounts by design; a `customer` caller erases
 * only its own project and is gated against the subject's stored `accountId`.
 * Omitting the context is a compile error — no call site can obtain an ungated
 * erasure by forgetting a parameter.
 *
 * `reason` is mandatory on BOTH arms: it flows into the tombstone context and
 * the caller's audit record, and a destruction whose durable record cannot say
 * why is the outcome that record exists to prevent.
 */
export type HardDeleteProjectCaller =
  | {
      type: "admin";
      /**
       * Branded ({@link AdminActorId}) so a call site cannot pass a placeholder such
       * as `"unknown"`: the only way to obtain one is to validate a real principal.
       */
      adminUserId: AdminActorId;
      reason: string;
    }
  | {
      type: "customer";
      /**
       * Tenant the caller is authenticated for. Compared against the subject's
       * stored account before anything else can answer (CWE-639).
       */
      accountId: string;
      /**
       * The authenticated end-user performing the self-purge, recorded on the
       * tombstone as the principal that destroyed the data.
       *
       * Typed {@link AdminActorId} because that brand is the only principal the
       * repository's `HardDeleteContext.deletedBy` admits, and what the brand
       * actually encodes is "a validated, non-empty principal" — the property
       * that stops a `"unknown"` placeholder from standing in for a missing one.
       * The VALUE recorded here is the customer principal, so the tombstone
       * attributes the destruction truthfully; only the brand's NAME is narrower
       * than its meaning, and widening that name is a domain-type change this
       * use case cannot make on its own.
       */
      customerUserId: AdminActorId;
      reason: string;
      /**
       * The project's own name, as the caller believes it to be, compared for
       * EXACT equality against the stored row before anything is destroyed.
       *
       * MANDATORY on this arm, not optional, and that is the whole point: a
       * self-purge is the one irreversible path a tenant reaches without any
       * second party, and a project id in a URL carries no evidence that the
       * human meant THIS project rather than the one they had open a moment ago.
       * Typing the name back is that evidence. An optional field would let a
       * future call site obtain an unconfirmed erasure by simply not passing it —
       * the confirmation would be present in the code and absent in effect — so
       * the compiler requires it instead, exactly as it already requires
       * `reason` and `customerUserId` here.
       *
       * The admin arm deliberately has no counterpart: an admin erasing another
       * tenant's project has no reason to know its name, and demanding one would
       * only teach them to copy it out of the same screen that gave them the id,
       * which confirms nothing.
       */
      expectedName: string;
    };

/**
 * Input DTO for hard-deleting a project.
 */
export interface HardDeleteProjectInput {
  projectId: string;
  /** Required caller context — see {@link HardDeleteProjectCaller}. */
  caller: HardDeleteProjectCaller;
}

/**
 * Hard Delete Project Use Case
 *
 * Permanently removes a project and all of its data. This destroys rows; there
 * is no recovery.
 *
 * TWO DELIBERATE ACTS. An erasure is admissible ONLY over a project that is
 * ALREADY soft-deleted, whoever asks — the admin path included, with no
 * carve-out. A live project is refused with `CONFLICT`. The soft delete is the
 * first act and stays reversible (see `RestoreProjectUseCase`); this is the
 * second, and it is not. Without the interlock a single mistaken call destroys a
 * tenant's project with nothing in between, and the reversible path that exists
 * to catch exactly that mistake is simply skipped.
 *
 * The subject's state is read through the pair of finders rather than a field:
 * the `Project` entity carries no `deletedAt`, and `findById` is DEFINED to
 * exclude soft-deleted rows, so a hit from it means the row is live and a miss
 * (against a row `findByIdIncludingDeleted` can see) means it is soft-deleted.
 * The same pairing is what `RestoreProjectUseCase` reads for its own liveness
 * gate, in the opposite direction.
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
 * // The project must already be soft-deleted; a live one answers CONFLICT.
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
   * @description Validates the id and the caller, gates a customer caller against the subject's
   *              stored account and its typed name confirmation, refuses a project that is still
   *              LIVE (an erasure follows a soft delete, never replaces it), refuses a project too
   *              large to remove atomically, then irreversibly removes the project and its
   *              dependent rows inside a Serializable, tenant-bound transaction.
   * @param input - Project id plus the required caller context
   * @returns Ok on success; VALIDATION_FAILED on a malformed id, an empty reason, or a customer
   *          confirmation name that is not the project's exact stored name;
   *          NOT_FOUND when no row carries that id — and, for a customer caller, when the row
   *          belongs to another account, so the answer never reveals a foreign id exists;
   *          CONFLICT when the project is still live (a prior soft delete is required) or when a
   *          foreign-key interlock blocks the cascade;
   *          OPERATION_TOO_LARGE when the cascade exceeds the single-transaction ceiling;
   *          TRANSIENT_FAILURE on a timeout or write conflict
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
      // The subject is read through the including-deleted finder because the row
      // this operation acts on is, by contract, already soft-deleted — the
      // standard `findById` filters those out and could never see it.
      const subject = await this.projectRepository.findByIdIncludingDeleted(projectId);
      if (!subject.ok) {
        return err(
          new UseCaseError(`Project not found: ${input.projectId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }

      // Caller-context ownership gate (CWE-639), and the source of the tombstone
      // context: both are decided per arm, so a new caller kind cannot inherit
      // either by accident. The switch is exhaustive over HardDeleteProjectCaller;
      // the `never` default fails closed if a future variant skips this.
      const { caller } = input;
      let context: HardDeleteContext;
      switch (caller.type) {
        case "admin":
          // Cross-tenant erasure is this path's purpose, so no ownership gate —
          // explicit and auditable rather than absent by oversight.
          context = { deletedBy: caller.adminUserId, reason: caller.reason };
          break;
        case "customer": {
          if (subject.value.accountId.value !== caller.accountId) {
            // Mismatch and nonexistent are indistinguishable — NOT_FOUND, never
            // FORBIDDEN — so no signal reveals a foreign id exists (anti-enumeration).
            return err(
              new UseCaseError(`Project not found: ${input.projectId}`, USE_CASE_ERRORS.NOT_FOUND)
            );
          }
          // Typed confirmation, checked against the row the caller is about to
          // destroy. It sits INSIDE the ownership read because that read is the
          // only place the authoritative name exists, and strictly AFTER the
          // ownership gate: telling an outsider "that is not its name" would both
          // confirm the id exists and turn the endpoint into an oracle for
          // guessing another tenant's project names one request at a time.
          //
          // Compared verbatim. Trimming or case-folding would let the check pass
          // on a value the human did not actually read off the project, which is
          // the one thing it exists to establish — and `Project` already stores
          // its name trimmed, so a padded confirmation cannot have been copied
          // from the row.
          if (subject.value.name !== caller.expectedName) {
            return err(
              new UseCaseError(
                `Confirmation name does not match: project ${input.projectId} is not named ` +
                  `"${caller.expectedName}". Type the project's exact name to confirm an ` +
                  `irreversible erasure.`,
                USE_CASE_ERRORS.VALIDATION_FAILED
              )
            );
          }
          context = { deletedBy: caller.customerUserId, reason: caller.reason };
          break;
        }
        default: {
          // The `never` assignment is the real guard: adding a variant to
          // HardDeleteProjectCaller without handling it above is a COMPILE error.
          // The runtime arm only exists for a caller built outside the type
          // system, and it fails CLOSED — refusing the erasure rather than
          // falling through to it. It returns rather than throws, because a throw
          // crossing the application boundary is itself a canon violation
          // (CODING_STANDARDS: fallible operations return Result).
          const exhaustive: never = caller;
          return err(
            new UseCaseError(
              `Unhandled hard-delete caller type: ${JSON.stringify(exhaustive)}`,
              USE_CASE_ERRORS.FORBIDDEN
            )
          );
        }
      }

      // THE INTERLOCK: an erasure is admissible only over a row that is already
      // soft-deleted. `findById` is the probe because the port defines it as
      // excluding soft-deleted rows, so a hit means the subject is still live and
      // the reversible first act never happened.
      //
      // Ordered AFTER the ownership gate deliberately: answering "this project is
      // live" to a caller who does not own it would confirm the id exists, which
      // is exactly what the NOT_FOUND above refuses to reveal.
      const live = await this.projectRepository.findById(projectId);
      if (live.ok) {
        return err(
          new UseCaseError(
            `Cannot hard-delete project ${input.projectId}: it is still live. An irreversible ` +
              `erasure requires a prior soft delete — two deliberate acts, so no single call ` +
              `destroys a project that was never marked for deletion. Delete it first, then erase.`,
            USE_CASE_ERRORS.CONFLICT
          )
        );
      }

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
