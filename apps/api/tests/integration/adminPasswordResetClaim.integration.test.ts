/**
 * @file adminPasswordResetClaim.integration.test.ts
 * @description Integration tests for the admin password-reset CLAIM against a real
 *              Postgres — only a real row decides atomicity. For one reset token at
 *              most ONE caller ever receives success, under every interleaving, and
 *              the winner's password is the one that persists. Four layers:
 *                - the claim itself: two concurrent `updateMany` carrying the same
 *                  compare-and-swap predicate resolve to one count 1 + one count 0,
 *                  and the refused statement writes nothing at all
 *                - service, simultaneous: two `confirmPasswordReset` with DISTINCT
 *                  new passwords, both started before either completes
 *                - service, STAGGERED (the whole subject): the loser's deciding read
 *                  resolves BEFORE the winner's claim commits and its own write runs
 *                  AFTER — the interleaving `Promise.all` cannot reliably produce,
 *                  and the one an attacker gets for free inside the argon2 window
 *                - refusal changes nothing: every non-consuming exit leaves the
 *                  token exactly as usable as it was
 *
 *              The staggered red on the unmodified tree fails by SUCCEEDING TWICE —
 *              a green-looking red — so every claim assertion is made against
 *              PERSISTED state (the stored hash verified with argon2, the stored
 *              token columns, the stored lockout columns), never against call shape.
 *
 *              Drives `PasswordService` directly over the seed client — no HTTP, no
 *              DI. Requires Postgres up (`pnpm db:up`); fails loud if the seed
 *              channel is unset, per repo canon.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import { PasswordService } from "../../src/admin/auth/PasswordService.js";
import type { SecurityEventType } from "../../src/admin/auth/adminAuthTypes.js";
import { hashPassword, verifyPassword } from "../../src/auth/passwordHashing.js";
import { createSeedPrismaClient, assertSeedChannelConfigured } from "./helpers/seedPrismaClient.js";

// Module scope on purpose: a missing seed channel aborts the file before any test
// is registered, instead of surfacing as N cancelled children of a failed `before`.
assertSeedChannelConfigured();

const HOUR_MS = 60 * 60 * 1000;

/** Policy-compliant and DISTINCT, so "which password persisted" is decidable. */
const WINNER_PASSWORD = "W1nner-Str0ng-P@ss!";
const LOSER_PASSWORD = "L0ser-Str0nger-P@ss!";
const WEAK_PASSWORD = "short";

interface CapturedEvent {
  type: SecurityEventType;
  userId: string;
  success: boolean;
}

/** A security-event sink shaped like the one `AdminAuthService` injects. */
function makeEventSpy(): {
  events: CapturedEvent[];
  onSecurityEvent: (e: CapturedEvent & { timestamp: Date }) => Promise<void>;
} {
  const events: CapturedEvent[] = [];
  return {
    events,
    onSecurityEvent: async (e) => {
      events.push({ type: e.type, userId: e.userId, success: e.success });
    },
  };
}

/**
 * Test-local Prisma-client decorator that makes the STAGGERED interleaving
 * deterministic. The pre-claim read resolves normally and SIGNALS; every consuming
 * write on the admin row awaits a gate the test releases, and records what it
 * matched. Constructor injection IS the seam — production carries no test hook.
 *
 * Both `update` and `updateMany` are gated deliberately: the unmodified tree
 * consumes the token with `update`, and gating only the post-change form would
 * leave the red racing real time instead of a barrier.
 */
