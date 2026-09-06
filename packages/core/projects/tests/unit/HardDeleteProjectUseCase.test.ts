/**
 * @file HardDeleteProjectUseCase.test.ts
 * @description Unit tests for HardDeleteProjectUseCase — proves the irreversible path reaches
 *   `hardDelete` (never the soft `delete`) INSIDE a Unit of Work (the only thing that binds the
 *   tenant RLS GUC), refuses a LIVE project so an erasure always follows a deliberate soft delete,
 *   gates a customer caller against the subject's stored account before that interlock can speak,
 *   refuses a project too large to remove atomically before any destructive work, carries the
 *   acting principal and the reason to the tombstone context, refuses a blank reason, and maps
 *   persistence failures to distinct typed codes.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { HardDeleteProjectUseCase } from "../../src/HardDeleteProjectUseCase.js";
import {
  HARD_DELETE_MAX_CASCADE_ROWS,
  HARD_DELETE_MAX_POSTS,
} from "@core/application/hardDeletePolicy.js";
import { WRITE_CONFLICT_MAX_ATTEMPTS } from "@core/application/retryOnWriteConflict.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { toAdminActorId, type AdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440101";
const OWNER_ACCOUNT_ID = "acc-owner-1";
const FOREIGN_ACCOUNT_ID = "acc-intruder-9";

/** Construct a branded admin actor id for the test caller (throws on bad setup). */
function actorId(raw: string): AdminActorId {
  const result = toAdminActorId(raw);
  if (!result.ok) {
    throw new Error(`test setup: invalid admin actor id ${raw}`);
  }
  return result.value;
}

const ADMIN = {
  type: "admin",
  adminUserId: actorId("admin-1"),
  reason: "GDPR erasure request",
} as const;

/** The name the default subject carries, and therefore the only accepted confirmation. */
const SUBJECT_NAME = "Doomed project";

/** The owning tenant erasing its own project — the self-purge caller. */
const CUSTOMER = {
  type: "customer",
  accountId: OWNER_ACCOUNT_ID,
  customerUserId: actorId("customer-user-42"),
  reason: "Customer-initiated erasure",
  expectedName: SUBJECT_NAME,
} as const;

/** The subject every default repository double resolves, owned by OWNER_ACCOUNT_ID. */
const SUBJECT = { accountId: { value: OWNER_ACCOUNT_ID }, name: SUBJECT_NAME };

type MockedRepo = ProjectRepositoryPort & {
  findById: ReturnType<typeof vi.fn>;
  findByIdIncludingDeleted: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  hardDelete: ReturnType<typeof vi.fn>;
  countHardDeleteImpact: ReturnType<typeof vi.fn>;
};

/**
 * A repository double whose subject is ALREADY SOFT-DELETED — the only state in
 * which an erasure is admissible, and therefore the right default for a suite
 * about the irreversible path. Soft-deleted is modelled the way the port defines
 * it: `findById` excludes the row (it serves the live population only) while
 * `findByIdIncludingDeleted` still resolves it.
 */
function makeRepo(): MockedRepo {
  const repo = {
    findById: vi.fn(async () => err(new EntityNotFoundError("Project", PROJECT_ID))),
    findByIdIncludingDeleted: vi.fn(async () => ok(SUBJECT)),
    findByAccountId: vi.fn(async () => []),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    restore: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    countHardDeleteImpact: vi.fn(async () => ({ posts: 0, childRows: 0 })),
    exists: vi.fn(async () => true),
    findByName: vi.fn(async () => null),
    findPublishLogsByProjectId: vi.fn(async () => []),
  };
  return repo as unknown as MockedRepo;
}

/**
 * Flip the double's subject back to the LIVE population: `findById` resolves it,
 * which is exactly how the use case learns the row was never soft-deleted.
 */
function markLive(repo: MockedRepo): void {
  repo.findById.mockResolvedValue(ok(SUBJECT));
}

/**
 * A Unit of Work double that RUNS its callback (so the wrapped hard delete
 * actually executes) and records that it was called — which is how these tests
 * prove the delete is routed through a transaction rather than issued bare.
 */
