/**
 * @file RestoreAccountUseCase.test.ts
 * @description Unit tests for RestoreAccountUseCase — proves the reversal goes through the
 *   repository's `restore` (never a resurrecting `save`), that a customer caller may only restore
 *   its own tenant, that an already-active row is refused instead of silently "restored", that the
 *   e-mail collision is reported as an answerable conflict rather than an opaque failure, and that
 *   the write that LOSES the race to a live twin is classified as a conflict, not a 500.
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
const OWNER_EMAIL = "owner@example.com";

/** The spies each test steers or interrogates. */
interface RepoSpies {
  findById: ReturnType<typeof vi.fn>;
  findByIdIncludingDeleted: ReturnType<typeof vi.fn>;
  findByEmail: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  hardDelete: ReturnType<typeof vi.fn>;
}

/**
 * Default world: the subject EXISTS and is SOFT-DELETED (so `findByIdIncludingDeleted`
 * sees it while the sweep-filtered `findById` does not), and no live account holds its
 * e-mail. That is the only state a restore is defined on; every other test bends one
 * of those three facts.
 */
function makeRepo(): AccountRepositoryPort & RepoSpies {
  const softDeletedSubject = { id: { value: ACCOUNT_ID }, email: OWNER_EMAIL };
  const repo = {
    // The sweep-filtered read: `err` means the row is NOT in the live population,
    // which is exactly what makes it restorable.
    findById: vi.fn(async () => err(new EntityNotFoundError("Account", ACCOUNT_ID))),
    findByIdIncludingDeleted: vi.fn(async () => ok(softDeletedSubject)),
    findByEmail: vi.fn(async () => null),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    restore: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    countHardDeleteImpact: vi.fn(async () => ({ posts: 0, childRows: 0 })),
    exists: vi.fn(async () => false),
    findAll: vi.fn(async () => []),
  };
  return repo as unknown as AccountRepositoryPort & RepoSpies;
}

/** A Unit of Work that records whether a callback ran inside its transaction. */
function makeTrackingUnitOfWork(): { uow: UnitOfWork; isInside: () => boolean } {
  let inside = false;
  const uow = {
    executeInTransaction: async (fn: () => Promise<unknown>) => {
      inside = true;
      try {
        return (await fn()) as never;
      } finally {
        inside = false;
      }
    },
  } as UnitOfWork;
  return { uow, isInside: () => inside };
}

