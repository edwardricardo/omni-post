/**
 * @file RestoreProjectUseCase.test.ts
 * @description Unit tests for RestoreProjectUseCase — proves the customer caller is ownership-gated
 *   with a NOT_FOUND that cannot be told apart from a missing project, that a LIVE row is refused
 *   with CONFLICT rather than silently "restored", that a name already held by an active project is
 *   reported as an actionable CONFLICT, that the residual race the partial unique arbitrates
 *   (P2002) answers CONFLICT instead of a 500, and that the write happens inside the Unit of Work.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { RestoreProjectUseCase } from "../../src/RestoreProjectUseCase.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { AdminActorId } from "@core/domain/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440101";
const TWIN_PROJECT_ID = "550e8400-e29b-41d4-a716-446655440102";
const OWNER_ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440201";
const OTHER_ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440202";
const PROJECT_NAME = "Marketing Campaign Q1";

const ADMIN_ID = "admin-user-7" as AdminActorId;

interface RepoOptions {
  /** Owner of the subject row. `null` means no row carries the id at all. */
  ownerAccountId?: string | null;
  /**
   * Whether the subject row is currently LIVE. The port defines `findById` as
   * filtering `deletedAt: null`, so a hit from it IS the liveness signal — the
   * domain entity carries no `deletedAt` of its own.
   */
  live?: boolean;
  /** Id of the active project already holding the subject's name, if any. */
  nameHolderId?: string | null;
}

type MockedRepo = ProjectRepositoryPort & {
  findById: ReturnType<typeof vi.fn>;
  findByIdIncludingDeleted: ReturnType<typeof vi.fn>;
  findByName: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  hardDelete: ReturnType<typeof vi.fn>;
};

function makeRepo(overrides: RepoOptions = {}): MockedRepo {
  const { ownerAccountId = OWNER_ACCOUNT_ID, live = false, nameHolderId = null } = overrides;

  const subject =
    ownerAccountId === null
      ? null
      : {
          id: { value: PROJECT_ID },
          accountId: { value: ownerAccountId },
          name: PROJECT_NAME,
        };

  const repo = {
    // Live-only finder: hits only when the row is NOT soft-deleted.
    findById: vi.fn(async () =>
      subject !== null && live ? ok(subject) : err(new EntityNotFoundError("Project", PROJECT_ID))
    ),
    findByIdIncludingDeleted: vi.fn(async () =>
      subject === null ? err(new EntityNotFoundError("Project", PROJECT_ID)) : ok(subject)
    ),
    findByAccountId: vi.fn(async () => []),
    save: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
    restore: vi.fn(async () => ok(undefined)),
    hardDelete: vi.fn(async () => ok(undefined)),
    countHardDeleteImpact: vi.fn(async () => ({ posts: 0, childRows: 0 })),
    exists: vi.fn(async () => true),
    findByName: vi.fn(async () =>
      nameHolderId === null ? null : { id: { value: nameHolderId }, name: PROJECT_NAME }
    ),
    findPublishLogsByProjectId: vi.fn(async () => []),
  };
  return repo as unknown as MockedRepo;
}

/** A Unit of Work that records whether a callback ran inside its transaction. */
function makeTrackingUnitOfWork(): { uow: UnitOfWork; isInside: () => boolean } {
  let insideTransaction = false;
  const uow = {
    executeInTransaction: async (fn: () => Promise<unknown>) => {
      insideTransaction = true;
      try {
        return (await fn()) as never;
      } finally {
        insideTransaction = false;
      }
    },
  } as UnitOfWork;
  return { uow, isInside: () => insideTransaction };
}