function makeUow(): UnitOfWork & { executeInTransaction: ReturnType<typeof vi.fn> } {
  const uow = {
    executeInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
  return uow as unknown as UnitOfWork & { executeInTransaction: ReturnType<typeof vi.fn> };
}

/**
 * Retry seams that exercise the schedule without spending its wall clock: the sleep
 * resolves immediately and the jitter is pinned. The ATTEMPT COUNT is deliberately
 * left at the production default, so a test asserting "three attempts" is asserting
 * the shipped policy rather than one the test invented.
 */
const NO_WAIT = {
  sleep: async (): Promise<void> => {},
  random: (): number => 0,
} as const;

describe("HardDeleteProjectUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reaches the irreversible repository cascade and never the soft delete", async () => {
    const repo = makeRepo();

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(result.ok, "Admin hard delete should succeed");
    expect(repo.hardDelete).toHaveBeenCalledTimes(1);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("runs the delete INSIDE the Unit of Work so the transaction binds the tenant RLS GUC", async () => {
    const repo = makeRepo();
    const uow = makeUow();
    let deleteCalledDuringTx = false;
    uow.executeInTransaction.mockImplementation(async (fn: () => Promise<unknown>) => {
      expect(repo.hardDelete).not.toHaveBeenCalled();
      const out = await fn();
      expect(repo.hardDelete).toHaveBeenCalledTimes(1);
      deleteCalledDuringTx = true;
      return out;
    });

    await new HardDeleteProjectUseCase(repo, uow).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    expect(uow.executeInTransaction).toHaveBeenCalledTimes(1);
    expect(deleteCalledDuringTx).toBe(true);
  });

  it("hands the acting admin AND the reason to the repository so the tombstone records who and why", async () => {
    const repo = makeRepo();

    await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    const call = repo.hardDelete.mock.calls[0] as [
      { value: string },
      { deletedBy: string; reason: string },
    ];
    expect(call[0].value).toBe(PROJECT_ID);
    expect(call[1]).toEqual({ deletedBy: ADMIN.adminUserId, reason: "GDPR erasure request" });
  });

  it("refuses a project too large to remove atomically, before opening the transaction", async () => {
    const repo = makeRepo();
    repo.countHardDeleteImpact.mockResolvedValue({
      posts: HARD_DELETE_MAX_POSTS + 1,
      childRows: 0,
    });
    const uow = makeUow();

    const result = await new HardDeleteProjectUseCase(repo, uow).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok, "An oversized project must be refused");
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.OPERATION_TOO_LARGE);
    expect(result.error.message).toContain(String(HARD_DELETE_MAX_POSTS + 1));
    expect(result.error.message).toContain(String(HARD_DELETE_MAX_POSTS));
    expect(uow.executeInTransaction).not.toHaveBeenCalled();
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("allows a project exactly at the ceiling", async () => {
    const repo = makeRepo();
    repo.countHardDeleteImpact.mockResolvedValue({
      posts: HARD_DELETE_MAX_POSTS,
      childRows: HARD_DELETE_MAX_CASCADE_ROWS,
    });

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(result.ok, "A project at the ceiling is allowed");
    expect(repo.hardDelete).toHaveBeenCalledTimes(1);
  });

  it("refuses a blank reason so the audit record can never be empty", async () => {
    const repo = makeRepo();

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: { type: "admin", adminUserId: actorId("admin-1"), reason: "   " },
    });

    assert.ok(!result.ok, "A blank reason must be rejected");
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("returns VALIDATION_FAILED for a malformed project ID without touching the repository", async () => {
    const repo = makeRepo();

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: "not-a-uuid",
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the row stops being erasable between the checks and the write", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockResolvedValue(err(new EntityNotFoundError("Project", PROJECT_ID)));

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });

  it("maps a foreign-key interlock (P2003) to CONFLICT — a durable, non-retryable failure", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(Object.assign(new Error("FK constraint"), { code: "P2003" }));

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
  });

  it("maps a transaction timeout (P2028) to TRANSIENT_FAILURE — retryable", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(Object.assign(new Error("tx timeout"), { code: "P2028" }));

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.TRANSIENT_FAILURE);
  });

  it("maps a serialization write conflict (P2034) to TRANSIENT_FAILURE — retryable", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(
      Object.assign(new Error("write conflict"), { code: "P2034" })
    );

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.TRANSIENT_FAILURE);
  });

  it("converts an unclassified thrown error into INTERNAL_ERROR instead of propagating it", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(new Error("transaction aborted"));

    const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });

  it("refuses a project whose CHILD dependent rows exceed the ceiling, even when its posts do not", async () => {
    const repo = makeRepo();
    // The exact shape a posts-only guard was blind to: comfortably under the post
    // ceiling, far over the cascade the transaction budget can finish.
    repo.countHardDeleteImpact.mockResolvedValue({
      posts: 1,
      childRows: HARD_DELETE_MAX_CASCADE_ROWS + 1,
    });
    const uow = makeUow();

    const result = await new HardDeleteProjectUseCase(repo, uow).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok, "A project over the child-row ceiling must be refused");
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.OPERATION_TOO_LARGE);
    // The message names the dimension that tripped, so the operator does not go
    // hunting through posts that were never the problem.
    expect(result.error.message).toContain(String(HARD_DELETE_MAX_CASCADE_ROWS + 1));
    expect(result.error.message).toContain(String(HARD_DELETE_MAX_CASCADE_ROWS));
    // Nothing destructive ran.
    expect(uow.executeInTransaction).not.toHaveBeenCalled();
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("retries a write conflict (P2034) and succeeds on the next attempt", async () => {
    const repo = makeRepo();
    repo.hardDelete
      .mockRejectedValueOnce(Object.assign(new Error("write conflict"), { code: "P2034" }))
      .mockResolvedValueOnce(ok(undefined));

    const result = await new HardDeleteProjectUseCase(repo, makeUow(), NO_WAIT).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    // Serializable makes the tombstone snapshot trustworthy by aborting under a
    // concurrent writer. Without the retry, that correctness costs the operator a
    // hand-rerun of a minutes-long cascade; with it, the transient loss converges.
    assert.ok(result.ok, "A retried write conflict must converge, not surface as 503");
    expect(repo.hardDelete).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a transaction timeout (P2028) — re-running it just spends the budget again", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(Object.assign(new Error("tx timeout"), { code: "P2028" }));

    const result = await new HardDeleteProjectUseCase(repo, makeUow(), NO_WAIT).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.TRANSIENT_FAILURE);
    expect(repo.hardDelete).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a foreign-key interlock (P2003) — it is durable by construction", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(Object.assign(new Error("FK"), { code: "P2003" }));

    await new HardDeleteProjectUseCase(repo, makeUow(), NO_WAIT).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    expect(repo.hardDelete).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded attempts and says the project must be quiesced", async () => {
    const repo = makeRepo();
    repo.hardDelete.mockRejectedValue(
      Object.assign(new Error("write conflict"), { code: "P2034" })
    );

    const result = await new HardDeleteProjectUseCase(repo, makeUow(), NO_WAIT).execute({
      projectId: PROJECT_ID,
      caller: ADMIN,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, USE_CASE_ERRORS.TRANSIENT_FAILURE);
    expect(repo.hardDelete).toHaveBeenCalledTimes(WRITE_CONFLICT_MAX_ATTEMPTS);
    // The retry does not make an erasure converge against a live tenant, and the
    // error has to say so instead of inviting the operator to press the button again.
    expect(result.error.message).toContain(String(WRITE_CONFLICT_MAX_ATTEMPTS));
    expect(result.error.message).toContain("quiesced");
  });

  describe("prior-soft-delete interlock", () => {
    it("returns CONFLICT for a LIVE project, so an erasure can only follow a deliberate soft delete", async () => {
      const repo = makeRepo();
      markLive(repo);
      const uow = makeUow();

      const result = await new HardDeleteProjectUseCase(repo, uow).execute({
        projectId: PROJECT_ID,
        caller: ADMIN,
      });

      // One mistaken call can no longer destroy a tenant's project: the row has
      // to be soft-deleted first, which is a second, separate act that is also
      // reversible right up to the moment the erasure runs.
      assert.ok(!result.ok, "A live project must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      expect(result.error.message).toContain("soft delete");
      expect(repo.hardDelete).not.toHaveBeenCalled();
      expect(uow.executeInTransaction).not.toHaveBeenCalled();
    });

    it("refuses the live project BEFORE measuring the cascade, so nothing is read on its behalf", async () => {
      const repo = makeRepo();
      markLive(repo);

      await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: ADMIN,
      });

      expect(repo.countHardDeleteImpact).not.toHaveBeenCalled();
    });

    it("proceeds for a project that is already soft-deleted", async () => {
      const repo = makeRepo();

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: ADMIN,
      });

      assert.ok(result.ok, "The soft-deleted subject is the erasable one");
      expect(repo.hardDelete).toHaveBeenCalledTimes(1);
    });

    it("returns NOT_FOUND without touching the cascade when no row carries the id at all", async () => {
      const repo = makeRepo();
      repo.findByIdIncludingDeleted.mockResolvedValue(
        err(new EntityNotFoundError("Project", PROJECT_ID))
      );

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: ADMIN,
      });

      assert.ok(!result.ok);
      // Absent stays NOT_FOUND — only a row that EXISTS and is live is a conflict.
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.countHardDeleteImpact).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });
  });

  describe("customer self-purge caller", () => {
    it("erases a soft-deleted project the calling account owns", async () => {
      const repo = makeRepo();

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: CUSTOMER,
      });

      assert.ok(result.ok, "The owning tenant may erase its own soft-deleted project");
      expect(repo.hardDelete).toHaveBeenCalledTimes(1);
    });

    it("carries the acting customer principal and reason to the tombstone context", async () => {
      const repo = makeRepo();

      await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: CUSTOMER,
      });

      const call = repo.hardDelete.mock.calls[0] as [
        { value: string },
        { deletedBy: string; reason: string },
      ];
      // The tombstone must name the principal that actually destroyed the data.
      // Attributing a self-purge to an admin who never touched it would make the
      // only durable record of the destruction describe something that did not happen.
      expect(call[1]).toEqual({
        deletedBy: CUSTOMER.customerUserId,
        reason: "Customer-initiated erasure",
      });
    });

    it("returns NOT_FOUND when the project belongs to another account", async () => {
      const repo = makeRepo();

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: { ...CUSTOMER, accountId: FOREIGN_ACCOUNT_ID },
      });

      // NOT_FOUND, never FORBIDDEN: a distinguishable refusal would confirm the
      // id exists to a caller with no right to know (anti-enumeration).
      assert.ok(!result.ok, "A foreign project must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.countHardDeleteImpact).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("answers NOT_FOUND — never CONFLICT — for a foreign project that is LIVE", async () => {
      const repo = makeRepo();
      markLive(repo);

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: { ...CUSTOMER, accountId: FOREIGN_ACCOUNT_ID },
      });

      // Ordering is the assertion: the ownership gate has to speak BEFORE the
      // interlock, or "this project is live" tells an outsider the id exists.
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("applies the same interlock to the owning customer: a LIVE project is CONFLICT", async () => {
      const repo = makeRepo();
      markLive(repo);

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: CUSTOMER,
      });

      // The two-act rule is universal. A self-purge that skipped it would be the
      // one path where a single call still destroys a live project.
      assert.ok(!result.ok, "The owning tenant is not exempt from the interlock");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("does NOT gate an admin against the subject's account", async () => {
      const repo = makeRepo();
      repo.findByIdIncludingDeleted.mockResolvedValue(
        ok({ accountId: { value: FOREIGN_ACCOUNT_ID }, name: "Someone else's project" })
      );

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: ADMIN,
      });

      // Cross-tenant erasure is the admin path's whole purpose; only the customer
      // arm is ownership-gated.
      assert.ok(result.ok, "An admin erases across accounts by design");
      expect(repo.hardDelete).toHaveBeenCalledTimes(1);
    });

    it("refuses a blank reason on the customer arm too", async () => {
      const repo = makeRepo();

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: { ...CUSTOMER, reason: "   " },
      });

      assert.ok(!result.ok, "A blank reason must be rejected whoever sends it");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("returns VALIDATION_FAILED and destroys nothing when the confirmation name is a different project's", async () => {
      const repo = makeRepo();

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: { ...CUSTOMER, expectedName: "Some other project" },
      });

      // The self-purge is the one destructive path a tenant can reach on its own,
      // and an id in a URL carries no evidence that the human meant THIS project.
      // Typing the name back is that evidence. Deleting the comparison turns this
      // into a 200 that erases whatever the id happened to name.
      assert.ok(!result.ok, "A confirmation naming a different project must be refused");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.countHardDeleteImpact).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("requires the confirmation name EXACTLY, so surrounding whitespace still refuses", async () => {
      const repo = makeRepo();

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: { ...CUSTOMER, expectedName: ` ${SUBJECT_NAME} ` },
      });

      // Exact, not trimmed and not case-folded. A confirmation that quietly
      // repairs what the human typed is confirming its own guess rather than
      // their intent — and the entity's own name is already stored trimmed, so a
      // padded value did not come from reading the project's name off the screen.
      assert.ok(!result.ok, "A padded confirmation is not the project's name");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it("checks ownership BEFORE the confirmation, so a foreign project still answers NOT_FOUND", async () => {
      const repo = makeRepo();

      const result = await new HardDeleteProjectUseCase(repo, makeUow()).execute({
        projectId: PROJECT_ID,
        caller: { ...CUSTOMER, accountId: FOREIGN_ACCOUNT_ID, expectedName: "guess" },
      });

      // Ordering is the assertion. Answering "that name is wrong" to an outsider
      // would confirm the id exists AND turn the endpoint into an oracle for
      // guessing another tenant's project names, one request at a time.
      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });
  });
});
