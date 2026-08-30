/**
 * @file DeleteProjectUseCase.test.ts
 * @description Unit tests for DeleteProjectUseCase — proves the delete is SOFT (the repository's
 *   reversible `delete`, never `hardDelete`), that the customer caller is ownership-gated with a
 *   NOT_FOUND that cannot be told apart from a missing project, and that the write happens inside
 *   the Unit of Work.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { DeleteProjectUseCase } from "../../src/DeleteProjectUseCase.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440101";
const OWNER_ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440201";
const OTHER_ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440202";

function makeRepo(
  overrides: Partial<{ ownerAccountId: string | null }> = {}
): ProjectRepositoryPort & {
  delete: ReturnType<typeof vi.fn>;
  hardDelete: ReturnType<typeof vi.fn>;
} {
  const { ownerAccountId = OWNER_ACCOUNT_ID } = overrides;

  const repo = {
    findById: vi.fn(async () =>
      ownerAccountId === null
        ? err(new EntityNotFoundError("Project", PROJECT_ID))
        : ok({ accountId: { value: ownerAccountId } })
    ),
    findByAccountId: vi.fn(async () => []),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => true),
    findByName: vi.fn(async () => null),
    findPublishLogsByProjectId: vi.fn(async () => []),
  };
  return repo as unknown as ProjectRepositoryPort & {
    delete: ReturnType<typeof vi.fn>;
    hardDelete: ReturnType<typeof vi.fn>;
  };
}

describe("DeleteProjectUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("soft-delete semantics", () => {
    it("calls the repository's reversible delete and never hardDelete when the owner deletes", async () => {
      const repo = makeRepo();
      const useCase = new DeleteProjectUseCase(repo);

      const result = await useCase.execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner delete should succeed");
      expect(repo.delete).toHaveBeenCalledTimes(1);
      // The whole point of this change: the destructive variant is never
      // reached from the normal path.
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("performs the delete inside the Unit of Work transaction when one is injected", async () => {
      const repo = makeRepo();
      let deleteRanInsideTransaction = false;
      let insideTransaction = false;
      repo.delete.mockImplementation(async () => {
        deleteRanInsideTransaction = insideTransaction;
        return ok(undefined);
      });
      const uow: UnitOfWork = {
        executeInTransaction: async (fn: () => Promise<unknown>) => {
          insideTransaction = true;
          try {
            return (await fn()) as never;
          } finally {
            insideTransaction = false;
          }
        },
      } as UnitOfWork;

      const result = await new DeleteProjectUseCase(repo, uow).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner delete should succeed");
      expect(deleteRanInsideTransaction).toBe(true);
    });
  });

  describe("ownership gate (CWE-639)", () => {
    it("returns NOT_FOUND and never touches the repository write when the caller is a different tenant", async () => {
      const repo = makeRepo({ ownerAccountId: OWNER_ACCOUNT_ID });
      const useCase = new DeleteProjectUseCase(repo);

      const result = await useCase.execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!result.ok, "Cross-tenant delete must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("reports a foreign project with the same code as a missing one, so existence cannot be enumerated", async () => {
      const foreign = await new DeleteProjectUseCase(
        makeRepo({ ownerAccountId: OWNER_ACCOUNT_ID })
      ).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });
      const missing = await new DeleteProjectUseCase(makeRepo({ ownerAccountId: null })).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!foreign.ok && !missing.ok);
      assert.strictEqual(foreign.error.code, missing.error.code);
      assert.strictEqual(foreign.error.message, missing.error.message);
    });

    it("fails closed on an unknown caller kind instead of falling through to the delete", async () => {
      const repo = makeRepo();
      // Unreachable from TypeScript — the `never` assignment makes an
      // unhandled variant a compile error. Forced here to prove the runtime
      // arm refuses rather than deletes, for a caller built outside the type
      // system (a JSON body, a JS consumer).
      const rogueCaller = { type: "superuser" } as unknown as {
        type: "system";
        source: string;
      };

      const result = await new DeleteProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: rogueCaller,
      });

      assert.ok(!result.ok, "An unknown caller kind must not delete");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("skips the ownership gate for a system caller", async () => {
      const repo = makeRepo();
      const result = await new DeleteProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "system", source: "account-teardown" },
      });

      assert.ok(result.ok, "System caller should be allowed");
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation and failure mapping", () => {
    it("returns VALIDATION_FAILED for a malformed project ID without reading the repository", async () => {
      const repo = makeRepo();
      const result = await new DeleteProjectUseCase(repo).execute({
        projectId: "not-a-uuid",
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the repository reports the project is already deleted", async () => {
      const repo = makeRepo();
      repo.delete.mockResolvedValue(err(new EntityNotFoundError("Project", PROJECT_ID)));

      const result = await new DeleteProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });

    it("converts a thrown repository error into INTERNAL_ERROR instead of propagating it", async () => {
      const repo = makeRepo();
      repo.delete.mockRejectedValue(new Error("connection reset"));

      const result = await new DeleteProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});
