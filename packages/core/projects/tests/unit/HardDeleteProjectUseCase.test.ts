/**
 * @file HardDeleteProjectUseCase.test.ts
 * @description Unit tests for HardDeleteProjectUseCase — proves the irreversible path reaches
 *   `hardDelete` (never the soft `delete`) INSIDE a Unit of Work (the only thing that binds the
 *   tenant RLS GUC), refuses a project too large to remove atomically before any destructive work,
 *   carries the acting admin and the reason to the tombstone context, refuses a blank reason, and
 *   maps persistence failures to distinct typed codes.
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

function makeRepo(): ProjectRepositoryPort & {
  delete: ReturnType<typeof vi.fn>;
  hardDelete: ReturnType<typeof vi.fn>;
  countHardDeleteImpact: ReturnType<typeof vi.fn>;
} {
  const repo = {
    findById: vi.fn(async () => ok({ accountId: { value: "acc" } })),
    findByAccountId: vi.fn(async () => []),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    countHardDeleteImpact: vi.fn(async () => ({ posts: 0, childRows: 0 })),
    exists: vi.fn(async () => true),
    findByName: vi.fn(async () => null),
    findPublishLogsByProjectId: vi.fn(async () => []),
  };
  return repo as unknown as ProjectRepositoryPort & {
    delete: ReturnType<typeof vi.fn>;
    hardDelete: ReturnType<typeof vi.fn>;
    countHardDeleteImpact: ReturnType<typeof vi.fn>;
  };
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

  it("returns NOT_FOUND when no project carries that id", async () => {
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
});
