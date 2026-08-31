/**
 * @file RestoreAccountUseCase.test.ts
 * @description Unit tests for RestoreAccountUseCase — proves that a soft-deleted account can be
 *   brought back (deletedAt cleared) by its own owner or by an admin, that the tenant gate makes a
 *   foreign or non-existent account indistinguishable (NOT_FOUND, anti-enumeration), that a row
 *   which is not currently soft-deleted cannot be "restored" (NOT_FOUND), and that the write runs
 *   inside the Unit of Work.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { RestoreAccountUseCase } from "../../src/RestoreAccountUseCase.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440401";
const OTHER_ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440402";

function makeRepo(): AccountRepositoryPort & {
  restore: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const repo = {
    findById: vi.fn(async () => ok({ id: { value: ACCOUNT_ID } })),
    findByEmail: vi.fn(async () => null),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    restore: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => true),
    findAll: vi.fn(async () => []),
  };
  return repo as unknown as AccountRepositoryPort & {
    restore: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

describe("RestoreAccountUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("owner (customer) caller", () => {
    it("clears deletedAt via the repository's restore when the owner restores its own tenant", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner restore should succeed");
      expect(repo.restore).toHaveBeenCalledTimes(1);
      // Restore is the reversible undo — it must never touch the destructive path.
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND without restoring when the caller belongs to a different tenant", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
      // The foreign id never reaches the repository — no signal that it exists.
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("maps a repository NOT_FOUND (row absent or not soft-deleted) to NOT_FOUND", async () => {
      const repo = makeRepo();
      repo.restore.mockResolvedValueOnce(err(new EntityNotFoundError("Account", ACCOUNT_ID)));

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("admin caller", () => {
    it("restores any tenant without an ownership check", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "admin", adminUserId: "admin-1" },
      });

      assert.ok(result.ok, "Admin restore should succeed");
      expect(repo.restore).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation", () => {
    it("returns VALIDATION_FAILED for a malformed account id", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: "not-a-uuid",
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

      const result = await new RestoreAccountUseCase(repo, uow).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "admin", adminUserId: "admin-1" },
      });

      assert.ok(result.ok);
      expect(uow.executeInTransaction).toHaveBeenCalledTimes(1);
      expect(restoreRanInsideTransaction).toBe(true);
    });
  });
});
