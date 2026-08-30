/**
 * @file DeleteProjectUseCase.ts
 * @description Orchestrates the NORMAL (reversible) deletion of a project: validates the id,
 *              gates the caller against stored ownership, then soft-deletes via the repository
 *              inside the Unit of Work. Child data (posts, channels) is left intact.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type CommandUseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ProjectId } from "@core/domain/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Required caller context for a project delete (CWE-639 gate). A discriminated
 * union so the compiler forces every call site to declare its authorization
 * surface: a `customer` caller is gated against the project's stored
 * `accountId`; a `system` caller (retention jobs, account teardown) skips the
 * gate explicitly and auditably. Omitting the context is a compile error — no
 * call site can obtain an ungated delete by forgetting a parameter.
 */
export type DeleteProjectCaller =
  { type: "customer"; accountId: string } | { type: "system"; source: string };

/**
 * Input DTO for deleting a project.
 */
export interface DeleteProjectInput {
  projectId: string;
  /**
   * Required auth context. Customer callers are ownership-gated against the
   * project's stored account; system callers skip the gate explicitly (see
   * {@link DeleteProjectCaller}).
   */
  caller: DeleteProjectCaller;
}

/**
 * Delete Project Use Case
 *
 * Soft-deletes a project (sets `deletedAt`). This is the NORMAL deletion path:
 * the row survives, standard reads stop returning it, and the child posts and
 * channels are preserved for audit. Irreversible removal is a separate,
 * admin-only use case — see `HardDeleteProjectUseCase`.
 *
 * @example
 * const useCase = new DeleteProjectUseCase(projectRepository, unitOfWork);
 * const result = await useCase.execute({
 *   projectId: 'project-123',
 *   caller: { type: 'customer', accountId: 'account-abc' },
 * });
 */
export class DeleteProjectUseCase implements CommandUseCase<DeleteProjectInput, UseCaseError> {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates the id, applies the caller ownership gate, and soft-deletes the
   *              project transactionally when a Unit of Work is available.
   * @param input - Project id plus the required caller context
   * @returns Ok on success; NOT_FOUND when the project is absent or not owned by the caller
   */
  async execute(input: DeleteProjectInput): Promise<Result<void, UseCaseError>> {
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
    // foreign id never reaches the repository. The switch is exhaustive over
    // DeleteProjectCaller; the `never` default fails closed if a future variant
    // is added without handling it here.
    const { caller } = input;
    switch (caller.type) {
      case "customer": {
        const findResult = await this.projectRepository.findById(projectIdResult.value);
        if (!findResult.ok || findResult.value.accountId.value !== caller.accountId) {
          // Mismatch and nonexistent are indistinguishable — NOT_FOUND, never
          // FORBIDDEN — so no signal reveals a foreign id exists (anti-enumeration).
          return err(
            new UseCaseError(`Project not found: ${input.projectId}`, USE_CASE_ERRORS.NOT_FOUND)
          );
        }
        break;
      }
      case "system":
        // Explicit, auditable bypass of the ownership gate for internal callers.
        break;
      default: {
        // The `never` assignment is the real guard: adding a variant to
        // DeleteProjectCaller without handling it above is a COMPILE error.
        // The runtime arm only exists for a caller built outside the type
        // system, and it fails CLOSED — refusing the delete rather than
        // falling through to it. It returns rather than throws, because a
        // throw crossing the application boundary is itself a canon violation
        // (CODING_STANDARDS: fallible operations return Result).
        const exhaustive: never = caller;
        return err(
          new UseCaseError(
            `Unhandled delete caller type: ${JSON.stringify(exhaustive)}`,
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }
    }

    const doDelete = async (): Promise<Result<void, UseCaseError>> => {
      const deleteResult = await this.projectRepository.delete(projectIdResult.value);
      if (!deleteResult.ok) {
        return err(
          new UseCaseError(
            `Project not found: ${input.projectId}`,
            USE_CASE_ERRORS.NOT_FOUND,
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
          result = await doDelete();
        });
        return result;
      }
      return await doDelete();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to delete project",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
