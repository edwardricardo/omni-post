/**
 * @file sagaCompensationRecovery.test.ts
 * @description MERGE-BLOCKING crash-mid-COMPENSATION proof for the saga engine,
 *   run against a REAL Postgres and a REAL Redis and booted through the REAL
 *   production composition: every manager here is a `SagaIntegration` built the
 *   way the API bootstrap builds it, so the ORDER in which it registers
 *   definitions and initializes the manager is under test alongside the
 *   behaviour.
 *
 *   The property is one an in-memory test cannot reach, because it is about
 *   what the DATABASE holds once the process that owned the walk is gone:
 *
 *     - a process interrupted part-way through a compensation leaves
 *       `COMPENSATING` behind — never `RUNNING` (which the next boot would
 *       drive FORWARD, over state the partial walk already undid) and never a
 *       terminal state (which would claim a rollback that did not happen);
 *     - a process with no memory of it resumes the WALK, in the compensation
 *       direction only, and re-dispatches ONLY the steps with no recorded
 *       completion;
 *     - an operator can re-drive such a row, and the terminal state is read
 *       back FROM THE ROW rather than from the manager that wrote it.
 *
 *   The interruption is produced by a compensation that never returns, and the
 *   "process with no memory" by a SECOND composition with its own step
 *   instances: both are real boundaries, and neither can be faked by resetting
 *   a variable.
 *
 *   PRECONDITION, stated rather than assumed: this suite requires the
 *   `SagaInstance` table to hold NO non-terminal row when it starts, and it
 *   asserts that in `before()` rather than discovering it as a flake. The
 *   reason is not tidiness — each harness boots a real `SagaIntegration`, and a
 *   boot LOADS AND DISPATCHES every non-terminal row in the table, cross-tenant.
 *   A foreign row would therefore be EXECUTED by this suite, so the suite must
 *   own the table for its run: it belongs to a serialized batch
 *   (`integration:saga-recovery`, CONCURRENCY=1), must not share a database
 *   with a concurrent job, and cleans its own fixtures on the way out.
 *
 *   Requires Postgres + Redis up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { createBullMQQueueAdapter, type BullMQQueueAdapter } from "@adapters/queue-bullmq";
import {
  createSagaContext,
  defineSaga,
  type CompensableStep,
  type PivotStep,
  type RetryableStep,
  type SagaContext,
  type SagaDefinition,
  type SagaInstance,
  type SagaStepResult,
} from "@shared/types/saga.js";
import {
  getSystemContext,
  getTenantContext,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import type { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import { CQRSBusImpl } from "../../src/cqrs/CQRSBus.js";
import { EventService } from "../../src/events/EventService.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { ChannelCredentialsCrypto } from "../../src/security/ChannelCredentialsCrypto.js";
import { EncryptionService } from "../../src/security/EncryptionService.js";

const TAG = `saga-comp-${Date.now()}`;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const QUEUE_NAME = `${TAG}-publish`;
const PROBE_SAGA_ID = `${TAG}-compensation-probe`;

/** Compensable steps in the probe definition; the last one is the one that fails. */
const COMPENSABLE_COUNT = 5;
/** Index of the step whose failure triggers the walk. */
const FAILING_INDEX = COMPENSABLE_COUNT - 1;
/** Index whose compensation hangs, modelling the process dying mid-walk. */
const HANGING_INDEX = 1;

/** The persisted stream key for a saga's durable events. */
function sagaStreamId(sagaId: string): string {
  return `stream:Saga:${sagaId}`;
}

/** What one composition's step instances recorded, in the order it happened. */
interface StepJournal {
  executed: number[];
  compensated: number[];
}

