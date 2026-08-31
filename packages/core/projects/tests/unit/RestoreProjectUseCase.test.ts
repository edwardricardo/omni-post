/**
 * @file RestoreProjectUseCase.test.ts
 * @description Unit tests for RestoreProjectUseCase — proves a soft-deleted project is brought back
 *   (deletedAt cleared) by its owner or by an admin, that the ownership gate is read from the
 *   soft-deleted row (not the deletedAt-filtered finder, which would never see it) and makes a
 *   foreign/absent project NOT_FOUND (anti-enumeration), that a non-soft-deleted row cannot be
 *   "restored" (NOT_FOUND), and that the write runs inside the Unit of Work.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { RestoreProjectUseCase } from "../../src/RestoreProjectUseCase.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440501";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440502";
const OTHER_ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440503";

function makeRepo(): ProjectRepositoryPort & {
  restore: ReturnType<typeof vi.fn>;
  findByIdIncludingDeleted: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const repo = {
    findById: vi.fn(async () => err(new EntityNotFoundError("Project", PROJECT_ID))),
    findByIdIncludingDeleted: vi.fn(async () =>
      ok({ id: { value: PROJECT_ID }, accountId: { value: ACCOUNT_ID } })
    ),
    findByAccountId: vi.fn(async () => []),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    restore: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => false),
    findByName: vi.fn(async () => null),
    findPublishLogsByProjectId: vi.fn(async () => []),
  };
  return repo as unknown as ProjectRepositoryPort & {
    restore: ReturnType<typeof vi.fn>;
    findByIdIncludingDeleted: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

describe("RestoreProjectUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("owner (customer) caller", () => {
    it("clears deletedAt via the repository's restore when the owner restores its own project", async () => {
      const repo = makeRepo();

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner restore should succeed");
      expect(repo.restore).toHaveBeenCalledTimes(1);
      // Restore is the reversible undo — it must never touch the destructive path.
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("reads ownership from the soft-deleted row via findByIdIncludingDeleted, not findById", async () => {
      const repo = makeRepo();

      await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      // findById filters `deletedAt: null` and would never find the row we are
      // trying to restore — the ownership gate MUST use the including-deleted
      // finder or it can never restore anything.
      expect(repo.findByIdIncludingDeleted).toHaveBeenCalledTimes(1);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND without restoring when the project belongs to a different account", async () => {
      const repo = makeRepo();
      repo.findByIdIncludingDeleted.mockResolvedValueOnce(
        ok({ id: { value: PROJECT_ID }, accountId: { value: OTHER_ACCOUNT_ID } })
      );

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when no project (soft-deleted or otherwise) carries the id", async () => {
      const repo = makeRepo();
      repo.findByIdIncludingDeleted.mockResolvedValueOnce(
        err(new EntityNotFoundError("Project", PROJECT_ID))
      );

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("maps a repository restore NOT_FOUND (owned but already active) to NOT_FOUND", async () => {
      const repo = makeRepo();
      repo.restore.mockResolvedValueOnce(err(new EntityNotFoundError("Project", PROJECT_ID)));

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("admin caller", () => {
    it("restores any project without an ownership read", async () => {
      const repo = makeRepo();

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "admin", adminUserId: "admin-1" },
      });

      assert.ok(result.ok, "Admin restore should succeed");
      expect(repo.restore).toHaveBeenCalledTimes(1);
      expect(repo.findByIdIncludingDeleted).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("returns VALIDATION_FAILED for a malformed project id", async () => {
      const repo = makeRepo();

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: "not-a-uuid",
        caller: { type: "admin", adminUserId: "admin-1" },
      });

      assert.ok(!result.ok);
      expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.restore).not.toHaveBeenCalled();
    });
  });

  describe("transaction", () => {
    it("performs the restore inside the Unit of Work transaction when one is injected", async () => {
      const repo = makeRepo();
      let restoreRanInsideTransaction = false;
      let insideTransaction = false;
      repo.restore.mockImplementation(async () => {
        restoreRanInsideTransaction = insideTransaction;
        return ok(undefined);
      });
      const uow: UnitOfWork = {
        executeInTransaction: vi.fn(async (work: () => Promise<void>) => {
          insideTransaction = true;
          await work();
          insideTransaction = false;
        }),
      } as unknown as UnitOfWork;

      const result = await new RestoreProjectUseCase(repo, uow).execute({
        projectId: PROJECT_ID,
        caller: { type: "admin", adminUserId: "admin-1" },
      });

      assert.ok(result.ok);
      expect(uow.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(restoreRanInsideTransaction).toBe(true);
    });
  });
});