function gateConsumingWrites(
  prisma: PrismaClient,
  gate: Promise<void>
): {
  client: PrismaClient;
  preClaimReadDone: Promise<void>;
  writes: Array<{ op: string; count: number | null }>;
} {
  let signal = (): void => {};
  const preClaimReadDone = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const writes: Array<{ op: string; count: number | null }> = [];
  const real = prisma.adminUser as unknown as {
    findFirst: (a: unknown) => Promise<unknown>;
    findUnique: (a: unknown) => Promise<unknown>;
    update: (a: unknown) => Promise<unknown>;
    updateMany: (a: unknown) => Promise<{ count: number }>;
  };
  const client = {
    adminUser: {
      findFirst: async (a: unknown): Promise<unknown> => {
        const row = await real.findFirst(a);
        signal();
        return row;
      },
      // Ungated on purpose: the zero-count disambiguation must observe the row as
      // it stands AFTER the gate is released, which is the state it reports on.
      findUnique: (a: unknown): Promise<unknown> => real.findUnique(a),
      update: async (a: unknown): Promise<unknown> => {
        await gate;
        const result = await real.update(a);
        writes.push({ op: "update", count: null });
        return result;
      },
      updateMany: async (a: unknown): Promise<{ count: number }> => {
        await gate;
        const result = await real.updateMany(a);
        writes.push({ op: "updateMany", count: result.count });
        return result;
      },
    },
    adminSession: prisma.adminSession,
  } as unknown as PrismaClient;
  return { client, preClaimReadDone, writes };
}

interface SeededAdmin {
  id: string;
  token: string;
  priorHash: string;
}

