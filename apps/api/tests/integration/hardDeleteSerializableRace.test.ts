/**
 * @file hardDeleteSerializableRace.test.ts
 * @description Pins the Serializable guarantee of the account hard delete against a REAL
 *              database, with two live connections, THROUGH the composition path.
 *
 *              WHY THIS SUITE EXISTS. The tombstone snapshot and the destruction are two
 *              statements. Between them a concurrent writer can commit a project the
 *              snapshot never saw — and the cascade destroys it anyway, leaving a row that
 *              no durable record describes. Serializable isolation is what makes that
 *              impossible: the transaction aborts instead of committing an unrecorded
 *              destruction.
 *
 *              WHY IT RUNS THROUGH `setupAccountUseCases`. In production the use case opens
 *              the transaction, so the adapter's own `$transaction(..., HARD_DELETE_TX_OPTIONS)`
 *              branch is DEAD: the only live carrier of Serializable isolation is the
 *              `new PrismaUnitOfWork(prisma, HARD_DELETE_TX_OPTIONS)` built in the composition
 *              root. Deleting that second argument left the entire suite green — every unit
 *              test doubles the Unit of Work, so none of them can see an isolation level. This
 *              suite composes the use case with the SAME function the API boots with, so the
 *              guarantee is asserted where it is actually delivered.
 *
 *              THE INTERLEAVING IS DETERMINISTIC, not timed. A second connection takes a
 *              `FOR UPDATE` lock on the account row, then waits — using `pg_blocking_pids`,
 *              so it observes the real lock rather than guessing with a sleep — until the
 *              hard delete is blocked on that exact row. Only then does it insert the racing
 *              project and commit, which is precisely the window the snapshot cannot see.
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestPrismaClient } from "@infra/prisma";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { setupAccountUseCases } from "../../src/infrastructure/container/setupAccountUseCases.js";
import { PrismaAccountRepository } from "../../src/infrastructure/repositories/PrismaAccountRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { HARD_DELETE_TX_OPTIONS } from "../../src/infrastructure/hardDeleteTransaction.js";
import { mapHardDeleteError } from "../../src/lib/hardDeleteErrorMapping.js";
import { withSystemContext } from "../../src/security/tenantContext.js";
import { HardDeleteAccountUseCase } from "@core/accounts/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { toAdminActorId, type AdminActorId } from "@core/domain/value-objects/AdminActorId.js";

/** The deleting connection. */
let prisma: ReturnType<typeof createTestPrismaClient>;
/** The racing connection — a genuinely separate client, not a second call on the same one. */
let racer: ReturnType<typeof createTestPrismaClient>;

let accountId: string;
let admin: AdminActorId;

/** Builds the exact use case the API boots, wired to the real repository. */
function composeUseCase(): HardDeleteAccountUseCase {
  const container = new Container();
  container.register(TOKENS.PrismaClient, () => prisma, true);
  container.register(TOKENS.AccountRepository, () => new PrismaAccountRepository(prisma), true);
  setupAccountUseCases(container);
  return container.resolve<HardDeleteAccountUseCase>(TOKENS.HardDeleteAccountUseCase);
}

/**
 * Resolves once at least one backend is blocked BY `blockerPid`. Scoped to that pid
 * on purpose: a shared development database has unrelated lock waits, and a check
 * that counted them would fire early and race the very window it exists to open.
 */