/** Builds this composition's OWN step instances — fresh memory, shared database. */
function buildProbeDefinition(journal: StepJournal, options: { hangAt?: number }): SagaDefinition {
  const compensable: CompensableStep[] = Array.from(
    { length: COMPENSABLE_COUNT },
    (_unused, index): CompensableStep => ({
      class: "compensable",
      id: `probe-step-${index}`,
      name: `Probe Step ${index}`,
      async execute(_context: SagaContext): Promise<SagaStepResult> {
        journal.executed.push(index);
        if (index === FAILING_INDEX) {
          return { outcome: "failed", error: `probe step ${index} failed` };
        }
        return {
          outcome: "succeeded",
          data: { stepId: `probe-step-${index}` },
          compensationData: { stepId: `probe-step-${index}` },
        };
      },
      async compensate(_context: SagaContext): Promise<SagaStepResult> {
        journal.compensated.push(index);
        if (options.hangAt === index) {
          // The process "dies" here: a compensation that never returns leaves
          // exactly the durable state a kill would leave, with no write after
          // it and no in-memory copy to hide it.
          await new Promise(() => undefined);
        }
        return { outcome: "succeeded", data: { compensated: index } };
      },
    })
  );

  const pivot: PivotStep = {
    class: "pivot",
    id: "probe-pivot",
    name: "Probe Pivot",
    async execute(): Promise<SagaStepResult> {
      journal.executed.push(COMPENSABLE_COUNT);
      return { outcome: "succeeded" };
    },
  };

  const postPivot: RetryableStep = {
    class: "retryable",
    id: "probe-post-pivot",
    name: "Probe Post Pivot",
    async execute(): Promise<SagaStepResult> {
      journal.executed.push(COMPENSABLE_COUNT + 1);
      return { outcome: "succeeded" };
    },
  };

  // No retry policy: the failing step exhausts immediately, which puts the
  // WALK under test rather than the retry scheduler.
  return defineSaga({
    id: PROBE_SAGA_ID,
    name: "Compensation Recovery Probe",
    version: "1.0.0",
    preCommit: compensable,
    pivot,
    postCommit: [postPivot],
    timeout: 30 * 60 * 1000,
  });
}

/** The saga row fields every assertion below reads. */
interface SagaSnapshot {
  status: string;
  currentStep: number;
  error: string | null;
  compensationResults: unknown;
  updatedAt: Date;
}

/** One production composition under test. */
interface Harness {
  label: string;
  integration: SagaIntegration;
  manager: SagaManagerImpl;
  scheduler: NoopBackgroundTaskScheduler;
  fastify: FastifyInstance;
  subscriber: Redis;
  journal: StepJournal;
}

