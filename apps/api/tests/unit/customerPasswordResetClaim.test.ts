/**
 * @file customerPasswordResetClaim.test.ts
 * @description Outcome tests for the customer reset confirm, driven through the REAL
 *   `PrismaCustomerUserRepository` over a stateful Prisma-client fake. Every assertion
 *   names the STORED row, never the sequence of repository calls: the defect these
 *   tests exist to retire is a flow that reports success and then reverts the hash it
 *   just wrote, and a call-shape assertion is green on both sides of that.
 *
 *   The last test in this file removes the declared system seam and submits a VALID
 *   token. It is the executable form of the rule that a tenant-context failure may
 *   never be answered with a credential verdict — the caller must not be able to read
 *   a security control's fail-closed throw as "your token is bad".
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { ResetPasswordUseCase } from "@core/customer-auth/ResetPasswordUseCase.js";
import { PrismaCustomerUserRepository } from "../../src/infrastructure/repositories/PrismaCustomerUserRepository.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/adapters/Argon2PasswordHasher.js";
import { withSystemContext } from "../../src/security/tenantContext.js";
import { authLogger } from "../../src/lib/logger.js";
import {
  createStatefulCustomerUserPrismaFake,
  type StatefulCustomerUserPrismaFake,
} from "./helpers/statefulCustomerUserPrismaFake.js";

const hasher = new Argon2PasswordHasher();

/**
 * Stands in for the route's declared seam. This suite drives the use case
 * directly, so it binds the same kind of context the handler binds; the route's
 * own constant is asserted where the route is the subject.
 */
const SEAM_REASON = "system:customer-reset-password";

const ACCOUNT_ID = "acct-reset-claim";
const USER_ID = "user-reset-claim";
const OLD_PASSWORD = "old-password-value";
const NEW_PASSWORD = "new-password-value";
const LIVE_TOKEN = "live-reset-token-aaa";

/** UnitOfWork double: runs the callback inline, as the real one does around a tx. */
function makeUnitOfWork() {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  };
}

