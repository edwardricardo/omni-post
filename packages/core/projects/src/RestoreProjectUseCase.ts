/**
 * @file RestoreProjectUseCase.ts
 * @description Orchestrates the reversal of a project soft delete: validates the id, gates the
 *              caller against the soft-deleted row's stored ownership, refuses a row that is not
 *              actually deleted, reports a name already held by an active project as an actionable
 *              conflict, then clears `deletedAt` via the repository inside the Unit of Work.
 *              The mirror of {@link DeleteProjectUseCase}.
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
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for a project restore. A discriminated union so the
 * compiler forces every call site to declare its authorization surface: a
 * `customer` caller is gated against the project's stored `accountId`; an `admin`
 * caller (support recovering a mistaken deletion) skips the ownership gate
 * explicitly and auditably. Omitting the context is a compile error — no call
 * site can obtain an ungated restore by forgetting a parameter.
 */
export type RestoreProjectCaller =
  | { type: "customer"; accountId: string }
  | {
      type: "admin";
      /**
       * Branded ({@link AdminActorId}), matching the sibling hard-delete caller,
       * so a call site cannot pass a placeholder such as `"unknown"`: the only
       * way to obtain one is to validate a real principal. Restore is the
       * privileged reversal of a customer-visible deletion, so the acting admin
       * has to be a real, named principal for the route's audit record.
       */
      adminUserId: AdminActorId;
    };

/**
 * Input DTO for restoring a project.
 */
export interface RestoreProjectInput {
  projectId: string;
  /**
   * Required auth context. Customer callers are ownership-gated against the
   * project's stored account; admin callers skip the gate explicitly (see
   * {@link RestoreProjectCaller}).
   */
  caller: RestoreProjectCaller;
}

/**
 * Translates a persistence failure into the typed use-case error the route maps to a
 * status. Routing through `classifyPersistenceFailure` rather than flattening every
 * throw to `INTERNAL_ERROR` is what makes the residual restore race answerable: the
 * name pre-check below cannot close the window in which a live twin is born, so the
 * partial unique arbitrates and raises `P2002` — a conflict the caller can act on, not
 * a system fault to report as a 500.
 */
function toPersistenceFailure(projectId: string, error: unknown): UseCaseError {
  const code = classifyPersistenceFailure(error);
  const message =
    code === USE_CASE_ERRORS.CONFLICT
      ? `Cannot restore project ${projectId}: another active project claimed its name before ` +
        `the restore committed. Rename or archive that project, then restore this one.`
      : code === USE_CASE_ERRORS.TRANSIENT_FAILURE
        ? `Restore of project ${projectId} was aborted by the database (a write conflict or a ` +
          `transaction timeout). The project is unchanged; retrying is safe.`
        : "Failed to restore project";
  return new UseCaseError(message, code, error instanceof Error ? error : undefined);
}

/**
 * Restore Project Use Case
 *
 * Reverses a soft delete by clearing `deletedAt`. The customer ownership gate is
 * read via `findByIdIncludingDeleted` — the standard `findById` filters
 * `deletedAt: null` and could never see the row being restored.
 *
 * Only a currently soft-deleted project can be restored. The repository's
 * `restore` refuses anything else on its own, but the DECISION and its wording
 * live here: the adapter can only answer "not restorable", which would reach the
 * operator as "project not found" for a project they can plainly see. Reading the
 * two finders as a pair recovers the distinction the domain entity cannot carry —
 * it has no `deletedAt` field — because `findById` is defined to hide soft-deleted
 * rows, so a hit from it means the subject is live and there is nothing to undo.
 *
 * @example
 * const useCase = new RestoreProjectUseCase(projectRepository, unitOfWork);
 * const result = await useCase.execute({
 *   projectId: 'project-123',
 *   caller: { type: 'customer', accountId: 'account-abc' },
 * });
 */
