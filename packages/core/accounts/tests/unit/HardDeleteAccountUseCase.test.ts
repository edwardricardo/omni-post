/**
 * @file HardDeleteAccountUseCase.test.ts
 * @description Unit tests for HardDeleteAccountUseCase — proves the irreversible path reaches
 *   `hardDelete` (never the soft `delete`), refuses to run without a written reason, and maps
 *   repository failures to typed codes.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { HardDeleteAccountUseCase } from "../../src/HardDeleteAccountUseCase.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440301";
const ADMIN = { type: "admin", adminUserId: "admin-1", reason: "GDPR erasure request" } as const;

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

describe("HardDeleteAccountUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reaches the irreversible repository cascade and never the soft delete", async () => {
    const repo = makeRepo();

    const result = await new HardDeleteAccountUseCase(repo).execute({
      accountId: ACCOUNT_ID,
      caller: ADMIN,
    });

    assert.ok(result.ok, "Admin hard delete should succeed");
    expect(repo.hardDelete).toHaveBeenCalledTimes(1);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("hands the acting admin to the repository so the tombstone records who destroyed the data", async () => {
    const repo = makeRepo();

    await new HardDeleteAccountUseCase(repo).execute({
      accountId: ACCOUNT_ID,
      caller: ADMIN,
    });

    // The DeletionRecord rows (one for the account, one per project it drags
    // along) are written inside the repository's transaction, so the principal
    // has to travel with the call. Without it the only durable trace of an
    // irreversible destruction would name nobody.
    const call = repo.hardDelete.mock.calls[0] as [{ value: string }, { deletedBy: string }];
    expect(call[0].value).toBe(ACCOUNT_ID);
    expect(call[1]).toEqual({ deletedBy: ADMIN.adminUserId });
  });

  it("refuses a blank reason so the audit record can never be empty", async () => {
    const repo = makeRepo();

    const result = await new HardDeleteAccountUseCase(repo).execute({
      accountId: ACCOUNT_ID,
      caller: { type: "admin", adminUserId: "admin-1", reason: "   " },
    });

    assert.ok(!result.ok, "A blank reason must be rejected");
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("returns VALIDATION_FAILED for a malformed account ID without touching the repository", async () => {
    const repo = makeRepo();

    const result = await new HardDeleteAccountUseCase(repo).execute({
      accountId: "not-a-uuid",
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when no account carries that id", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockResolvedValue(err(new EntityNotFoundError("Account", ACCOUNT_ID)));

    const result = await new HardDeleteAccountUseCase(repo).execute({
      accountId: ACCOUNT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });

  it("converts a thrown repository error into INTERNAL_ERROR instead of propagating it", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(new Error("transaction aborted"));

    const result = await new HardDeleteAccountUseCase(repo).execute({
      accountId: ACCOUNT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