describe("Admin password-reset claim (integration)", () => {
  let prisma: PrismaClient;
  let roleId: string;
  let service: PasswordService;
  const createdAdminIds: string[] = [];

  before(async () => {
    prisma = createSeedPrismaClient();
    // Upsert rather than create: ADMIN is a shared seed row, and this suite must
    // neither depend on it pre-existing nor delete it on the way out.
    const role = await prisma.role.upsert({
      where: { name: "ADMIN" },
      update: {},
      create: { name: "ADMIN" },
    });
    roleId = role.id;
    service = new PasswordService(prisma);
  });

  after(async () => {
    for (const id of createdAdminIds) {
      await prisma.adminSession.deleteMany({ where: { userId: id } });
      await prisma.adminUser.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });

  /**
   * A throwaway admin holding a live reset token and a REAL argon2id password
   * hash — real because the reuse check runs argon2 over the history and a
   * placeholder would exercise a path production never takes.
   */
  async function seedAdmin(
    tag: string,
    overrides: Record<string, unknown> = {}
  ): Promise<SeededAdmin> {
    const priorHash = await hashPassword(`prior-${tag}-P@ssw0rd!`);
    const token = randomUUID();
    const admin = await prisma.adminUser.create({
      data: {
        email: `admin-reset-claim-${tag}@test.invalid`,
        name: `Reset Claim ${tag}`,
        roleId,
        passwordHash: priorHash,
        passwordResetToken: token,
        passwordResetExpires: new Date(Date.now() + HOUR_MS),
        passwordHistory: [],
        ...overrides,
      },
    });
    createdAdminIds.push(admin.id);
    await prisma.adminSession.create({
      data: {
        userId: admin.id,
        refreshTokenHash: `reset-claim-${tag}-${randomUUID()}`,
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    });
    return { id: admin.id, token, priorHash };
  }

  const rowOf = (id: string): Promise<Record<string, unknown>> =>
    prisma.adminUser.findUniqueOrThrow({ where: { id } }) as unknown as Promise<
      Record<string, unknown>
    >;

  it("the claim: two concurrent compare-and-swaps on one token resolve to one count 1 and one count 0", async () => {
    const admin = await seedAdmin(`cas-${Date.now()}`);
    const claim = (next: string): Promise<{ count: number }> =>
      prisma.adminUser.updateMany({
        where: {
          id: admin.id,
          passwordResetToken: admin.token,
          passwordResetExpires: { gt: new Date() },
          isActive: true,
          passwordHash: admin.priorHash,
          passwordHistory: { equals: [] },
        },
        data: {
          passwordHash: next,
          passwordResetToken: null,
          passwordResetExpires: null,
          passwordHistory: [admin.priorHash],
        },
      });

    const [a, b] = await Promise.all([claim("hash-A"), claim("hash-B")]);

    assert.strictEqual(
      [a, b].filter((r) => r.count === 1).length,
      1,
      "exactly one statement matches the row"
    );
    assert.strictEqual(
      [a, b].filter((r) => r.count === 0).length,
      1,
      "the other matches nothing — the predicate named the credential, so the database serialised it"
    );
    const row = await rowOf(admin.id);
    assert.strictEqual(row.passwordResetToken, null, "the token is consumed exactly once");
    assert.ok(
      row.passwordHash === "hash-A" || row.passwordHash === "hash-B",
      "one of the two writers owns the row"
    );
    assert.deepStrictEqual(row.passwordHistory, [admin.priorHash]);
  });

  it("the claim: a refused compare-and-swap writes nothing at all, updatedAt included", async () => {
    const admin = await seedAdmin(`refused-${Date.now()}`);
    const before = await rowOf(admin.id);

    // The snapshot names a history the row does not hold — a concurrent history
    // move. Postgres re-checks exactly the columns the WHERE names, so the
    // statement matches zero rows and performs no write whatsoever.
    const refused = await prisma.adminUser.updateMany({
      where: {
        id: admin.id,
        passwordResetToken: admin.token,
        passwordHash: admin.priorHash,
        passwordHistory: { equals: ["a-history-this-row-never-had"] },
      },
      data: { passwordHash: "must-not-be-written", passwordResetToken: null },
    });

    assert.strictEqual(refused.count, 0, "a moved snapshot matches nothing");
    assert.deepStrictEqual(
      await rowOf(admin.id),
      before,
      "the refused statement touched no column — not even @updatedAt"
    );
  });

  it("service, staggered: a deciding read taken before the winner's claim commits still yields one success", async () => {
    const admin = await seedAdmin(`staggered-${Date.now()}`);
    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const gated = gateConsumingWrites(prisma, gate);
    const loserSpy = makeEventSpy();
    const winnerSpy = makeEventSpy();
    const loser = new PasswordService(gated.client);

    try {
      const loserRun = loser.confirmPasswordReset(
        admin.token,
        LOSER_PASSWORD,
        loserSpy.onSecurityEvent
      );
      // Deterministic ordering, never timing luck: the loser's deciding read is
      // OBSERVED complete before the winner starts, and its consuming write runs
      // only after the gate is released — i.e. after the winner has committed.
      await gated.preClaimReadDone;
      const winnerResult = await service.confirmPasswordReset(
        admin.token,
        WINNER_PASSWORD,
        winnerSpy.onSecurityEvent
      );
      const rowAfterWinner = await rowOf(admin.id);
      releaseGate();
      const loserResult = await loserRun;

      assert.strictEqual(winnerResult.ok, true, "the winner's confirm succeeds");
      assert.strictEqual(loserResult.ok, false, "the staggered loser is refused");
      assert.strictEqual(
        [winnerResult, loserResult].filter((r) => r.ok).length,
        1,
        "one token yields exactly one success"
      );

      const rowAfterLoser = await rowOf(admin.id);
      assert.strictEqual(
        await verifyPassword(rowAfterLoser.passwordHash as string, WINNER_PASSWORD),
        true,
        "the STORED hash verifies against the winner's password"
      );
      assert.strictEqual(
        await verifyPassword(rowAfterLoser.passwordHash as string, LOSER_PASSWORD),
        false,
        "and against no other password presented"
      );
      assert.strictEqual(rowAfterLoser.passwordResetToken, null, "the token is consumed");
      assert.strictEqual(rowAfterLoser.passwordResetExpires, null, "the expiry is consumed");
      assert.deepStrictEqual(
        rowAfterLoser,
        rowAfterWinner,
        "the refused claim changed no column of the row — @updatedAt included"
      );
      assert.strictEqual(
        gated.writes.at(-1)?.count,
        0,
        "the loser's write executed and matched zero rows — it was refused by the claim, not skipped"
      );
      assert.deepStrictEqual(
        winnerSpy.events,
        [{ type: "PASSWORD_RESET_COMPLETED", userId: admin.id, success: true }],
        "the winner emits exactly one completion event"
      );
      assert.deepStrictEqual(loserSpy.events, [], "a refused confirm emits no event");
      const sessions = await prisma.adminSession.findMany({ where: { userId: admin.id } });
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0]?.isActive, false, "the winner revoked the active session");
      assert.strictEqual(sessions[0]?.revokeReason, "PASSWORD_RESET");
    } finally {
      releaseGate();
    }
  });

  it("service, simultaneous: two confirms with DISTINCT passwords yield exactly one success", async () => {
    const admin = await seedAdmin(`simultaneous-${Date.now()}`);
    const spyA = makeEventSpy();
    const spyB = makeEventSpy();

    const [a, b] = await Promise.all([
      service.confirmPasswordReset(admin.token, WINNER_PASSWORD, spyA.onSecurityEvent),
      service.confirmPasswordReset(admin.token, LOSER_PASSWORD, spyB.onSecurityEvent),
    ]);

    assert.strictEqual(
      [a, b].filter((r) => r.ok).length,
      1,
      "exactly one simultaneous confirm wins"
    );
    // Which attempt won is decided by the database, so the expectation is derived
    // from the verdict rather than assumed.
    const winnerPassword = a.ok ? WINNER_PASSWORD : LOSER_PASSWORD;
    const loserPassword = a.ok ? LOSER_PASSWORD : WINNER_PASSWORD;
    const row = await rowOf(admin.id);
    assert.strictEqual(
      await verifyPassword(row.passwordHash as string, winnerPassword),
      true,
      "the stored hash is the winner's"
    );
    assert.strictEqual(
      await verifyPassword(row.passwordHash as string, loserPassword),
      false,
      "the loser's password is not stored"
    );
    assert.strictEqual(row.passwordResetToken, null);
    assert.strictEqual(
      spyA.events.length + spyB.events.length,
      1,
      "exactly one completion event across both callers"
    );
  });

  it("sequential replay: a consumed token is refused with INVALID_TOKEN and changes nothing", async () => {
    const admin = await seedAdmin(`replay-${Date.now()}`);
    const spy = makeEventSpy();

    const first = await service.confirmPasswordReset(
      admin.token,
      WINNER_PASSWORD,
      spy.onSecurityEvent
    );
    assert.strictEqual(first.ok, true);
    const rowAfterFirst = await rowOf(admin.id);

    const replay = await service.confirmPasswordReset(
      admin.token,
      LOSER_PASSWORD,
      spy.onSecurityEvent
    );

    assert.strictEqual(replay.ok, false, "the replay is refused");
    assert.strictEqual(!replay.ok && replay.error, "INVALID_TOKEN");
    assert.deepStrictEqual(
      await rowOf(admin.id),
      rowAfterFirst,
      "the replay changed no column of the row"
    );
    assert.strictEqual(spy.events.length, 1, "the replay emitted no second event");
  });

  it("a history move while the claim is gated is a retryable conflict, and the retry succeeds", async () => {
    const admin = await seedAdmin(`conflict-${Date.now()}`);
    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const gated = gateConsumingWrites(prisma, gate);
    const spy = makeEventSpy();
    const gatedService = new PasswordService(gated.client);

    try {
      const run = gatedService.confirmPasswordReset(
        admin.token,
        WINNER_PASSWORD,
        spy.onSecurityEvent
      );
      await gated.preClaimReadDone;
      // A concurrent `changePassword` advancing the history. The token is left
      // LIVE on purpose: this must not read as a bad token.
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { passwordHistory: [admin.priorHash] },
      });
      releaseGate();
      const conflict = await run;

      assert.strictEqual(conflict.ok, false, "the claim is refused");
      assert.strictEqual(
        !conflict.ok && conflict.error,
        "CONCURRENT_MODIFICATION",
        "a live token whose history moved is a retryable conflict, never INVALID_TOKEN"
      );
      const row = await rowOf(admin.id);
      assert.strictEqual(row.passwordResetToken, admin.token, "the token survives the conflict");
      assert.notStrictEqual(row.passwordResetExpires, null, "the expiry survives the conflict");
      assert.deepStrictEqual(spy.events, [], "a refused confirm emits no event");

      const retry = await service.confirmPasswordReset(
        admin.token,
        WINNER_PASSWORD,
        spy.onSecurityEvent
      );
      assert.strictEqual(retry.ok, true, "nothing consumed the token, so the retry succeeds");
      assert.strictEqual(
        await verifyPassword((await rowOf(admin.id)).passwordHash as string, WINNER_PASSWORD),
        true
      );
    } finally {
      releaseGate();
    }
  });

  it("a weak password is refused without consuming the token", async () => {
    const admin = await seedAdmin(`weak-${Date.now()}`);
    const spy = makeEventSpy();
    const before = await rowOf(admin.id);

    const weak = await service.confirmPasswordReset(
      admin.token,
      WEAK_PASSWORD,
      spy.onSecurityEvent
    );

    assert.strictEqual(!weak.ok && weak.error, "PASSWORD_TOO_WEAK");
    assert.deepStrictEqual(await rowOf(admin.id), before, "a weak password writes nothing");

    const retry = await service.confirmPasswordReset(
      admin.token,
      WINNER_PASSWORD,
      spy.onSecurityEvent
    );
    assert.strictEqual(retry.ok, true, "the SAME token still works afterwards");
  });

  it("a reused password is refused without consuming the token", async () => {
    const reusedHash = await hashPassword(LOSER_PASSWORD);
    const admin = await seedAdmin(`reused-${Date.now()}`, { passwordHistory: [reusedHash] });
    const spy = makeEventSpy();
    const before = await rowOf(admin.id);

    const reused = await service.confirmPasswordReset(
      admin.token,
      LOSER_PASSWORD,
      spy.onSecurityEvent
    );

    assert.strictEqual(!reused.ok && reused.error, "PASSWORD_REUSED");
    assert.deepStrictEqual(await rowOf(admin.id), before, "a reused password writes nothing");

    const retry = await service.confirmPasswordReset(
      admin.token,
      WINNER_PASSWORD,
      spy.onSecurityEvent
    );
    assert.strictEqual(retry.ok, true, "the SAME token still works afterwards");
  });

  it("an expired token is refused and its columns are NOT nulled by the failed attempt", async () => {
    const admin = await seedAdmin(`expired-${Date.now()}`, {
      passwordResetExpires: new Date(Date.now() - HOUR_MS),
    });
    const spy = makeEventSpy();
    const before = await rowOf(admin.id);

    const result = await service.confirmPasswordReset(
      admin.token,
      WINNER_PASSWORD,
      spy.onSecurityEvent
    );

    assert.strictEqual(!result.ok && result.error, "INVALID_TOKEN");
    assert.deepStrictEqual(
      await rowOf(admin.id),
      before,
      "the expired token columns survive the refusal"
    );
    assert.deepStrictEqual(spy.events, []);
  });

  it("a deactivated owner is refused, and neither the token nor the lockout is cleared", async () => {
    const lockedUntil = new Date(Date.now() + HOUR_MS);
    const admin = await seedAdmin(`inactive-${Date.now()}`, {
      isActive: false,
      failedLoginAttempts: 4,
      lockedUntil,
      lockReason: "ADMIN_LOCKED",
    });
    const spy = makeEventSpy();
    const before = await rowOf(admin.id);

    const result = await service.confirmPasswordReset(
      admin.token,
      WINNER_PASSWORD,
      spy.onSecurityEvent
    );

    assert.strictEqual(
      !result.ok && result.error,
      "INVALID_TOKEN",
      "a token issued before deactivation stops working — the signed behaviour change"
    );
    const row = await rowOf(admin.id);
    assert.deepStrictEqual(row, before, "nothing about the row changed");
    assert.strictEqual(row.failedLoginAttempts, 4, "the lockout counter survives");
    assert.strictEqual(row.lockReason, "ADMIN_LOCKED", "the lockout reason survives");
    assert.strictEqual(row.passwordResetToken, admin.token, "the token survives");
    assert.deepStrictEqual(spy.events, []);
  });

  it("a successful confirm clears the lockout — deliberate proof of mailbox control", async () => {
    const admin = await seedAdmin(`lockout-${Date.now()}`, {
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + HOUR_MS),
      lockReason: "BRUTE_FORCE",
    });
    const spy = makeEventSpy();

    const result = await service.confirmPasswordReset(
      admin.token,
      WINNER_PASSWORD,
      spy.onSecurityEvent
    );

    assert.strictEqual(result.ok, true);
    const row = await rowOf(admin.id);
    assert.strictEqual(row.failedLoginAttempts, 0);
    assert.strictEqual(row.lockedUntil, null);
    assert.strictEqual(row.lockReason, null);
    assert.strictEqual(row.mustChangePassword, false);
  });
});
