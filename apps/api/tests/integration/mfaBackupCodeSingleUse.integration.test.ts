/**
 * @file mfaBackupCodeSingleUse.integration.test.ts
 * @description Integration tests for the backup-code CLAIM against a real
 *              Postgres — only a real row decides atomicity. A backup code is
 *              claimed at most once for a given `(userId, codeIndex)`, under every
 *              interleaving, and the winner's consumption timestamp is immutable.
 *              Four layers:
 *                - adapter: two concurrent `markBackupCodeUsed(id, index)` on the
 *                  real JSONB used-map resolve to one Ok + one ALREADY_USED, and
 *                  the stored timestamp is the WINNER's (the racers present
 *                  DISTINCT timestamps, so an overwrite would be observable)
 *                - service, simultaneous: two concurrent
 *                  `MfaService.verifyMfaToken` with the same plaintext code yield
 *                  exactly one verified success; the loser is INVALID_TOKEN
 *                - service, STAGGERED (the whole subject): the loser's deciding
 *                  read resolves BEFORE the winner's claim commits and its own
 *                  claim runs AFTER — the interleaving `Promise.all` cannot
 *                  reliably produce and the one an attacker gets for free inside
 *                  the argon2 window. Exactly one session; the refused claim
 *                  changes no column of the row; the refusal alarms and counts
 *                - the sibling-claim residual: two concurrent claims of DIFFERENT
 *                  indices may collide; the refused caller consumed nothing and
 *                  its retry succeeds
 *              Drives the real Prisma MFA adapters + the unified `MfaService`
 *              directly — no HTTP. Requires Postgres up (`pnpm db:up`); fails loud
 *              if `DATABASE_URL` is unset, per repo canon.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { authenticator } from "otplib";
import type { PrismaClient } from "@infra/prisma";
import type { Result } from "@shared/types";
import { PrismaCustomerMfaUserRepository } from "../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { PrismaAdminMfaUserRepository } from "../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaAuditLogRepository } from "../../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { MfaService } from "../../src/admin/auth/MfaService.js";
import type { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import {
  MFA_SUBJECT_TYPE,
  type MfaSubject,
  type MfaUserRecord,
  type MfaUserRepositoryPort,
} from "@ports/core";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";

interface Fixture {
  accountId: string;
  customerId: string;
}

/** A backup-code claim of a subject enrolled for one staggered case. */
interface EnrolledSubject {
  accountId: string;
  customerId: string;
  subject: MfaSubject;
  backupCodes: string[];
}

/** Labels the refusal must carry on the security-threat counter. */
const REUSE_THREAT_LABELS = {
  threat_type: "mfa_backup_code_reuse",
  endpoint: "mfa_verify",
};

/**
 * Pinned, clearly-distinct consumption timestamp for the racer that must LOSE.
 * Pinning it is what makes immutability decidable: if it ever appears in the
 * stored row, the winner's claim was overwritten.
 */
const LOSER_SENTINEL = new Date("2001-09-11T01:02:03.000Z");

/** Metrics collector double shaped like the one the composition root injects. */
function makeMetricsSpy(): {
  securityThreatLabels: Array<Record<string, string>>;
  metrics: ApiMetrics;
} {
  const securityThreatLabels: Array<Record<string, string>> = [];
  const metrics = {
    metrics: {
      securityThreats: {
        inc: (labels: Record<string, string>): void => {
          securityThreatLabels.push(labels);
        },
      },
    },
  } as unknown as ApiMetrics;
  return { securityThreatLabels, metrics };
}

/**
 * Test-local decorator that makes the STAGGERED interleaving deterministic:
 * every method delegates to the real Prisma adapter, and `markBackupCodeUsed`
 * first awaits a gate the test releases, then substitutes a pinned sentinel so an
 * overwrite would be visible in the stored row. Constructor injection IS the
 * seam — production carries no test hook.
 */
class BarrierMfaUserRepository implements MfaUserRepositoryPort {
  readonly decidingReadDone: Promise<void>;
  private readonly signalRead: () => void;

