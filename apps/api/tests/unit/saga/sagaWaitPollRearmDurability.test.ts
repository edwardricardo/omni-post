/**
 * @file sagaWaitPollRearmDurability.test.ts
 * @description Pins what the engine leaves behind when a waiting step's poll
 *              re-arm cannot be persisted, split by the one fact that decides
 *              the outcome: whether the ROW already carries a scheduled
 *              re-entry.
 *
 *              The retry scan selects on `nextRetryAt: { lte: now, not: null }`.
 *              A saga entering the wait step for the FIRST time holds no marker
 *              — the step before it cleared one on its way forward — so a
 *              re-arm that fails there leaves a durable RUNNING row the scan can
 *              never select, while a re-arm that fails LATER leaves a row the
 *              scan still selects on the schedule it already holds. Those are
 *              opposite outcomes, and for as long as the engine took the same
 *              branch for both, it reported the safe one for the unsafe case.
 *
 *              The engine under test is the REAL one over in-memory doubles;
 *              what it PERSISTS, and what it CLAIMS about the row, are the
 *              whole subject.
 * @layer infrastructure
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  defineSaga,
  type CompensableStep,
  type PivotStep,
  type RetryableStep,
  type SagaDefinition,
  type SagaStepResult,
} from "@shared/types/saga.js";
import { SagaManagerImpl } from "../../../src/saga/SagaManager.js";
import type { SagaExecutionEngine } from "../../../src/saga/SagaManagerExecution.js";
import { logger } from "../../../src/lib/logger.js";
import {
  createMockEventService,
  createMockPrisma,
  createMockRedis,
  type MockPrismaClient,
} from "../sagaManager.test-helpers.js";

const ACCOUNT_ID = "acc-44444444-4444-4444-8444-444444444444";
const DEFINITION_ID = "wait-poll-rearm-probe";
const SAGA_TIMEOUT_MS = 30 * 60 * 1000;

/** The persisted row, as the double holds it. */
interface StoredRow {
  status: string;
  currentStep: number;
  nextRetryAt?: Date | null;
}

/** A pre-pivot step that always succeeds; these scenarios never walk back. */
const probeCompensable: CompensableStep = {
  class: "compensable",
  id: "probe-compensable",
  name: "Probe Compensable",
  execute: async () => ({ outcome: "succeeded", data: { stepId: "probe-compensable" } }),
  compensate: async () => ({ outcome: "succeeded" }),
};

/** The point of no return. Crossing it is what CLEARS the marker on the row. */
const probePivot: PivotStep = {
  class: "pivot",
  id: "probe-pivot",
  name: "Probe Pivot",
  execute: async () => ({ outcome: "succeeded", data: { stepId: "probe-pivot" } }),
};

/** The post-pivot step under test: it never finishes, so it only ever re-arms. */
const probeWaiting: RetryableStep = {
  class: "retryable",
  id: "probe-waiting",
  name: "Probe Waiting",
  execute: async (): Promise<SagaStepResult> => ({
    outcome: "waiting",
    reason: "publishing jobs still in progress",
  }),
};

interface RearmHarness {
  manager: SagaManagerImpl;
  engine: SagaExecutionEngine;
  prisma: MockPrismaClient;
  /**
   * Refuses the next `count` writes carrying a poll marker, after letting
   * `spare` of them through. A pass re-writes its own status before it re-arms,
   * and on a LATER entry that write already carries the marker the row holds —
   * so reaching the re-arm there means sparing the first.
   */
  refuseArmingWrites: (count: number, spare?: number) => void;
  row: (sagaId: string) => Promise<StoredRow | null>;
}

/**
 * The engine behind the facade, reached through a documented cast for the same
 * reason the sibling suites do it: the dispatch entry points are deliberately
 * not public API, and these scenarios drive them directly.
 *
 * @param manager - The saga manager whose engine is under test.
 * @returns The execution engine.
 */
function engineOf(manager: SagaManagerImpl): SagaExecutionEngine {
  return (manager as unknown as { execution: SagaExecutionEngine }).execution;
}

/**
 * A harness that can refuse exactly the write that arms a poll marker.
 *
 * Targeting the ARMING write rather than a status is what makes the first-entry
 * case reachable: every other write in a pass either clears the marker or omits
 * it, so `nextRetryAt` being a Date identifies the re-arm and nothing else.
 *
 * @returns The harness.
 */
