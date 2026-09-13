/**
 * @file adminRefreshRotationClaim.integration.test.ts
 * @description Integration proof that rotating an admin refresh token is a CLAIM on the
 *              token being replaced: one presented refresh token mints AT MOST ONE new
 *              pair, under every interleaving, against a real Postgres row — only a real
 *              row decides atomicity.
 *
 *              Redis is absent BY CONSTRUCTION: this file never calls `setRedisInstance`,
 *              so `hasRedis` stays false, the blacklist path never runs, and the only line
 *              that can refuse a racer is the database claim itself. That is what pins the
 *              racing interleaving BEFORE any blacklist write — explicitly, rather than by
 *              timing luck — and it is what makes a recorded loser count of 0 proof that
 *              the claim executed rather than a cache answering first.
 *
 *              Every single-pair assertion is made against PERSISTED state (the stored
 *              `refreshTokenHash`) and against the pairs actually returned, never against
 *              an error code: where the rotation is keyed on the session id alone both
 *              racers succeed, and the failure shape is TWO ISSUED PAIRS — a green-looking
 *              red that an error-code assertion does not catch.
 *
 *              Login and race run inside one second with no sleep. That is sound only
 *              because every refresh mint carries its own id: without one, two mints of a
 *              single payload inside one second are byte-identical and the loser's
 *              would-be pair IS the winner's, so "the loser's pair appears in no row"
 *              could not be asserted at all.
 *
 *              Drives the real `AuthService` over real adapters — no HTTP, no DI.
 *              Requires Postgres up (`pnpm db:up`); fails loud if the seed channel is
 *              unset, per repo canon.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { AuthService } from "../../src/auth/authService.js";
import { AuthServiceCore } from "../../src/auth/authServiceCore.js";
import { AuthServiceSession } from "../../src/auth/authServiceSession.js";
import { MfaService } from "../../src/admin/auth/MfaService.js";
import { PrismaAdminMfaUserRepository } from "../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaCustomerMfaUserRepository } from "../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaRoleRepository } from "../../src/infrastructure/repositories/PrismaRoleRepository.js";
import { PrismaAdminSessionRepository } from "../../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { hashRefreshToken } from "../../src/auth/refreshTokenHash.js";
import { createSeedPrismaClient, assertSeedChannelConfigured } from "./helpers/seedPrismaClient.js";

// Module scope on purpose: a missing seed channel aborts the file before any test is
// registered, instead of surfacing as N cancelled children of a failed `before`.
assertSeedChannelConfigured();

const PASSWORD = "R0tation-Cl@im-P@ss!";

const prisma = createSeedPrismaClient();

const mfaService = new MfaService(
  new PrismaAdminMfaUserRepository(prisma),
  new PrismaCustomerMfaUserRepository(prisma),
  new PrismaAuditLogRepository(prisma)
);

/** The real-adapter recipe `auth.test.ts` already uses, reused rather than re-derived. */
const authService = new AuthService(
  prisma,
  new PrismaAdminUserRepository(prisma),
  mfaService,
  new PrismaRoleRepository(prisma),
  new PrismaAdminSessionRepository(prisma),
  new PrismaAuditLogRepository(prisma)
);

interface RotationAttempt {
  session: AuthServiceSession;
  /** Every refresh token this attempt MINTED, by value — not a call count. */
  minted: string[];
}

/**
 * One rotation attempt whose mints are recorded BY VALUE. Recording values is what makes
 * "the loser's pair appears in no row" decidable: a call count proves a mint happened but
 * not which token it produced, and the token is the only thing a row can be searched for.
 * The core is built per attempt so two attempts never share a recorder.
 */