async function waitUntilBlockedBy(blockerPid: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = await prisma.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting
      FROM pg_stat_activity
      WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
    `;
    if (Number(rows[0]?.waiting ?? 0) > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `the hard delete never blocked on the racer's row lock (pid ${blockerPid}); ` +
          "the interleaving this suite depends on did not happen, so its result would be meaningless"
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Runs `hardDelete` while a second connection commits a new project inside the
 * window between the tombstone snapshot and the destruction.
 *
 * @returns The racing project's id and whatever the hard delete answered.
 */
async function raceAgainstAProjectInsert(
  runHardDelete: () => Promise<{ ok: boolean; error?: { code: string; message: string } }>
): Promise<{
  racedProjectId: string;
  result: { ok: boolean; error?: { code: string; message: string } };
}> {
  let racedProjectId = "";
  let deleteStarted!: () => void;
  const canStartDelete = new Promise<void>((resolve) => {
    deleteStarted = resolve;
  });

  const racing = racer.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      // Hold the account row. The hard delete reads and writes freely until it
      // reaches `DELETE FROM "Account"`, which is where it parks.
      await tx.$executeRaw`SELECT id FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
      deleteStarted();
      await waitUntilBlockedBy(pid);
      const project = await tx.project.create({
        data: { accountId, name: `raced-${randomUUID()}` },
      });
      racedProjectId = project.id;
    },
    { timeout: 60_000 }
  );

  await canStartDelete;
  const [result] = await Promise.all([runHardDelete(), racing]);
  return { racedProjectId, result };
}

describe("hard delete under a concurrent project insert (real DB, two connections)", () => {
  before(async () => {
    prisma = createTestPrismaClient();
    racer = createTestPrismaClient();
    const actor = toAdminActorId("hard-delete-race-suite");
    if (!actor.ok) throw new Error("test setup: invalid admin actor id");
    admin = actor.value;
  });

  after(async () => {
    await prisma.$disconnect();
    await racer.$disconnect();
  });

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        email: `race-${randomUUID()}@omnipost.test`,
        name: "race fixture",
        // Erasure is the SECOND of two deliberate acts, so the subject arrives in
        // the only state a hard delete runs against. Born live, both cases below
        // would answer CONFLICT instead: the first would then take its
        // aborted-delete branch and report green while proving nothing about the
        // Serializable window it exists for, and the second would fail outright.
        // The race itself is unchanged — the tombstone snapshot, the cascade and
        // the row lock behave identically for a soft-deleted account.
        deletedAt: new Date(),
      },
    });
    accountId = account.id;
    await prisma.project.create({ data: { accountId, name: `pre-${randomUUID()}` } });
  });

  afterEach(async () => {
    await prisma.deletionRecord.deleteMany({ where: { accountId } });
    await prisma.account.deleteMany({ where: { id: accountId } });
  });

  it("never destroys a project the tombstone snapshot did not see", async () => {
    const useCase = composeUseCase();
    const { racedProjectId, result } = await raceAgainstAProjectInsert(() =>
      withSystemContext("integration: hard delete race", () =>
        useCase.execute({
          accountId,
          caller: { type: "admin", adminUserId: admin, reason: "serializable race proof" },
        })
      )
    );

    const survivingAccount = await prisma.account.findFirst({ where: { id: accountId } });
    const survivingProject = await prisma.project.findFirst({ where: { id: racedProjectId } });
    const tombstones = await prisma.deletionRecord.findMany({ where: { accountId } });
    const recorded = new Set(tombstones.map((row) => row.entityId));

    // THE INVARIANT, stated once and checked on whichever branch actually happened.
    // Under Serializable the first attempt aborts and the bounded retry runs again on
    // a snapshot that now includes the racing project, so the delete converges WITH a
    // complete tombstone set. Under Read Committed the same interleaving commits: the
    // cascade destroys the racing project while the tombstones — read before it
    // existed — describe only the projects that predate it. That is the destruction
    // no durable record accounts for, and it is what fails here.
    if (survivingAccount === null) {
      assert.ok(
        recorded.has(racedProjectId),
        `project ${racedProjectId} was destroyed by the cascade but no DeletionRecord names it; ` +
          `tombstones present: ${[...recorded].join(", ") || "(none)"}`
      );
      assert.strictEqual(survivingProject, null, "a destroyed account cannot leave its project");
    } else {
      // The other admissible outcome: the transaction aborted and rolled everything
      // back. Then nothing was destroyed and no tombstone may survive either.
      assert.notStrictEqual(survivingProject, null, "an aborted delete destroys nothing");
      assert.strictEqual(tombstones.length, 0, "an aborted delete leaves no tombstone behind");
      assert.ok(!result.ok, "an aborted delete must be reported as a failure, not as success");
    }
  });

  it("reports an exhausted write conflict as TRANSIENT_FAILURE and a 503, from a REAL P2034", async () => {
    // Same composition, one bound changed: a single attempt, so the conflict the retry
    // would otherwise absorb reaches the caller. Everything else — the Serializable
    // Unit of Work, the real repository, the real driver — is the production path, so
    // the error being classified here is a genuine PostgreSQL serialization failure
    // rather than an `Object.assign(new Error(), { code })` a test wrote for itself.
    const useCase = new HardDeleteAccountUseCase(
      new PrismaAccountRepository(prisma),
      new PrismaUnitOfWork(prisma, HARD_DELETE_TX_OPTIONS),
      { attempts: 1 }
    );

    const { result } = await raceAgainstAProjectInsert(() =>
      withSystemContext("integration: hard delete race, no retry", () =>
        useCase.execute({
          accountId,
          caller: { type: "admin", adminUserId: admin, reason: "serializable race proof" },
        })
      )
    );

    assert.ok(!result.ok, "a single attempt that loses the race must not report success");
    assert.strictEqual(
      result.error?.code,
      USE_CASE_ERRORS.TRANSIENT_FAILURE,
      `expected a serialization failure to classify as TRANSIENT_FAILURE, got ${result.error?.code}`
    );

    // And the route's mapping turns that into the retryable status, not a 500.
    const mapped = mapHardDeleteError(
      result.error?.code ?? "",
      result.error?.message ?? "",
      "account"
    );
    assert.strictEqual(mapped.status, 503);

    // Nothing was destroyed: the account and both projects survive, tombstone-free.
    const survivingAccount = await prisma.account.findFirst({ where: { id: accountId } });
    assert.notStrictEqual(survivingAccount, null);
    const tombstones = await prisma.deletionRecord.findMany({ where: { accountId } });
    assert.strictEqual(tombstones.length, 0);
  });
});