export class RestoreProjectUseCase implements CommandUseCase<RestoreProjectInput, UseCaseError> {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates the id, applies the caller ownership gate against the soft-deleted row,
   *              refuses a live row and a name already taken, then clears `deletedAt`
   *              transactionally when a Unit of Work is available.
   * @param input - Project id plus the required caller context
   * @returns Ok on success; VALIDATION_FAILED on a malformed id; NOT_FOUND when no row carries the
   *          id or the caller does not own it; CONFLICT when the project is not deleted or its name
   *          is held by an active project; TRANSIENT_FAILURE when the database aborts the write
   */
  async execute(input: RestoreProjectInput): Promise<Result<void, UseCaseError>> {
    const projectIdResult = ProjectId.fromString(input.projectId);
    if (!projectIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid project ID: ${input.projectId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }
    const projectId = projectIdResult.value;

    // MUST be the including-deleted finder: the subject of a restore is by
    // definition soft-deleted, so `findById` (which filters `deletedAt: null`)
    // would report NOT_FOUND and no owner could ever restore their own project.
    const subject = await this.projectRepository.findByIdIncludingDeleted(projectId);
    if (!subject.ok) {
      return err(
        new UseCaseError(`Project not found: ${input.projectId}`, USE_CASE_ERRORS.NOT_FOUND)
      );
    }

    // Caller-context ownership gate (CWE-639). Runs BEFORE the mutation so a
    // foreign id never reaches the repository's restore. The switch is exhaustive
    // over RestoreProjectCaller; the `never` default fails closed if a future
    // variant is added without handling it here.
    const { caller } = input;
    switch (caller.type) {
      case "customer": {
        if (subject.value.accountId.value !== caller.accountId) {
          // Mismatch and nonexistent are indistinguishable — NOT_FOUND, never
          // FORBIDDEN — so no signal reveals a foreign id exists (anti-enumeration).
          return err(
            new UseCaseError(`Project not found: ${input.projectId}`, USE_CASE_ERRORS.NOT_FOUND)
          );
        }
        break;
      }
      case "admin":
        // Explicit, auditable bypass of the ownership gate for admin recovery.
        break;
      default: {
        // The `never` assignment is the real guard: adding a variant to
        // RestoreProjectCaller without handling it above is a COMPILE error. The
        // runtime arm only exists for a caller built outside the type system, and
        // it fails CLOSED — refusing the restore. It returns rather than throws,
        // because a throw crossing the application boundary is itself a canon
        // violation (CODING_STANDARDS: fallible operations return Result).
        const exhaustive: never = caller;
        return err(
          new UseCaseError(
            `Unhandled restore caller type: ${JSON.stringify(exhaustive)}`,
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }
    }

    const doRestore = async (): Promise<Result<void, UseCaseError>> => {
      // Liveness gate. Ordered AFTER the ownership gate deliberately: answering
      // "this project is live" to a caller who does not own it would confirm the
      // id exists, which is exactly what the NOT_FOUND above refuses to reveal.
      //
      // `findById` is the probe because the port defines it as excluding
      // soft-deleted rows, so a hit means the subject is live. The repository's
      // `restore` also refuses a live row, but only as NOT_FOUND — which would
      // tell an owner their visible project does not exist. The decision is owned
      // here so the answer can say what actually happened.
      const live = await this.projectRepository.findById(projectId);
      if (live.ok) {
        return err(
          new UseCaseError(
            `Cannot restore project ${input.projectId}: it is not deleted, so there is ` +
              `nothing to restore.`,
            USE_CASE_ERRORS.CONFLICT
          )
        );
      }

      // Name-collision gate. `Project(accountId, name)` is unique only WHERE
      // `deletedAt IS NULL`, which is what stops a soft delete from confiscating
      // a name forever — but it also means two soft-deleted projects may legally
      // share one, and the moment a restore makes one of them live again the
      // partial index applies to it. Without this check the collision surfaces as
      // a raw P2002 from deep inside the adapter, naming an index instead of the
      // project the operator can actually rename.
      //
      // The lookup uses the SUBJECT's account, not the caller's: an admin
      // restoring another tenant's project must be told about that tenant's
      // colliding name, not about one in their own account.
      //
      // Deliberately NOT a full guarantee against a concurrent create: the
      // authoritative arbiter is the partial unique itself, and its P2002 is
      // classified as a conflict by the catch below. This exists to turn the
      // ordinary case into an answerable error, not to replace the index.
      const holder = await this.projectRepository.findByName(
        subject.value.accountId,
        subject.value.name
      );
      if (holder !== null && holder.id.value !== input.projectId) {
        return err(
          new UseCaseError(
            `Cannot restore project ${input.projectId}: the name "${subject.value.name}" is ` +
              `already used by active project ${holder.id.value}. Rename or archive that ` +
              `project, then restore this one.`,
            USE_CASE_ERRORS.CONFLICT
          )
        );
      }

      const restoreResult = await this.projectRepository.restore(projectId);
      if (!restoreResult.ok) {
        // The row stopped being restorable between the checks above and the
        // write (someone else restored or hard-deleted it). The repository
        // cannot tell those apart by design, so neither does this.
        return err(
          new UseCaseError(
            `Project not found: ${input.projectId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            restoreResult.error
          )
        );
      }
      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doRestore();
        });
        return result;
      }
      return await doRestore();
    } catch (error: unknown) {
      return err(toPersistenceFailure(input.projectId, error));
    }
  }
}