function buildRotationAttempt(client: PrismaClient): RotationAttempt {
  const core = new AuthServiceCore(
    new PrismaAdminUserRepository(prisma),
    mfaService,
    new PrismaRoleRepository(prisma),
    new PrismaAdminSessionRepository(prisma),
    new PrismaAuditLogRepository(prisma)
  );
  const minted: string[] = [];
  const mint = core.generateTokens.bind(core);
  core.generateTokens = async (...args: Parameters<AuthServiceCore["generateTokens"]>) => {
    const tokens = await mint(...args);
    minted.push(tokens.refreshToken);
    return tokens;
  };
  return { session: new AuthServiceSession(client, core), minted };
}

/**
 * Test-local Prisma-client decorator that makes the STAGGERED interleaving deterministic.
 * The pre-claim read resolves normally and SIGNALS; every consuming write on the session
 * row awaits a gate the test releases, and records what it matched. Constructor injection
 * IS the seam — production carries no test hook.
 *
 * Both `update` and `updateMany` are gated deliberately: a rotation keyed on the session
 * id alone is written as `update`, and gating only the claim form would leave the red
 * racing real time instead of a barrier.
 */
function gateConsumingWrites(
  realClient: PrismaClient,
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
  const real = realClient.adminSession as unknown as {
    findUnique: (a: unknown) => Promise<unknown>;
    findMany: (a: unknown) => Promise<unknown>;
    update: (a: unknown) => Promise<unknown>;
    updateMany: (a: unknown) => Promise<{ count: number }>;
  };
  const client = {
    adminSession: {
      findUnique: async (a: unknown): Promise<unknown> => {
        const row = await real.findUnique(a);
        signal();
        return row;
      },
      findMany: (a: unknown): Promise<unknown> => real.findMany(a),
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
    adminUser: realClient.adminUser,
  } as unknown as PrismaClient;
  return { client, preClaimReadDone, writes };
}

interface SeededSession {
  userId: string;
  sessionId: string;
  refreshToken: string;
  email: string;
}

describe("Admin refresh-rotation claim (integration)", () => {
  const createdAdminIds: string[] = [];

  before(async () => {
    // Upsert rather than create: ADMIN is a shared seed row, and this suite must neither
    // depend on it pre-existing nor delete it on the way out.
    await prisma.role.upsert({ where: { name: "ADMIN" }, update: {}, create: { name: "ADMIN" } });
  });

  after(async () => {
    for (const id of createdAdminIds) {
      await prisma.adminSession.deleteMany({ where: { userId: id } });
      await prisma.adminUser.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });

  /**
   * A throwaway admin with one live session. No sleep between the login and the rotation
   * that follows: the same-second case is exactly the one the per-mint id makes sound.
   */
  async function seedSession(tag: string): Promise<SeededSession> {
    const email = `admin-refresh-claim-${tag}@test.invalid`;
    const registered = await authService.registerAdmin(
      email,
      PASSWORD,
      `Refresh Claim ${tag}`,
      "ADMIN"
    );
    assert.ok(registered.ok, "the fixture admin is registered");
    createdAdminIds.push(registered.value.id);

    const login = await authService.login({ email, password: PASSWORD }, "127.0.0.1", "Test-Agent");
    assert.ok(login.ok && "user" in login.value, "the fixture admin logs in");
    return {
      userId: registered.value.id,
      sessionId: login.value.tokens.sessionId,
      refreshToken: login.value.tokens.refreshToken,
      email,
    };
  }

  const rowOf = (sessionId: string): Promise<Record<string, unknown>> =>
    prisma.adminSession.findUniqueOrThrow({ where: { id: sessionId } }) as unknown as Promise<
      Record<string, unknown>
    >;

  /** No row anywhere holds the hash of a token the claim refused to store. */
  async function assertMintsUnstored(minted: string[], winnerToken: string): Promise<void> {
    const refused = minted.filter((token) => token !== winnerToken);
    assert.ok(
      refused.length > 0,
      "the refused attempt DID mint a pair — what the claim rejected is the write, not the mint, so this check is not vacuous"
    );
    for (const token of refused) {
      const rows = await prisma.adminSession.count({
        where: { refreshTokenHash: hashRefreshToken(token) },
      });
      assert.strictEqual(rows, 0, "a pair that lost the claim was never stored in any session");
    }
  }

  it("staggered: a deciding read taken before the winner's rotation commits still mints one pair", async () => {
    const seeded = await seedSession(`staggered-${Date.now()}`);
    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const gated = gateConsumingWrites(prisma, gate);
    const loser = buildRotationAttempt(gated.client);
    const winner = buildRotationAttempt(prisma);

    try {
      const loserRun = loser.session.refreshTokens(seeded.refreshToken, "127.0.0.1");
      // Deterministic ordering, never timing luck: the loser's deciding read is OBSERVED
      // complete before the winner starts, and its own write runs only after the gate is
      // released — i.e. after the winner's rotation has committed.
      await gated.preClaimReadDone;
      const winnerResult = await winner.session.refreshTokens(seeded.refreshToken, "127.0.0.1");
      const rowAfterWinner = await rowOf(seeded.sessionId);
      releaseGate();
      const loserResult = await loserRun;

      assert.strictEqual(
        [winnerResult, loserResult].filter((r) => r.ok).length,
        1,
        "one presented refresh token issues exactly one pair"
      );
      assert.ok(winnerResult.ok, "the winner's rotation succeeds");
      assert.strictEqual(loserResult.ok, false, "the staggered loser is refused");
      assert.strictEqual(
        !loserResult.ok && loserResult.error,
        "TOKEN_BLACKLISTED",
        "the in-flight replay verdict comes from the claim, not from a cache lookup — Redis is absent here by construction"
      );
      assert.strictEqual(
        gated.writes.at(-1)?.count,
        0,
        "the loser's rotation executed and matched zero rows — refused by the claim, not skipped"
      );

      const rowAfterLoser = await rowOf(seeded.sessionId);
      assert.strictEqual(
        rowAfterLoser.refreshTokenHash,
        hashRefreshToken(winnerResult.value.refreshToken),
        "the stored hash is the hash of the WINNER's new refresh token"
      );
      assert.notStrictEqual(
        rowAfterLoser.refreshTokenHash,
        hashRefreshToken(seeded.refreshToken),
        "and no longer the hash of the token that was presented"
      );
      assert.deepStrictEqual(
        rowAfterLoser,
        rowAfterWinner,
        "the refused rotation changed no column of the session row — @updatedAt included"
      );
      assert.strictEqual(rowAfterLoser.isActive, true, "the winner's session is still live");
      await assertMintsUnstored(
        [...winner.minted, ...loser.minted],
        winnerResult.value.refreshToken
      );
    } finally {
      releaseGate();
    }
  });

  it("simultaneous: two rotations started before either completes issue exactly one pair", async () => {
    const seeded = await seedSession(`simultaneous-${Date.now()}`);
    const first = buildRotationAttempt(prisma);
    const second = buildRotationAttempt(prisma);

    const [a, b] = await Promise.all([
      first.session.refreshTokens(seeded.refreshToken, "127.0.0.1"),
      second.session.refreshTokens(seeded.refreshToken, "127.0.0.1"),
    ]);

    assert.strictEqual(
      [a, b].filter((r) => r.ok).length,
      1,
      "exactly one simultaneous rotation wins"
    );
    // Which attempt won is decided by the database, so the expectation is derived from the
    // verdict rather than assumed.
    const winner = a.ok ? a : b;
    assert.ok(winner.ok, "the surviving verdict carries the pair");
    const row = await rowOf(seeded.sessionId);
    assert.strictEqual(
      row.refreshTokenHash,
      hashRefreshToken(winner.value.refreshToken),
      "the stored hash matches that pair's refresh token and no other"
    );
    await assertMintsUnstored([...first.minted, ...second.minted], winner.value.refreshToken);
  });

  it("sequential replay: a rotated refresh token is refused and the stored hash stands", async () => {
    const seeded = await seedSession(`replay-${Date.now()}`);
    const attempt = buildRotationAttempt(prisma);

    const rotated = await attempt.session.refreshTokens(seeded.refreshToken, "127.0.0.1");
    assert.ok(rotated.ok, "the first presentation rotates");
    const rowAfterRotation = await rowOf(seeded.sessionId);

    const replay = await attempt.session.refreshTokens(seeded.refreshToken, "127.0.0.1");

    assert.strictEqual(replay.ok, false, "the rotated token is never accepted again");
    assert.strictEqual(
      !replay.ok && replay.error,
      "SESSION_EXPIRED",
      "with the blacklist path inactive a SEQUENTIAL replay is refused at the read — the old hash is gone from the table — so the observed member is SESSION_EXPIRED rather than the in-flight TOKEN_BLACKLISTED. That asymmetry is pre-existing and both map to 401"
    );
    assert.deepStrictEqual(
      await rowOf(seeded.sessionId),
      rowAfterRotation,
      "the replay changed no column of the session row"
    );
    assert.strictEqual(
      rowAfterRotation.refreshTokenHash,
      hashRefreshToken(rotated.value.refreshToken),
      "the row still holds exactly what the successful rotation stored"
    );
  });

  it("the winner's new pair rotates normally — a rotation never blacklists its own output", async () => {
    const seeded = await seedSession(`chain-${Date.now()}`);
    const attempt = buildRotationAttempt(prisma);

    const firstRotation = await attempt.session.refreshTokens(seeded.refreshToken, "127.0.0.1");
    assert.ok(firstRotation.ok, "the presented token rotates");

    const secondRotation = await attempt.session.refreshTokens(
      firstRotation.value.refreshToken,
      "127.0.0.1"
    );

    assert.ok(secondRotation.ok, "the freshly issued refresh token is accepted");
    const row = await rowOf(seeded.sessionId);
    assert.strictEqual(
      row.refreshTokenHash,
      hashRefreshToken(secondRotation.value.refreshToken),
      "the chain advanced to the newest pair"
    );
    assert.strictEqual(row.isActive, true, "the session stayed live across both rotations");
  });

  it("a refused legitimate caller recovers by logging in again, and the winner's session is untouched", async () => {
    const seeded = await seedSession(`recovery-${Date.now()}`);
    const first = buildRotationAttempt(prisma);
    const second = buildRotationAttempt(prisma);

    const [a, b] = await Promise.all([
      first.session.refreshTokens(seeded.refreshToken, "127.0.0.1"),
      second.session.refreshTokens(seeded.refreshToken, "127.0.0.1"),
    ]);
    assert.strictEqual([a, b].filter((r) => r.ok).length, 1, "one of the two concurrent tabs wins");
    const winner = a.ok ? a : b;
    assert.ok(winner.ok, "the surviving verdict carries the pair");
    const rowAfterRace = await rowOf(seeded.sessionId);

    // The named cost of the signed decision: two benign concurrent refreshes now produce
    // one winner and one refused caller, and the refused caller re-authenticates.
    const relogin = await authService.login(
      { email: seeded.email, password: PASSWORD },
      "127.0.0.1",
      "Test-Agent"
    );
    assert.ok(relogin.ok && "user" in relogin.value, "the refused caller logs in again");
    const recovered = await buildRotationAttempt(prisma).session.refreshTokens(
      relogin.value.tokens.refreshToken,
      "127.0.0.1"
    );

    assert.ok(recovered.ok, "the recovered session works — it rotates like any other");
    assert.notStrictEqual(
      relogin.value.tokens.sessionId,
      seeded.sessionId,
      "recovery opens its own session rather than reusing the contested one"
    );
    assert.deepStrictEqual(
      await rowOf(seeded.sessionId),
      rowAfterRace,
      "the winner's session row was never disturbed by the refusal or the recovery"
    );
  });
});