describe("Saga compensation recovery (MERGE-BLOCKING)", { concurrency: 1 }, () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let redis: Redis;
  let queueConnection: Redis;
  let eventService: EventService;
  let queueAdapter: BullMQQueueAdapter | undefined;

  let accountId: string;
  let customerUserId: string;

  const harnesses: Harness[] = [];
  const createdSagaIds: string[] = [];

  let postRepository: PrismaPostRepository;
  let projectRepository: PrismaProjectRepository;
  let channelRepository: PrismaChannelRepository;

  /**
   * Builds a composition and boots it exactly as the API bootstrap boots it,
   * with THIS process's own step instances registered before the manager
   * initializes — which is where production registers its own.
   */
  async function bootHarness(label: string, options: { hangAt?: number } = {}): Promise<Harness> {
    const scheduler = new NoopBackgroundTaskScheduler();
    const fastify = Fastify({ logger: false });
    const subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    const journal: StepJournal = { executed: [], compensated: [] };

    const cqrsBus = new CQRSBusImpl({
      eventService,
      redis,
      enableMetrics: false,
      enableQueryCache: false,
    });

    const integration = new SagaIntegration({
      fastify,
      prisma: guarded,
      eventService,
      cqrsBus,
      redis,
      sagaSubscriber: subscriber,
      queue: queueAdapter!,
      scheduler,
      projectRepository,
      channelRepository,
      postRepository,
    });

    const manager = integration.getSagaManager();
    manager.registerSaga(buildProbeDefinition(journal, options));

    const harness: Harness = {
      label,
      integration,
      manager,
      scheduler,
      fastify,
      subscriber,
      journal,
    };
    harnesses.push(harness);

    await integration.initialize();
    return harness;
  }

  async function sagaSnapshot(sagaId: string): Promise<SagaSnapshot> {
    return await base.sagaInstance.findUniqueOrThrow({
      where: { id: sagaId },
      select: {
        status: true,
        currentStep: true,
        error: true,
        compensationResults: true,
        updatedAt: true,
      },
    });
  }

  /** Indices whose compensation outcome is DURABLE right now, in index order. */
  function recordedCompensations(snapshot: SagaSnapshot): number[] {
    const results = (snapshot.compensationResults ?? []) as (
      { outcome?: string } | null | undefined
    )[];
    return results
      .map((result, index) => (result ? index : -1))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
  }

  async function pollUntil<T>(
    probe: () => Promise<T | null>,
    describeExpectation: () => string,
    timeoutMs = 20_000
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const answer = await probe();
      if (answer !== null) return answer;
      if (Date.now() > deadline) {
        assert.fail(`timed out after ${timeoutMs}ms waiting for ${describeExpectation()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Starts one probe saga through a harness, under its owning tenant. */
  async function startProbeSaga(harness: Harness, label: string): Promise<SagaInstance> {
    const started = await withTenantContext({ accountId }, () =>
      harness.manager.startSaga(
        PROBE_SAGA_ID,
        createSagaContext({
          sagaId: "",
          correlationId: `corr-${TAG}-${label}`,
          accountId,
          userId: customerUserId,
          metadata: { accountId, source: "compensation-recovery-harness" },
        })
      )
    );
    createdSagaIds.push(started.id);
    return started;
  }

  /** Seeds a durable COMPENSATING row with `recorded` compensations already done. */
  async function seedCompensatingRow(label: string, recorded: number[]): Promise<string> {
    const sagaId = `${TAG}-${label}-${randomUUID()}`;
    createdSagaIds.push(sagaId);
    const stepResults = Array.from({ length: COMPENSABLE_COUNT }, (_unused, index) =>
      index === FAILING_INDEX
        ? { outcome: "failed", error: `probe step ${index} failed` }
        : { outcome: "succeeded", compensationData: { stepId: `probe-step-${index}` } }
    );
    const compensationResults: (SagaStepResult | null)[] = Array.from(
      { length: COMPENSABLE_COUNT },
      (_unused, index) => (recorded.includes(index) ? { outcome: "succeeded" } : null)
    );

    await base.sagaInstance.create({
      data: {
        id: sagaId,
        definitionId: PROBE_SAGA_ID,
        status: "COMPENSATING",
        currentStep: FAILING_INDEX,
        accountId,
        context: {
          sagaId,
          correlationId: `corr-${sagaId}`,
          accountId,
          userId: customerUserId,
          metadata: { accountId, source: "compensation-recovery-harness" },
          stepData: {},
          events: [],
        },
        stepResults,
        compensationResults,
        retryCount: 0,
        error: `probe step ${FAILING_INDEX} failed`,
        startedAt: new Date(),
      },
    });
    return sagaId;
  }

  before(async () => {
    base = createTestPrismaClient();
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    // The boot load spans every tenant by design, so a non-terminal row left
    // behind by ANY other suite would be loaded — and resumed — by the managers
    // below. Determinism has to be a property of the suite rather than of
    // whatever the database happens to hold.
    const foreignInFlight = await base.sagaInstance.findMany({
      where: { status: { in: ["RUNNING", "PENDING", "COMPENSATING"] } },
      select: { id: true, status: true, definitionId: true },
    });
    assert.deepStrictEqual(
      foreignInFlight,
      [],
      "this suite boots real saga managers, and a boot loads and dispatches EVERY non-terminal " +
        "row in the table; the rows listed above predate the run and would be executed by it. " +
        "Clear them (they are residue from an earlier suite or an interrupted run) and re-run."
    );

    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    queueConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

    eventService = new EventService({
      prisma: guarded,
      redis,
      scheduler: new NoopBackgroundTaskScheduler(),
    });
    await eventService.initialize();

    // The probe saga never enqueues, but the composition builds the production
    // post-publishing definition from this adapter, so it is the real one.
    queueAdapter = createBullMQQueueAdapter({
      queueName: QUEUE_NAME,
      connection: queueConnection,
    });

    const account = await base.account.create({
      data: {
        name: `${TAG}-account`,
        email: `${TAG}-${randomUUID()}@test.local`,
        slug: `${TAG}-${randomUUID()}`,
      },
    });
    accountId = account.id;

    const customerUser = await base.customerUser.create({
      data: {
        accountId,
        email: `${TAG}-user-${randomUUID()}@test.local`,
        passwordHash: "ignored-for-test",
        firstName: "Saga",
        lastName: "Compensation",
      },
    });
    customerUserId = customerUser.id;

    postRepository = new PrismaPostRepository(guarded);
    projectRepository = new PrismaProjectRepository(guarded);
    channelRepository = new PrismaChannelRepository(
      guarded,
      new ChannelCredentialsCrypto(new EncryptionService())
    );
  });

  after(async () => {
    for (const harness of harnesses) {
      harness.subscriber.disconnect();
      await harness.fastify.close().catch(() => undefined);
    }

    await queueAdapter?.close().catch(() => undefined);

    await base.sagaInstance
      .deleteMany({
        where: {
          OR: [
            { id: { in: createdSagaIds } },
            ...(typeof accountId === "string" ? [{ accountId }] : []),
          ],
        },
      })
      .catch(() => undefined);
    await base.storedEvent
      .deleteMany({ where: { streamId: { in: createdSagaIds.map(sagaStreamId) } } })
      .catch(() => undefined);

    if (typeof accountId === "string") {
      await base.customerUser.deleteMany({ where: { accountId } }).catch(() => undefined);
      await base.account.deleteMany({ where: { id: accountId } }).catch(() => undefined);
    }

    if (createdSagaIds.length > 0) {
      await redis.del(...createdSagaIds.map((id) => `saga:${id}`)).catch(() => undefined);
    }
    await redis.quit().catch(() => undefined);
    await queueConnection.quit().catch(() => undefined);
    await base.$disconnect();
  });

  it("leaves COMPENSATING behind when the process dies mid-walk, and a fresh process resumes the WALK", async () => {
    const first = await bootHarness("interrupted", { hangAt: HANGING_INDEX });
    const started = await startProbeSaga(first, "interrupted");

    // The walk runs 3, 2 and then hangs inside 1 — which is what a kill looks
    // like from the database's side: two outcomes durable, nothing after.
    const interrupted = await pollUntil(
      async () => {
        const snapshot = await sagaSnapshot(started.id);
        const recorded = recordedCompensations(snapshot);
        return recorded.length === 2 && first.journal.compensated.includes(HANGING_INDEX)
          ? snapshot
          : null;
      },
      () => "the walk to record two compensations and stall inside the third"
    );

    assert.strictEqual(
      interrupted.status,
      "COMPENSATING",
      "a process interrupted mid-walk must leave COMPENSATING: RUNNING would be resumed FORWARD " +
        "by the next boot, over state this walk already undid"
    );
    assert.deepStrictEqual(
      recordedCompensations(interrupted),
      [FAILING_INDEX - 2, FAILING_INDEX - 1],
      "per-step progress is durable as it goes, not once after the loop"
    );
    assert.strictEqual(
      interrupted.error,
      `probe step ${FAILING_INDEX} failed`,
      "the triggering error is on the row, not only in the memory of the process that died"
    );

    // A SECOND composition, with its own step instances: fresh memory, same
    // database. This is the process that inherits the row.
    const second = await bootHarness("inheritor");

    const terminal = await pollUntil(
      async () => {
        const snapshot = await sagaSnapshot(started.id);
        return snapshot.status === "COMPENSATED" ? snapshot : null;
      },
      () => "the inheriting process to finish the interrupted walk"
    );

    assert.deepStrictEqual(
      second.journal.compensated,
      [HANGING_INDEX, HANGING_INDEX - 1],
      "the resumed walk dispatches ONLY the steps with no recorded completion, in reverse order"
    );
    assert.deepStrictEqual(
      second.journal.executed,
      [],
      "no step runs FORWARD in the inheriting process: the failed step is not re-executed and " +
        "the saga's current step is not advanced"
    );
    assert.deepStrictEqual(
      recordedCompensations(terminal),
      [0, 1, 2, 3],
      "every eligible compensable step below the failed one holds a durable outcome"
    );
    assert.strictEqual(
      terminal.currentStep,
      FAILING_INDEX,
      "a resumed walk never advances the saga"
    );
  });

  it("lets an operator re-drive a COMPENSATING row to a terminal state read back from the row", async () => {
    // Seeded AFTER the harness booted, so no boot pass has claimed it: this is
    // the operator's door, not the automatic one.
    const operatorHarness = await bootHarness("operator");
    const sagaId = await seedCompensatingRow("redrive", [FAILING_INDEX - 1, FAILING_INDEX - 2]);

    const accepted = await operatorHarness.manager.compensateSaga(sagaId);
    assert.strictEqual(accepted.id, sagaId, "a COMPENSATING row is accepted for re-drive");

    const terminal = await pollUntil(
      async () => {
        const snapshot = await sagaSnapshot(sagaId);
        return snapshot.status === "COMPENSATED" ? snapshot : null;
      },
      () => "the operator-driven walk to reach a terminal state"
    );

    assert.deepStrictEqual(
      operatorHarness.journal.compensated,
      [1, 0],
      "the re-drive RESUMES from the durable record: the two recorded steps are not re-dispatched"
    );
    assert.deepStrictEqual(
      operatorHarness.journal.executed,
      [],
      "the operator door is the same walk, not a forward run"
    );
    assert.strictEqual(
      terminal.status,
      "COMPENSATED",
      "the terminal state is read back FROM THE ROW, not from the manager that wrote it"
    );
  });
});