  constructor(
    private readonly inner: MfaUserRepositoryPort,
    private readonly gate: Promise<void>,
    private readonly pinnedUsedAt: Date
  ) {
    let signal = (): void => {};
    this.decidingReadDone = new Promise<void>((resolve) => {
      signal = resolve;
    });
    this.signalRead = signal;
  }

  async findById(userId: string): Promise<Result<MfaUserRecord, "NOT_FOUND">> {
    const found = await this.inner.findById(userId);
    this.signalRead();
    return found;
  }

  async markBackupCodeUsed(
    userId: string,
    codeIndex: number,
    _usedAt: Date
  ): Promise<Result<void, "NOT_FOUND" | "ALREADY_USED">> {
    await this.gate;
    return this.inner.markBackupCodeUsed(userId, codeIndex, this.pinnedUsedAt);
  }

  async saveEnrollment(
    userId: string,
    data: { mfaSecret: string; mfaBackupCodes: string[] }
  ): Promise<Result<void, "NOT_FOUND">> {
    return this.inner.saveEnrollment(userId, data);
  }

  async setMfaEnabled(userId: string, enabled: boolean): Promise<Result<void, "NOT_FOUND">> {
    return this.inner.setMfaEnabled(userId, enabled);
  }

  async replaceBackupCodes(
    userId: string,
    hashedCodes: string[]
  ): Promise<Result<void, "NOT_FOUND">> {
    return this.inner.replaceBackupCodes(userId, hashedCodes);
  }

  async clearMfa(userId: string): Promise<Result<void, "NOT_FOUND">> {
    return this.inner.clearMfa(userId);
  }

  async claimTotpStep(
    userId: string,
    step: number
  ): Promise<Result<"CLAIMED", "NOT_FOUND" | "ALREADY_USED">> {
    return this.inner.claimTotpStep(userId, step);
  }
}

/**
 * Prisma-client decorator that suspends ONE claim between its snapshot read and
 * its compare-and-swap — the sibling-collision window, made deterministic. Only
 * the claim's own snapshot is gated (the `select` that asks for the used-map
 * alone); the deciding read and the count-0 disambiguation pass straight through.
 */
function gateClaimSnapshot(
  prisma: PrismaClient,
  gate: Promise<void>
): { client: PrismaClient; snapshotTaken: Promise<void> } {
  let signal = (): void => {};
  const snapshotTaken = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const real = prisma.customerUser as unknown as {
    findUnique: (args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<unknown>;
  };
  const client = {
    customerUser: {
      findUnique: async (args: {
        where: { id: string };
        select?: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = await real.findUnique(args);
        if (args.select?.mfaBackupUsedAt === true && args.select.id === undefined) {
          signal();
          await gate;
        }
        return row;
      },
      updateMany: (args: unknown): Promise<{ count: number }> => real.updateMany(args),
      update: (args: unknown): Promise<unknown> => real.update(args),
    },
  } as unknown as PrismaClient;
  return { client, snapshotTaken };
}

/** Read the persisted used-map off a raw row. */
function usedMapOf(row: { mfaBackupUsedAt: unknown }): Record<string, string> {
  return (row.mfaBackupUsedAt ?? {}) as Record<string, string>;
}

/**
 * Create a throwaway account + customer and enroll them through the service, so
 * the test holds the plaintext backup codes a login would present.
 */
async function createEnrolledCustomer(
  prisma: PrismaClient,
  service: MfaService,
  tag: string
): Promise<EnrolledSubject> {
  const account = await prisma.account.create({
    data: { email: `${tag}@test.com`, name: `Backup Claim ${tag}` },
  });
  const customer = await prisma.customerUser.create({
    data: {
      accountId: account.id,
      email: `customer-${tag}@test.com`,
      passwordHash: "ignored-for-test",
      firstName: "Claim",
      lastName: "Tester",
    },
  });
  const subject: MfaSubject = { type: MFA_SUBJECT_TYPE.CUSTOMER, id: customer.id };
  const setup = await service.setupMfa(subject);
  assert.strictEqual(setup.ok, true, "setup must succeed");
  if (!setup.ok) throw new Error("unreachable: setup failed after the assertion");
  const enabled = await service.verifyMfaSetup(subject, authenticator.generate(setup.value.secret));
  assert.strictEqual(enabled.ok, true, "verify-setup must succeed");
  return {
    accountId: account.id,
    customerId: customer.id,
    subject,
    backupCodes: setup.value.backupCodes,
  };
}

/** Drop the throwaway rows one case created. */
async function dropAccount(prisma: PrismaClient, accountId: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { accountId } });
  await prisma.customerUser.deleteMany({ where: { accountId } });
  await prisma.account.deleteMany({ where: { id: accountId } });
}

