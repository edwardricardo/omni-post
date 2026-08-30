/**
 * @file DeleteAccountUseCase.test.ts
 * @description Unit tests for DeleteAccountUseCase — proves the delete is SOFT (the repository's
 *   reversible `delete`, never `hardDelete`), that a customer caller may only delete its own
 *   tenant (the gate that was entirely absent before), and that the write happens inside the
 *   Unit of Work.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { DeleteAccountUseCase } from "../../src/DeleteAccountUseCase.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440301";
const OTHER_ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440302";

function makeRepo(): AccountRepositoryPort & {
  delete: ReturnType<typeof vi.fn>;
  hardDelete: ReturnType<typeof vi.fn>;
} {
  const repo = {
    findById: vi.fn(async () => ok({ id: { value: ACCOUNT_ID } })),
    findByEmail: vi.fn(async () => null),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => true),
    findAll: vi.fn(async () => []),
  };
  return repo as unknown as AccountRepositoryPort & {
    delete: ReturnType<typeof vi.fn>;
    hardDelete: ReturnType<typeof vi.fn>;
  };
}

describe("DeleteAccountUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("soft-delete semantics", () => {
    it("calls the repository's reversible delete and never hardDelete when the owner deletes", async () => {
      const repo = makeRepo();

      const result = await new DeleteAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
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

      const result = await new DeleteAccountUseCase(repo, uow).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner delete should succeed");
      expect(deleteRanInsideTransaction).toBe(true);
    });
  });

  describe("tenant gate (CWE-639 / N-AUTH-1)", () => {
    it("returns NOT_FOUND and never touches the repository when deleting another tenant's account", async () => {
      const repo = makeRepo();

      const result = await new DeleteAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!result.ok, "Cross-tenant account delete must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
      // Not even a read: a foreign id must not reach persistence at all.
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.exists).not.toHaveBeenCalled();
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

      const result = await new DeleteAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: rogueCaller,
      });

      assert.ok(!result.ok, "An unknown caller kind must not delete");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("skips the tenant gate for a system caller", async () => {
      const repo = makeRepo();

      const result = await new DeleteAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "system", source: "billing-teardown" },
      });

      assert.ok(result.ok, "System caller should be allowed");
      expect(repo.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation and failure mapping", () => {
    it("returns VALIDATION_FAILED for a malformed account ID without reading the repository", async () => {
      const repo = makeRepo();

      const result = await new DeleteAccountUseCase(repo).execute({
        accountId: "not-a-uuid",
        caller: { type: "customer", accountId: "not-a-uuid" },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the repository reports the account is already deleted", async () => {
      const repo = makeRepo();
      repo.delete.mockResolvedValue(err(new EntityNotFoundError("Account", ACCOUNT_ID)));

      const result = await new DeleteAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });

    it("converts a thrown repository error into INTERNAL_ERROR instead of propagating it", async () => {
      const repo = makeRepo();
      repo.delete.mockRejectedValue(new Error("connection reset"));

      const result = await new DeleteAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });
});