function hourFromNow(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function hourAgo(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

describe("Customer reset confirm — the stored row is the subject", () => {
  let fake: StatefulCustomerUserPrismaFake;
  let repo: PrismaCustomerUserRepository;
  let useCase: ResetPasswordUseCase;
  let oldHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    fake = createStatefulCustomerUserPrismaFake();
    repo = new PrismaCustomerUserRepository(fake.client);
    useCase = new ResetPasswordUseCase(
      repo,
      hasher,
      makeUnitOfWork() as unknown as ConstructorParameters<typeof ResetPasswordUseCase>[2]
    );
    oldHash = await hasher.hash(OLD_PASSWORD);
  });

  function seedUser(overrides: Record<string, unknown> = {}): void {
    fake.seed({
      id: USER_ID,
      accountId: ACCOUNT_ID,
      email: "reset-claim@example.test",
      passwordHash: oldHash,
      firstName: "Reset",
      lastName: "Claim",
      resetToken: LIVE_TOKEN,
      resetTokenExpiry: hourFromNow(),
      ...overrides,
    });
  }

  it("stores a hash that verifies against the new password and never against the old one", async () => {
    seedUser();

    const result = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ token: LIVE_TOKEN, newPassword: NEW_PASSWORD })
    );

    assert.ok(result.ok, `expected ok, got: ${!result.ok ? result.error : ""}`);

    const stored = fake.read(USER_ID);
    assert.ok(stored, "the row must still exist");
    assert.strictEqual(
      await argon2.verify(stored.passwordHash, NEW_PASSWORD),
      true,
      "the FINAL stored hash must verify against the new password — a later write in the same flow must not restore the entity's in-memory hash"
    );
    assert.strictEqual(
      await argon2.verify(stored.passwordHash, OLD_PASSWORD),
      false,
      "the FINAL stored hash must NOT verify against the old password"
    );
    assert.strictEqual(stored.resetToken, null, "the token must be consumed");
    assert.strictEqual(stored.resetTokenExpiry, null, "the expiry must be cleared with the token");
  });

  it("answers exactly one of two concurrent confirms of the same token with ok", async () => {
    seedUser();
    const winnerCandidate = "concurrent-password-one";
    const loserCandidate = "concurrent-password-two";

    const [first, second] = await Promise.all([
      withSystemContext(SEAM_REASON, () =>
        useCase.execute({ token: LIVE_TOKEN, newPassword: winnerCandidate })
      ),
      withSystemContext(SEAM_REASON, () =>
        useCase.execute({ token: LIVE_TOKEN, newPassword: loserCandidate })
      ),
    ]);

    const outcomes = [first, second];
    const succeeded = outcomes.filter((r) => r.ok);
    const refused = outcomes.filter((r) => !r.ok && r.error === "INVALID_TOKEN");

    assert.strictEqual(succeeded.length, 1, "exactly ONE confirm may succeed");
    assert.strictEqual(refused.length, 1, "the other must be refused with INVALID_TOKEN");

    // Which password won is decided by the count gate, so the assertion names
    // "the winner's password", never a fixed one of the two.
    const winnerPassword = first.ok ? winnerCandidate : loserCandidate;
    const loserPassword = first.ok ? loserCandidate : winnerCandidate;
    const stored = fake.read(USER_ID);
    assert.ok(stored);
    assert.strictEqual(await argon2.verify(stored.passwordHash, winnerPassword), true);
    assert.strictEqual(await argon2.verify(stored.passwordHash, loserPassword), false);
    assert.strictEqual(stored.resetToken, null);
  });

  it("refuses an expired token without consuming it or touching the stored hash", async () => {
    const expiry = hourAgo();
    seedUser({ resetTokenExpiry: expiry });

    const result = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ token: LIVE_TOKEN, newPassword: NEW_PASSWORD })
    );

    assert.ok(!result.ok, "an expired token must not confirm");
    assert.strictEqual(
      result.error,
      "INVALID_TOKEN",
      "expiry is enforced by the claim predicate and reported as the single unusable-token code"
    );

    const stored = fake.read(USER_ID);
    assert.ok(stored);
    assert.strictEqual(stored.passwordHash, oldHash, "the stored hash must be untouched");
    assert.strictEqual(
      stored.resetToken,
      LIVE_TOKEN,
      "a FAILED attempt must not consume the expired token"
    );
    assert.strictEqual(stored.resetTokenExpiry?.getTime(), expiry.getTime());
  });

  it("refuses a live token whose owner is soft-deleted, and never revives the row", async () => {
    const deletedAt = new Date("2026-01-01T00:00:00.000Z");
    seedUser({ deletedAt });

    const result = await withSystemContext(SEAM_REASON, () =>
      useCase.execute({ token: LIVE_TOKEN, newPassword: NEW_PASSWORD })
    );

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_TOKEN");

    const stored = fake.read(USER_ID);
    assert.ok(stored);
    assert.strictEqual(stored.passwordHash, oldHash, "a deleted owner's hash must not change");
    assert.strictEqual(
      stored.deletedAt?.getTime(),
      deletedAt.getTime(),
      "the write must neither reset nor revive a deleted user"
    );
  });

  describe("a context failure is never degraded into a token verdict", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(authLogger, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("surfaces an internal failure, not INVALID_TOKEN, when no context is bound", async () => {
      seedUser();

      // No seam: the guard fails closed on the enrolled model. A VALID token is
      // submitted on purpose, so the only thing that can produce a failure here
      // is the missing context.
      const result = await useCase.execute({ token: LIVE_TOKEN, newPassword: NEW_PASSWORD });

      assert.ok(!result.ok, "a context failure must not be reported as a success");
      assert.notStrictEqual(
        result.error,
        "INVALID_TOKEN",
        "a fail-closed security control must never read to the caller as a bad token"
      );
      assert.strictEqual(result.error, "INTERNAL_ERROR");
      expect(errorSpy).toHaveBeenCalled();

      const stored = fake.read(USER_ID);
      assert.ok(stored);
      assert.strictEqual(stored.passwordHash, oldHash, "nothing may be written");
      assert.strictEqual(stored.resetToken, LIVE_TOKEN, "the token must stay live");
    });
  });
});