describe("Backup-code single-use (integration)", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;
  let customerRepo: PrismaCustomerMfaUserRepository;

  before(async () => {
    prisma = createSeedPrismaClient();
    customerRepo = new PrismaCustomerMfaUserRepository(prisma);

    const tag = `mfa-backup-su-int-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Backup Single-Use Integration Account" },
    });
    const customer = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Backup",
        lastName: "Tester",
      },
    });

    fixture = { accountId: account.id, customerId: customer.id };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.auditLog.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.account.deleteMany({ where: { id: fixture.accountId } });
    await prisma.$disconnect();
  });

  it("adapter: two concurrent markBackupCodeUsed of the same index resolve to one Ok + one ALREADY_USED", async () => {
    // Fresh row so the used-map starts empty ({} default) — both racers read the
    // same snapshot, so the JSONB-equals CAS decides the winner.
    const tag = `mfa-backup-adapter-${Date.now()}`;
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Backup Adapter CAS Account" },
    });
    const customer = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `adapter-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Adapter",
        lastName: "Tester",
      },
    });

    try {
      await customerRepo.saveEnrollment(customer.id, {
        mfaSecret: "SECRET-CAS",
        mfaBackupCodes: ["$argon2id$hashA", "$argon2id$hashB"],
      });

      // DISTINCT timestamps, deliberately: an assertion over two identical values
      // could not distinguish "preserved" from "overwritten with the same value"
      // and would pass under the defect this suite exists to catch.
      const firstUsedAt = new Date("2026-04-04T10:00:00.000Z");
      const secondUsedAt = new Date("2026-04-04T22:22:22.000Z");
      const [a, b] = await Promise.all([
        customerRepo.markBackupCodeUsed(customer.id, 0, firstUsedAt),
        customerRepo.markBackupCodeUsed(customer.id, 0, secondUsedAt),
      ]);

      const succeeded = [a, b].filter((r) => r.ok).length;
      const alreadyUsed = [a, b].filter((r) => !r.ok && r.error === "ALREADY_USED").length;
      assert.strictEqual(succeeded, 1, "exactly one concurrent claim wins");
      assert.strictEqual(alreadyUsed, 1, "the loser sees ALREADY_USED (single-use)");

      // Which attempt won is decided by the database, so the expectation is
      // derived from the verdict rather than assumed.
      const winnerUsedAt = a.ok ? firstUsedAt : secondUsedAt;
      const loserUsedAt = a.ok ? secondUsedAt : firstUsedAt;
      const row = await prisma.customerUser.findUniqueOrThrow({ where: { id: customer.id } });
      assert.deepStrictEqual(row.mfaBackupUsedAt, { "0": winnerUsedAt.toISOString() });
      assert.ok(
        !JSON.stringify(row).includes(loserUsedAt.toISOString()),
        "the refused attempt's timestamp appears nowhere in the row"
      );
    } finally {
      await prisma.customerUser.deleteMany({ where: { accountId: account.id } });
      await prisma.account.delete({ where: { id: account.id } });
    }
  });

  it("service: two concurrent verifyMfaToken with the same backup code mint exactly one session", async () => {
    const customerRepoLocal = new PrismaCustomerMfaUserRepository(prisma);
    const adminRepo = new PrismaAdminMfaUserRepository(prisma);
    const auditRepo = new PrismaAuditLogRepository(prisma);
    // A REAL Unit of Work: without it the claim never runs inside the transaction
    // the post-claim read-back lives in, so the suite would exercise a path
    // production does not take.
    const service = new MfaService(
      adminRepo,
      customerRepoLocal,
      auditRepo,
      new PrismaUnitOfWork(prisma),
      makeMetricsSpy().metrics
    );
    const subject = { type: MFA_SUBJECT_TYPE.CUSTOMER, id: fixture.customerId } as const;

    // Enroll through the service so we hold the plaintext backup codes.
    const setup = await service.setupMfa(subject);
    assert.strictEqual(setup.ok, true);
    if (!setup.ok) return;
    const enabled = await service.verifyMfaSetup(
      subject,
      authenticator.generate(setup.value.secret)
    );
    assert.strictEqual(enabled.ok, true);

    const backupCode = setup.value.backupCodes[0]!;
    const [a, b] = await Promise.all([
      service.verifyMfaToken(subject, backupCode),
      service.verifyMfaToken(subject, backupCode),
    ]);

    const verified = [a, b].filter((r) => r.ok && r.value.verified).length;
    const rejected = [a, b].filter((r) => !r.ok && r.error === "INVALID_TOKEN").length;
    assert.strictEqual(verified, 1, "exactly one concurrent verification succeeds");
    assert.strictEqual(rejected, 1, "the loser is rejected as INVALID_TOKEN — no second session");

    // The used-map records the single consumed code exactly once.
    const found = await customerRepoLocal.findById(fixture.customerId);
    assert.strictEqual(found.ok, true);
    if (!found.ok) return;
    assert.strictEqual(Object.keys(found.value.mfaBackupUsedAt).length, 1);
  });

  it("service, staggered: a deciding read taken before the winner's commit still mints only one session", async () => {
    const adminRepo = new PrismaAdminMfaUserRepository(prisma);
    const auditRepo = new PrismaAuditLogRepository(prisma);
    const plainRepo = new PrismaCustomerMfaUserRepository(prisma);
    const spy = makeMetricsSpy();
    const winner = new MfaService(
      adminRepo,
      plainRepo,
      auditRepo,
      new PrismaUnitOfWork(prisma),
      spy.metrics
    );
    const enrolled = await createEnrolledCustomer(prisma, winner, `mfa-staggered-${Date.now()}`);
    const backupCode = enrolled.backupCodes[0];
    assert.ok(backupCode, "enrollment must issue at least one backup code");

    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const barrierRepo = new BarrierMfaUserRepository(plainRepo, gate, LOSER_SENTINEL);
    // The loser holds an open transaction while it waits at the gate, so its UoW
    // gets a raised timeout: that wait is this test's own sequencing, never
    // database contention.
    const loser = new MfaService(
      adminRepo,
      barrierRepo,
      auditRepo,
      new PrismaUnitOfWork(prisma, { timeout: 30_000 }),
      spy.metrics
    );

    try {
      const loserRun = loser.verifyMfaToken(enrolled.subject, backupCode);
      // Deterministic ordering, never timing luck: the loser's deciding read is
      // OBSERVED complete before the winner starts (so it passes the service's
      // used-index filter), and its adapter snapshot is taken only after the gate
      // is released — i.e. after the winner's claim has committed.
      await barrierRepo.decidingReadDone;
      const winnerResult = await winner.verifyMfaToken(enrolled.subject, backupCode);
      const rowAfterWinner = await prisma.customerUser.findUniqueOrThrow({
        where: { id: enrolled.customerId },
      });
      releaseGate();
      const loserResult = await loserRun;

      assert.strictEqual(
        winnerResult.ok && winnerResult.value.verified,
        true,
        "the winner verifies"
      );
      assert.strictEqual(loserResult.ok, false, "the staggered loser is refused");
      assert.strictEqual(
        !loserResult.ok && loserResult.error,
        "INVALID_TOKEN",
        "the loser gets the invalid-token verdict — never a second session, never a DB error"
      );
      const verified = [winnerResult, loserResult].filter((r) => r.ok && r.value.verified).length;
      assert.strictEqual(verified, 1, "one backup code mints exactly one session");

      // A refused claim changes NOTHING: the whole row, every column, is the one
      // the winner left behind.
      const rowAfterLoser = await prisma.customerUser.findUniqueOrThrow({
        where: { id: enrolled.customerId },
      });
      assert.deepStrictEqual(
        rowAfterLoser,
        rowAfterWinner,
        "the refused claim changed no column of the row"
      );
      assert.deepStrictEqual(Object.keys(usedMapOf(rowAfterLoser)), ["0"]);
      assert.ok(
        !JSON.stringify(rowAfterLoser).includes(LOSER_SENTINEL.toISOString()),
        "the loser's pinned timestamp appears nowhere in the row"
      );

      // The attack itself raises the alarm — not only its failure.
      const alarms = await prisma.auditLog.findMany({
        where: { accountId: enrolled.accountId, action: "MFA_BACKUP_CODE_REUSE_REJECTED" },
      });
      assert.strictEqual(alarms.length, 1, "the staggered loser raised exactly one HIGH alarm");
      assert.deepStrictEqual(
        spy.securityThreatLabels,
        [REUSE_THREAT_LABELS],
        "the security-threat counter incremented once, with the refusal's labels"
      );
    } finally {
      releaseGate();
      await dropAccount(prisma, enrolled.accountId);
    }
  });

  it("sibling residual: a claim refused by a DIFFERENT index's commit consumes nothing and the retry succeeds", async () => {
    // The accepted false positive, DOCUMENTED here rather than engineered around:
    // two concurrent claims of different indices for the same user can collide.
    // The loser alarms without earning it, but its code stays unconsumed — an
    // availability blip, never a lost credential.
    const adminRepo = new PrismaAdminMfaUserRepository(prisma);
    const auditRepo = new PrismaAuditLogRepository(prisma);
    const plainRepo = new PrismaCustomerMfaUserRepository(prisma);
    const spy = makeMetricsSpy();
    const service = new MfaService(
      adminRepo,
      plainRepo,
      auditRepo,
      new PrismaUnitOfWork(prisma),
      spy.metrics
    );
    const enrolled = await createEnrolledCustomer(prisma, service, `mfa-sibling-${Date.now()}`);
    const [firstCode, siblingCode] = enrolled.backupCodes;
    assert.ok(firstCode && siblingCode, "enrollment must issue at least two backup codes");

    let releaseGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    // The sibling runs WITHOUT a Unit of Work on purpose: the gate lives in the
    // injected client, and a UoW would route the adapter onto the transaction
    // client instead, leaving the collision window unreachable.
    const gated = gateClaimSnapshot(prisma, gate);
    const sibling = new MfaService(
      adminRepo,
      new PrismaCustomerMfaUserRepository(gated.client),
      auditRepo,
      undefined,
      spy.metrics
    );

    try {
      const siblingRun = sibling.verifyMfaToken(enrolled.subject, siblingCode);
      // The sibling's claim snapshot is taken BEFORE the other claim commits, and
      // its compare-and-swap runs after — the collision window, made explicit.
      await gated.snapshotTaken;
      const firstResult = await service.verifyMfaToken(enrolled.subject, firstCode);
      releaseGate();
      const siblingResult = await siblingRun;

      assert.strictEqual(
        firstResult.ok && firstResult.value.verified,
        true,
        "the claim that committed first verifies"
      );
      assert.strictEqual(
        !siblingResult.ok && siblingResult.error,
        "INVALID_TOKEN",
        "the sibling claim is refused — the documented false positive"
      );

      const between = await prisma.customerUser.findUniqueOrThrow({
        where: { id: enrolled.customerId },
      });
      assert.deepStrictEqual(
        Object.keys(usedMapOf(between)),
        ["0"],
        "the sibling's index was absent from the stored map between the two attempts"
      );

      const retry = await service.verifyMfaToken(enrolled.subject, siblingCode);
      assert.strictEqual(
        retry.ok && retry.value.verified,
        true,
        "the refused sibling's retry succeeds — its code was never consumed"
      );
      const after = await prisma.customerUser.findUniqueOrThrow({
        where: { id: enrolled.customerId },
      });
      assert.deepStrictEqual(Object.keys(usedMapOf(after)).sort(), ["0", "1"]);
    } finally {
      releaseGate();
      await dropAccount(prisma, enrolled.accountId);
    }
  });
});