/** A rejection carrying a data-layer error code, the shape the classifier reads. */
function persistenceError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("RestoreAccountUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("restore semantics", () => {
    it("returns ok and clears the soft delete through the repository's restore when the owner restores", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner restore should succeed");
      expect(repo.restore).toHaveBeenCalledTimes(1);
      // Reversal is the repository's own operation. Re-saving the entity would
      // rewrite every column from a stale snapshot to clear one timestamp.
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("performs the restore inside the Unit of Work transaction when one is injected", async () => {
      const repo = makeRepo();
      const { uow, isInside } = makeTrackingUnitOfWork();
      let restoreRanInsideTransaction = false;
      repo.restore.mockImplementation(async () => {
        restoreRanInsideTransaction = isInside();
        return ok(undefined);
      });

      const result = await new RestoreAccountUseCase(repo, uow).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner restore should succeed");
      expect(restoreRanInsideTransaction).toBe(true);
    });

    it("reads the collision check inside the same transaction as the write", async () => {
      const repo = makeRepo();
      const { uow, isInside } = makeTrackingUnitOfWork();
      let checkRanInsideTransaction = false;
      repo.findByEmail.mockImplementation(async () => {
        checkRanInsideTransaction = isInside();
        return null;
      });

      const result = await new RestoreAccountUseCase(repo, uow).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner restore should succeed");
      // A check taken outside the transaction that guards the write would widen
      // the window it exists to narrow.
      expect(checkRanInsideTransaction).toBe(true);
    });
  });

  describe("identity gate (CWE-639)", () => {
    it("returns NOT_FOUND and never touches the repository when restoring another tenant's account", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!result.ok, "Cross-tenant account restore must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.restore).not.toHaveBeenCalled();
      // Not even a read: a foreign id must not reach persistence at all, and the
      // caller must not learn whether it exists.
      expect(repo.findByIdIncludingDeleted).not.toHaveBeenCalled();
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("fails closed on an unknown caller kind instead of falling through to the restore", async () => {
      const repo = makeRepo();
      // Unreachable from TypeScript — the `never` assignment makes an unhandled
      // variant a compile error. Forced here to prove the runtime arm refuses
      // rather than restores, for a caller built outside the type system.
      const rogueCaller = { type: "superuser" } as unknown as {
        type: "admin";
        adminUserId: string;
      };

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: rogueCaller,
      });

      assert.ok(!result.ok, "An unknown caller kind must not restore");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("skips the identity gate for an admin caller recovering another tenant", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "admin", adminUserId: "admin-user-1" },
      });

      assert.ok(result.ok, "Admin caller should be allowed");
      expect(repo.restore).toHaveBeenCalledTimes(1);
    });
  });

  describe("subject state", () => {
    it("returns CONFLICT and never calls restore when the account is already active", async () => {
      const repo = makeRepo();
      // The row IS in the live population, so there is no soft delete to reverse.
      repo.findById.mockResolvedValue(ok({ id: { value: ACCOUNT_ID }, email: OWNER_EMAIL }));

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok, "Restoring a live account must fail");
      // CONFLICT, not NOT_FOUND: the caller already proved it owns this id, so
      // "it does not exist" would be a lie, and "ok" would report work nobody did.
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when no row carries the id at all", async () => {
      const repo = makeRepo();
      repo.findByIdIncludingDeleted.mockResolvedValue(
        err(new EntityNotFoundError("Account", ACCOUNT_ID))
      );

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok, "Restoring an absent account must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the repository refuses the restore", async () => {
      const repo = makeRepo();
      repo.restore.mockResolvedValue(err(new EntityNotFoundError("Account", ACCOUNT_ID)));

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("e-mail collision", () => {
    it("returns CONFLICT naming the active holder when another live account already uses the e-mail", async () => {
      const repo = makeRepo();
      repo.findByEmail.mockResolvedValue({ id: { value: OTHER_ACCOUNT_ID }, email: OWNER_EMAIL });

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok, "A taken e-mail must block the restore");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      // The message has to name the blocker, or the operator is told "conflict"
      // about a situation only they can resolve, without being told with what.
      assert.ok(
        result.error.message.includes(OTHER_ACCOUNT_ID),
        "The conflict must name the account holding the e-mail"
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("restores when the only account holding the e-mail is the subject itself", async () => {
      const repo = makeRepo();
      // A repository that serves soft-deleted rows to a by-e-mail lookup would
      // return the subject here; reading that as a collision would make every
      // restore impossible.
      repo.findByEmail.mockResolvedValue({ id: { value: ACCOUNT_ID }, email: OWNER_EMAIL });

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(result.ok, "The subject is not its own collision");
      expect(repo.restore).toHaveBeenCalledTimes(1);
    });
  });

  describe("persistence failure classification", () => {
    it("returns CONFLICT when the restore write loses the race to a live twin", async () => {
      const repo = makeRepo();
      // The twin was born AFTER the pre-check read, so the partial unique index is
      // the arbiter and its violation arrives as a throw from the data layer.
      repo.restore.mockRejectedValue(
        persistenceError("P2002", "Unique constraint failed on the fields: (`email`)")
      );

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok, "A lost race must fail");
      // The database resolved a race correctly; blaming the system with a 500
      // would hide an answerable situation behind an internal fault.
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
    });

    it("returns TRANSIENT_FAILURE when the transaction is aborted by a write conflict", async () => {
      const repo = makeRepo();
      repo.restore.mockRejectedValue(persistenceError("P2034", "write conflict"));

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.TRANSIENT_FAILURE);
    });

    it("returns INTERNAL_ERROR for an unclassified thrown repository error", async () => {
      const repo = makeRepo();
      repo.restore.mockRejectedValue(new Error("connection reset"));

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: ACCOUNT_ID,
        caller: { type: "customer", accountId: ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });

  describe("validation", () => {
    it("returns VALIDATION_FAILED for a malformed account ID without reading the repository", async () => {
      const repo = makeRepo();

      const result = await new RestoreAccountUseCase(repo).execute({
        accountId: "not-a-uuid",
        caller: { type: "customer", accountId: "not-a-uuid" },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.findByIdIncludingDeleted).not.toHaveBeenCalled();
      expect(repo.restore).not.toHaveBeenCalled();
    });
  });
});
