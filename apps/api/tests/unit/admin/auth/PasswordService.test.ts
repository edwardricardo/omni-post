/**
 * @file PasswordService.test.ts
 * @description Unit tier for `PasswordService.confirmPasswordReset` as a CLAIM.
 *   Every case runs the REAL service over a fail-closed stateful fake of the
 *   Prisma CLIENT, so the service's own predicate and write construction execute
 *   and the row is real state an assertion can name.
 *
 *   Two shapes of red on the unmodified tree, and the distinction matters. The
 *   liveness, disambiguation, `INTERNAL_ERROR` and history-poison cases fail
 *   LOUDLY. The concurrency cases fail by SUCCEEDING — a write keyed on `id`
 *   alone matches whether or not the credential still exists — so they are
 *   asserted against the stored row, never against which methods the fake
 *   recorded.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { PasswordService } from "../../../../src/admin/auth/PasswordService.js";
import type { SecurityEventType } from "../../../../src/admin/auth/adminAuthTypes.js";
import {
  createStatefulAdminUserPrismaFake,
  type FakeAdminUserRow,
  type StatefulAdminUserPrismaFake,
} from "../../helpers/statefulAdminUserPrismaFake.js";
import { hashPassword, verifyPassword } from "../../../../src/auth/passwordHashing.js";

const ADMIN_ID = "admin-under-test";
const SESSION_ID = "session-under-test";
const LIVE_TOKEN = "11111111-2222-4333-8444-555555555555";

/** Policy-compliant and DISTINCT, so "which password persisted" is decidable. */
const WINNER_PASSWORD = "W1nner-Str0ng-P@ss!";
const RIVAL_PASSWORD = "R1val-Str0nger-P@ss!";
const WEAK_PASSWORD = "short";

/** A stand-in stored hash. Opaque on purpose: only its IDENTITY is under test. */
const PRIOR_HASH = "$argon2id$v=19$m=65536,t=3,p=4$prior$stored";
const OLDER_HASH = "$argon2id$v=19$m=65536,t=3,p=4$older$stored";

interface CapturedEvent {
  type: SecurityEventType;
  userId: string;
  success: boolean;
}

interface Fixture {
  fake: StatefulAdminUserPrismaFake;
  service: PasswordService;
  events: CapturedEvent[];
  onSecurityEvent: (event: CapturedEvent & { timestamp: Date }) => Promise<void>;
  before: FakeAdminUserRow;
}