function createRearmHarness(): RearmHarness {
  const prisma = createMockPrisma();
  const redis = createMockRedis();
  const events = createMockEventService();
  const scheduler = new NoopBackgroundTaskScheduler();

  let armingWritesToRefuse = 0;
  let armingWritesToSpare = 0;
  const realUpsert = prisma.sagaInstance.upsert.bind(prisma.sagaInstance);
  prisma.sagaInstance.upsert = async (args: {
    where: { id: string };
    create?: { nextRetryAt?: Date };
  }): Promise<unknown> => {
    if (armingWritesToRefuse > 0 && args.create?.nextRetryAt instanceof Date) {
      if (armingWritesToSpare > 0) {
        armingWritesToSpare--;
      } else {
        armingWritesToRefuse--;
        throw new Error("the database refused the write");
      }
    }
    return await realUpsert(args);
  };

  const definition: SagaDefinition = defineSaga({
    id: DEFINITION_ID,
    name: "Wait Poll Re-arm Probe",
    version: "1.0.0",
    preCommit: [probeCompensable],
    pivot: probePivot,
    postCommit: [probeWaiting],
    timeout: SAGA_TIMEOUT_MS,
    retryPolicy: { maxRetries: 3, backoffMs: 5000, exponential: true },
  });

  const manager = new SagaManagerImpl({
    prisma: prisma as never,
    redis: redis as never,
    eventService: events as never,
    scheduler,
    enableMetrics: false,
    defaultTimeout: SAGA_TIMEOUT_MS,
  });
  manager.registerSaga(definition);

  return {
    manager,
    engine: engineOf(manager),
    prisma,
    refuseArmingWrites: (count: number, spare = 0): void => {
      armingWritesToRefuse = count;
      armingWritesToSpare = spare;
    },
    row: async (sagaId: string): Promise<StoredRow | null> =>
      (await prisma.sagaInstance.findUnique({ where: { id: sagaId } })) as StoredRow | null,
  };
}

/** Drains the deferred dispatches the engine schedules with setImmediate. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Starts a probe saga and waits for the dispatch its start defers, which is the
 * pass that walks it to the waiting step and arms the poll for the first time.
 *
 * @param harness - The harness under test.
 * @returns The started saga's id.
 */
async function startProbeSaga(harness: RearmHarness): Promise<string> {
  const started = await harness.manager.startSaga(DEFINITION_ID, {
    accountId: ACCOUNT_ID,
    metadata: { accountId: ACCOUNT_ID },
  });
  await settle();
  return started.id;
}

/** The re-arm's own failure log line, or undefined when it never fired. */
function rearmFailureLog(
  spy: ReturnType<typeof vi.spyOn>
): { context: Record<string, unknown>; message: string } | undefined {
  for (const call of spy.mock.calls) {
    const [context, message] = call as [Record<string, unknown>, string];
    if (typeof message === "string" && message.includes("could not be re-armed")) {
      return { context, message };
    }
  }
  return undefined;
}

describe("a waiting re-arm that cannot be persisted on FIRST entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still leaves a row carrying the scheduled re-entry the retry scan selects on", async () => {
    // The row this pass writes is the ONLY thing the retry scan reads. Entering
    // the wait step, the row carries no marker, so a re-arm that is abandoned
    // after one refused write leaves `nextRetryAt` NULL — outside the scan's
    // predicate for the rest of this process's life, with nothing scheduled to
    // put it back.
    const harness = createRearmHarness();
    harness.refuseArmingWrites(1);

    const sagaId = await startProbeSaga(harness);

    const row = await harness.row(sagaId);
    expect(row?.status).toBe("RUNNING");
    expect(row?.nextRetryAt).toBeInstanceOf(Date);
  });

  it("does not claim an existing schedule when the row carries none", async () => {
    // The claim is the second half of the defect: an operator reading "re-selected
    // on the existing schedule" stops looking, and the saga sits non-terminal
    // until the timeout horizon force-fails it half an hour later.
    const harness = createRearmHarness();
    harness.refuseArmingWrites(Number.MAX_SAFE_INTEGER);
    const errors = vi.spyOn(logger, "error").mockImplementation(() => logger);

    const sagaId = await startProbeSaga(harness);

    const row = await harness.row(sagaId);
    expect(row?.nextRetryAt ?? null).toBeNull();

    const logged = rearmFailureLog(errors);
    expect(logged, "the re-arm failure must be reported").toBeDefined();
    expect(logged?.context.sagaId).toBe(sagaId);
    expect(logged?.context.durableSchedule).toBe("none");
    expect(logged?.message).not.toContain("existing schedule");
  });
});

describe("a waiting re-arm that cannot be persisted on a LATER entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the marker the row already holds, and says exactly that", async () => {
    // The other branch, unchanged: a row that already carries a marker is still
    // selected by the scan on that schedule, so the failed write costs one
    // cadence rather than the poll. Pinned here so the first-entry fix cannot
    // be mistaken for a blanket retry of every re-arm.
    const harness = createRearmHarness();
    const sagaId = await startProbeSaga(harness);
    const armed = (await harness.row(sagaId))?.nextRetryAt;
    expect(armed).toBeInstanceOf(Date);

    const errors = vi.spyOn(logger, "error").mockImplementation(() => logger);
    // Spare the pass's own status write; refuse the RE-ARM that follows it.
    harness.refuseArmingWrites(Number.MAX_SAFE_INTEGER, 1);
    await harness.engine.executeSaga(sagaId, "scan");
    await settle();

    const row = await harness.row(sagaId);
    expect(row?.nextRetryAt?.getTime()).toBe(armed?.getTime());

    const logged = rearmFailureLog(errors);
    expect(logged, "the re-arm failure must be reported").toBeDefined();
    expect(logged?.context.durableSchedule).toBe("preserved");
  });
});