describe("RestoreProjectUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("soft-delete reversal semantics", () => {
    it("returns ok and calls the repository restore when the owner restores a soft-deleted project", async () => {
      const repo = makeRepo();

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner restore of a soft-deleted project should succeed");
      expect(repo.restore).toHaveBeenCalledTimes(1);
      // Restore is a reversal, never a destructive path.
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

      const result = await new RestoreProjectUseCase(repo, uow).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(result.ok, "Owner restore should succeed");
      expect(restoreRanInsideTransaction).toBe(true);
    });
  });

  describe("ownership gate (CWE-639)", () => {
    it("returns NOT_FOUND and never restores when the caller is a different tenant", async () => {
      const repo = makeRepo({ ownerAccountId: OWNER_ACCOUNT_ID });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!result.ok, "Cross-tenant restore must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("reports a foreign project with the same code and message as a missing one, so existence cannot be enumerated", async () => {
      const foreign = await new RestoreProjectUseCase(
        makeRepo({ ownerAccountId: OWNER_ACCOUNT_ID })
      ).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });
      const missing = await new RestoreProjectUseCase(makeRepo({ ownerAccountId: null })).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!foreign.ok && !missing.ok);
      assert.strictEqual(foreign.error.code, missing.error.code);
      assert.strictEqual(foreign.error.message, missing.error.message);
    });

    it("returns NOT_FOUND rather than CONFLICT for a foreign LIVE project, so the liveness answer cannot leak existence", async () => {
      // Pins the ORDER of the two refusals: the ownership gate must decide
      // before the liveness check, or a foreign caller learns from a CONFLICT
      // that the id exists and is active.
      const repo = makeRepo({ ownerAccountId: OWNER_ACCOUNT_ID, live: true });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OTHER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("fails closed on an unknown caller kind instead of falling through to the restore", async () => {
      const repo = makeRepo();
      // Unreachable from TypeScript — the `never` assignment makes an unhandled
      // variant a compile error. Forced here to prove the runtime arm refuses
      // rather than restores, for a caller built outside the type system.
      const rogueCaller = { type: "superuser" } as unknown as {
        type: "admin";
        adminUserId: AdminActorId;
      };

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: rogueCaller,
      });

      assert.ok(!result.ok, "An unknown caller kind must not restore");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.FORBIDDEN);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("restores a project belonging to another account when the caller is an admin", async () => {
      const repo = makeRepo({ ownerAccountId: OTHER_ACCOUNT_ID });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "admin", adminUserId: ADMIN_ID },
      });

      assert.ok(result.ok, "Admin recovery should bypass the ownership gate");
      expect(repo.restore).toHaveBeenCalledTimes(1);
    });
  });

  describe("live-row refusal", () => {
    it("returns CONFLICT when the project is still live, because there is nothing to restore", async () => {
      const repo = makeRepo({ live: true });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok, "Restoring a live project must fail");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("names the live-row situation in the message instead of reporting a missing project", async () => {
      const repo = makeRepo({ live: true });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "admin", adminUserId: ADMIN_ID },
      });

      assert.ok(!result.ok);
      assert.match(result.error.message, /not deleted/i);
      assert.match(result.error.message, /nothing to restore/i);
    });
  });

  describe("name-collision pre-check", () => {
    it("returns CONFLICT naming the active holder when another live project already uses the name", async () => {
      const repo = makeRepo({ nameHolderId: TWIN_PROJECT_ID });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok, "A name held by a live twin must block the restore");
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
      // Actionable: the operator must be able to find the blocking project.
      assert.match(result.error.message, new RegExp(TWIN_PROJECT_ID));
      assert.match(result.error.message, new RegExp(PROJECT_NAME));
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("restores normally when the only project holding the name is the subject itself", async () => {
      // A naive `holder !== null` check would refuse every restore whose own
      // row is still indexed under its name.
      const repo = makeRepo({ nameHolderId: PROJECT_ID });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(result.ok, "The subject holding its own name must not block itself");
      expect(repo.restore).toHaveBeenCalledTimes(1);
    });

    it("looks the name up under the subject's own account, not the caller's", async () => {
      const repo = makeRepo({ ownerAccountId: OTHER_ACCOUNT_ID });

      await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "admin", adminUserId: ADMIN_ID },
      });

      expect(repo.findByName).toHaveBeenCalledWith({ value: OTHER_ACCOUNT_ID }, PROJECT_NAME);
    });
  });

  describe("persistence failure classification", () => {
    it("returns CONFLICT when the restore loses the race to a live twin (P2002)", async () => {
      // The residual race the pre-check cannot close: a twin born between the
      // check and the update. The partial unique arbitrates, and its violation
      // is a conflict the caller can act on — not a system fault.
      const repo = makeRepo();
      repo.restore.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
      );

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
    });

    it("returns TRANSIENT_FAILURE when the transaction aborts on a write conflict (P2034)", async () => {
      const repo = makeRepo();
      repo.restore.mockRejectedValue(Object.assign(new Error("write conflict"), { code: "P2034" }));

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.TRANSIENT_FAILURE);
    });

    it("converts an unclassified thrown repository error into INTERNAL_ERROR instead of propagating it", async () => {
      const repo = makeRepo();
      repo.restore.mockRejectedValue(new Error("connection reset"));

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
    });
  });

  describe("validation and lookup failures", () => {
    it("returns VALIDATION_FAILED for a malformed project ID without reading the repository", async () => {
      const repo = makeRepo();

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: "not-a-uuid",
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      expect(repo.findByIdIncludingDeleted).not.toHaveBeenCalled();
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when no row carries the id at all", async () => {
      const repo = makeRepo({ ownerAccountId: null });

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "admin", adminUserId: ADMIN_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when the repository refuses the restore because the row stopped being restorable", async () => {
      const repo = makeRepo();
      repo.restore.mockResolvedValue(err(new EntityNotFoundError("Project", PROJECT_ID)));

      const result = await new RestoreProjectUseCase(repo).execute({
        projectId: PROJECT_ID,
        caller: { type: "customer", accountId: OWNER_ACCOUNT_ID },
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});
