/**
 * @file RestoreProjectUseCase.ts
 * @description Orchestrates the reversal of a project soft delete: validates the id, gates the
 *              caller against the soft-deleted row's stored ownership, then clears `deletedAt` via
 *              the repository inside the Unit of Work. The mirror of {@link DeleteProjectUseCase}.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ProjectId } from "@core/domain/index.js";
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
  { type: "customer"; accountId: string } | { type: "admin"; adminUserId: string };

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
 * Restore Project Use Case
 *
 * Reverses a soft delete by clearing `deletedAt`. The customer ownership gate is
 * read via `findByIdIncludingDeleted` — the standard `findById` filters
 * `deletedAt: null` and could never see the row being restored. Only a currently
 * soft-deleted project can be restored: the repository returns NOT_FOUND for an
 * absent (never existed / hard-deleted) or already-active row.
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
   * @description Validates the id, applies the caller ownership gate against the soft-deleted
   *              row, and clears `deletedAt` transactionally when a Unit of Work is available.
   * @param input - Project id plus the required caller context
   * @returns Ok on success; NOT_FOUND when the project is absent, already active, or not owned by
   *          the caller; VALIDATION_FAILED on a malformed id
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

    // Caller-context ownership gate (CWE-639). Runs BEFORE the mutation so a
    // foreign id never reaches the repository's restore. The switch is exhaustive
    // over RestoreProjectCaller; the `never` default fails closed if a future
    // variant is added without handling it here.
    const { caller } = input;
    switch (caller.type) {
      case "customer": {
        // MUST use the including-deleted finder: the project being restored is
        // soft-deleted, so `findById` (which filters deletedAt: null) would
        // report NOT_FOUND and no owner could ever restore their own project.
        const findResult = await this.projectRepository.findByIdIncludingDeleted(
          projectIdResult.value
        );
        if (!findResult.ok || findResult.value.accountId.value !== caller.accountId) {
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
      // Name-collision gate. `Project(accountId, name)` is unique only WHERE
      // `deletedAt IS NULL`, which is what stops a soft delete from confiscating
      // a name forever — but it also means two soft-deleted projects may legally
      // share one, and the moment a restore makes one of them live again the
      // partial index applies to it. Without this check the collision surfaces as
      // a raw P2002 from deep inside the adapter: an opaque 500 naming an index,
      // for a situation the operator can actually resolve by renaming.
      //
      // Deliberately NOT a full guarantee against a concurrent create: the
      // authoritative arbiter is the partial unique itself. This exists to turn
      // the ordinary case into an answerable error, not to replace the index.
      const restoring = await this.projectRepository.findByIdIncludingDeleted(
        projectIdResult.value
      );
      if (restoring.ok) {
        const holder = await this.projectRepository.findByName(
          restoring.value.accountId,
          restoring.value.name
        );
        if (holder !== null && holder.id.value !== input.projectId) {
          return err(
            new UseCaseError(
              `Cannot restore project ${input.projectId}: the name "${restoring.value.name}" ` +
                `is already used by active project ${holder.id.value}. Rename or archive that ` +
                `project, then restore this one.`,
              USE_CASE_ERRORS.CONFLICT
            )
          );
        }
      }

      const restoreResult = await this.projectRepository.restore(projectIdResult.value);
      if (!restoreResult.ok) {
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
      return err(
        new UseCaseError(
          "Failed to restore project",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