function hourFromNow(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function hourAgo(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

/**
 * Seed one admin holding a live reset token, plus one active session, and build
 * the real service over the fake client.
 */
function makeFixture(overrides: Partial<FakeAdminUserRow> = {}): Fixture {
  const fake = createStatefulAdminUserPrismaFake();
  fake.seedAdmin({
    id: ADMIN_ID,
    passwordHash: PRIOR_HASH,
    passwordResetToken: LIVE_TOKEN,
    passwordResetExpires: hourFromNow(),
    passwordHistory: [],
    ...overrides,
  });
  fake.seedSession({ id: SESSION_ID, userId: ADMIN_ID });
  const events: CapturedEvent[] = [];
  const before = fake.readAdmin(ADMIN_ID);
  assert.ok(before, "the fixture admin must be seeded");
  return {
    fake,
    service: new PasswordService(fake.client),
    events,
    onSecurityEvent: async (event) => {
      events.push({ type: event.type, userId: event.userId, success: event.success });
    },
    before: structuredClone(before),
  };
}

/** The stored row, asserted to exist — every outcome assertion starts here. */
function storedRow(fake: StatefulAdminUserPrismaFake): FakeAdminUserRow {
  const row = fake.readAdmin(ADMIN_ID);
  assert.ok(row, "the admin row must still exist");
  return row;
}

/**
 * A refusal is only a refusal if nothing downstream of the claim ran: no security
 * event, no session revocation. Asserted on every refusing case rather than once,
 * because "the exit was refused" and "the exit had no effects" are different
 * claims and the second is the one an attacker cares about.
 */
function assertNoPostClaimEffects(fixture: Fixture): void {
  assert.deepStrictEqual(fixture.events, [], "a refused confirm emits no security event");
  const sessions = fixture.fake.readSessions(ADMIN_ID);
  assert.strictEqual(sessions.length, 1, "the fixture session is still there");
  assert.strictEqual(sessions[0]?.isActive, true, "a refused confirm revokes no session");
}

/** The token columns, exactly as the fixture left them. */
function assertTokenIntact(fixture: Fixture): void {
  const row = storedRow(fixture.fake);
  assert.strictEqual(row.passwordResetToken, fixture.before.passwordResetToken);
  assert.deepStrictEqual(row.passwordResetExpires, fixture.before.passwordResetExpires);
}

describe("PasswordService.confirmPasswordReset — the reset claim", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("the consuming exit", () => {
    it("consumes the token, stores the winner's hash, appends the prior hash and clears the lockout", async () => {
      const fixture = makeFixture({
        passwordHistory: [OLDER_HASH],
        failedLoginAttempts: 3,
        lockedUntil: hourFromNow(),
        lockReason: "BRUTE_FORCE",
      });

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(result.ok, true, "a live token with a compliant password succeeds");
      const row = storedRow(fixture.fake);
      assert.strictEqual(row.passwordResetToken, null, "the token column is consumed");
      assert.strictEqual(row.passwordResetExpires, null, "the expiry column is consumed");
      assert.strictEqual(
        await verifyPassword(row.passwordHash, WINNER_PASSWORD),
        true,
        "the STORED hash verifies against the submitted password"
      );
      assert.strictEqual(row.passwordHashAlgo, "argon2id");
      assert.deepStrictEqual(
        row.passwordHistory,
        [OLDER_HASH, PRIOR_HASH],
        "the prior stored hash is appended to the history the read returned"
      );
      assert.strictEqual(row.mustChangePassword, false);
      assert.strictEqual(row.failedLoginAttempts, 0, "the lockout counter is cleared");
      assert.strictEqual(row.lockedUntil, null, "the lockout deadline is cleared");
      assert.strictEqual(row.lockReason, null, "the lockout reason is cleared");
      assert.deepStrictEqual(
        fixture.events,
        [{ type: "PASSWORD_RESET_COMPLETED", userId: ADMIN_ID, success: true }],
        "exactly one completion event"
      );
      const sessions = fixture.fake.readSessions(ADMIN_ID);
      assert.strictEqual(sessions[0]?.isActive, false, "the active session is revoked");
      assert.strictEqual(sessions[0]?.revokeReason, "PASSWORD_RESET");
    });

    it("never writes an empty entry into the history, while the predicate keeps the UNFILTERED snapshot", async () => {
      // The stored hash is empty — unrepresentable from the tree today (the column
      // is NOT NULL and no production writer stores ""), but normative in the spec
      // and holdable by the fake. The guard is on what is WRITTEN; the compare is
      // still against the value the read returned, or the claim would guard a
      // snapshot that was never in the row.
      const fixture = makeFixture({ passwordHash: "", passwordHistory: ["", OLDER_HASH] });

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(result.ok, true);
      const row = storedRow(fixture.fake);
      assert.deepStrictEqual(
        row.passwordHistory,
        [OLDER_HASH],
        "the stored history holds only real hashes — no empty entry, and the legacy one is purged"
      );
      const claim = fixture.fake.writes().at(-1);
      assert.ok(claim, "the flow reached its write");
      assert.deepStrictEqual(
        claim.where.passwordHistory,
        { equals: ["", OLDER_HASH] },
        "the predicate names the snapshot as READ, unfiltered"
      );
    });
  });

  describe("exits that must not consume the token", () => {
    it("refuses an unknown token with INVALID_TOKEN and leaves every row untouched", async () => {
      const fixture = makeFixture();

      const result = await fixture.service.confirmPasswordReset(
        "99999999-8888-4777-8666-555555555555",
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(result.ok, false);
      assert.strictEqual(!result.ok && result.error, "INVALID_TOKEN");
      assert.deepStrictEqual(
        storedRow(fixture.fake),
        fixture.before,
        "an unknown token changes no column of any row"
      );
      assert.deepStrictEqual(fixture.fake.writes(), [], "an unknown token reaches no write");
      assertNoPostClaimEffects(fixture);
    });

    it("refuses an expired token with INVALID_TOKEN without nulling the expired columns", async () => {
      const fixture = makeFixture({ passwordResetExpires: hourAgo() });

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(!result.ok && result.error, "INVALID_TOKEN");
      assertTokenIntact(fixture);
      assert.strictEqual(storedRow(fixture.fake).passwordHash, PRIOR_HASH);
      assertNoPostClaimEffects(fixture);
    });

    it("refuses a deactivated owner and clears no lockout", async () => {
      const lockedUntil = hourFromNow();
      const fixture = makeFixture({
        isActive: false,
        failedLoginAttempts: 4,
        lockedUntil,
        lockReason: "ADMIN_LOCKED",
      });

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(!result.ok && result.error, "INVALID_TOKEN");
      const row = storedRow(fixture.fake);
      assert.strictEqual(row.passwordHash, PRIOR_HASH, "the password is unchanged");
      assert.strictEqual(row.failedLoginAttempts, 4, "the lockout counter survives");
      assert.deepStrictEqual(row.lockedUntil, lockedUntil, "the lockout deadline survives");
      assert.strictEqual(row.lockReason, "ADMIN_LOCKED", "the lockout reason survives");
      assertTokenIntact(fixture);
      assertNoPostClaimEffects(fixture);
    });

    it("refuses a weak password before reaching any write, leaving the token usable", async () => {
      const fixture = makeFixture();

      const first = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WEAK_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(!first.ok && first.error, "PASSWORD_TOO_WEAK");
      assert.deepStrictEqual(fixture.fake.writes(), [], "a weak password reaches no write");
      assertTokenIntact(fixture);
      assertNoPostClaimEffects(fixture);

      const retry = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );
      assert.strictEqual(retry.ok, true, "the SAME token still works afterwards");
    });

    it("refuses a reused password before reaching any write, leaving the token usable", async () => {
      const reusedHash = await hashPassword(RIVAL_PASSWORD);
      const fixture = makeFixture({ passwordHistory: [reusedHash] });

      const first = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        RIVAL_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(!first.ok && first.error, "PASSWORD_REUSED");
      assert.deepStrictEqual(fixture.fake.writes(), [], "a reused password reaches no write");
      assertTokenIntact(fixture);
      assert.deepStrictEqual(
        storedRow(fixture.fake).passwordHistory,
        [reusedHash],
        "the history is unchanged"
      );
      assertNoPostClaimEffects(fixture);

      const retry = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );
      assert.strictEqual(retry.ok, true, "the SAME token still works afterwards");
    });
  });

  describe("a zero count is disambiguated, never guessed", () => {
    it("reports INVALID_TOKEN when the token was consumed between the read and the claim", async () => {
      const fixture = makeFixture();
      // The concurrent winner: it consumes the token after this flow's deciding
      // read has already passed. On a write keyed by `id` alone this flow would
      // overwrite the winner and BOTH callers would have succeeded.
      fixture.fake.afterNextRead(() => {
        fixture.fake.mutateAdmin(ADMIN_ID, {
          passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$winner$stored",
          passwordResetToken: null,
          passwordResetExpires: null,
          passwordHistory: [PRIOR_HASH],
        });
      });

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        RIVAL_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(!result.ok && result.error, "INVALID_TOKEN");
      const row = storedRow(fixture.fake);
      assert.strictEqual(
        row.passwordHash,
        "$argon2id$v=19$m=65536,t=3,p=4$winner$stored",
        "the winner's hash survives — the loser overwrote nothing"
      );
      assert.strictEqual(
        await verifyPassword(row.passwordHash, RIVAL_PASSWORD),
        false,
        "the loser's password is not the stored one"
      );
      assert.strictEqual(row.passwordResetToken, null);
      assertNoPostClaimEffects(fixture);
    });

    it("reports CONCURRENT_MODIFICATION when only the history moved, and the retry then succeeds", async () => {
      const fixture = makeFixture({ passwordHistory: [OLDER_HASH] });
      fixture.fake.afterNextRead(() => {
        const row = storedRow(fixture.fake);
        fixture.fake.mutateAdmin(ADMIN_ID, {
          passwordHistory: [...row.passwordHistory, "$argon2id$v=19$m=65536,t=3,p=4$racer$stored"],
        });
      });

      const conflict = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(
        !conflict.ok && conflict.error,
        "CONCURRENT_MODIFICATION",
        "a live token whose history moved is a retryable conflict, NOT a bad token"
      );
      assertTokenIntact(fixture);
      assertNoPostClaimEffects(fixture);

      const retry = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );
      assert.strictEqual(retry.ok, true, "nothing consumed the token, so the retry succeeds");
      assert.strictEqual(
        await verifyPassword(storedRow(fixture.fake).passwordHash, WINNER_PASSWORD),
        true
      );
    });

    it("reports CONCURRENT_MODIFICATION when only the passwordHash moved (the login rehash)", async () => {
      const fixture = makeFixture();
      // `upgradePasswordHash` on login writes `passwordHash` ALONE — no history
      // move, no token move — so a history-only compare would miss it and append
      // a stale prior hash over the rehashed one.
      fixture.fake.afterNextRead(() => {
        fixture.fake.mutateAdmin(ADMIN_ID, {
          passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$rehashed$stored",
        });
      });

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(!result.ok && result.error, "CONCURRENT_MODIFICATION");
      assert.strictEqual(
        storedRow(fixture.fake).passwordHash,
        "$argon2id$v=19$m=65536,t=3,p=4$rehashed$stored",
        "the concurrent rehash survives untouched"
      );
      assertTokenIntact(fixture);
      assertNoPostClaimEffects(fixture);
    });

    it("reports INVALID_TOKEN when the owner was deactivated between the read and the claim", async () => {
      const fixture = makeFixture();
      fixture.fake.afterNextRead(() => {
        fixture.fake.mutateAdmin(ADMIN_ID, { isActive: false });
      });

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(
        !result.ok && result.error,
        "INVALID_TOKEN",
        "a deactivated owner is an unusable token, not a retryable conflict"
      );
      assert.strictEqual(storedRow(fixture.fake).passwordHash, PRIOR_HASH);
      assertTokenIntact(fixture);
      assertNoPostClaimEffects(fixture);
    });
  });

  describe("a throw is a failure to ask the question, never an answer to it", () => {
    it("returns INTERNAL_ERROR and preserves the token when the claim write throws", async () => {
      const fixture = makeFixture();
      fixture.fake.failWritesFor(ADMIN_ID);

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(result.ok, false, "a database failure is not a success");
      assert.strictEqual(
        !result.ok && result.error,
        "INTERNAL_ERROR",
        "a write failure is INTERNAL_ERROR — never INVALID_TOKEN, the token is fine"
      );
      assertTokenIntact(fixture);
      assert.strictEqual(storedRow(fixture.fake).passwordHash, PRIOR_HASH);
      assertNoPostClaimEffects(fixture);
    });

    it("returns INTERNAL_ERROR and preserves the token when password hashing throws", async () => {
      const fixture = makeFixture();
      vi.spyOn(fixture.service, "hashPassword").mockRejectedValue(new Error("argon2 unavailable"));

      const result = await fixture.service.confirmPasswordReset(
        LIVE_TOKEN,
        WINNER_PASSWORD,
        fixture.onSecurityEvent
      );

      assert.strictEqual(
        !result.ok && result.error,
        "INTERNAL_ERROR",
        "a hashing failure is INTERNAL_ERROR, not an uncaught throw and not a bad token"
      );
      assertTokenIntact(fixture);
      assert.deepStrictEqual(fixture.fake.writes(), [], "a hashing failure reaches no write");
      assertNoPostClaimEffects(fixture);
    });
  });
});
