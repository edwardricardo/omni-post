/**
 * @file sagaCompensationWalk.test.ts
 * @description Pins the compensation walk as a DURABLE state machine rather
 *              than an in-memory loop: the row says `COMPENSATING` before any
 *              undo runs, every step's outcome is durable before the next one
 *              starts, a resumed walk skips what it already undid, a walk that
 *              could not finish says so instead of claiming `COMPENSATED`, and
 *              forward execution refuses a row the walk owns.
 *
 *              The engine under test is the REAL one over in-memory doubles:
 *              what a walk PERSISTS, and when, is the whole subject, so a
 *              persistence double that recorded only the last write would make
 *              every scenario here vacuous.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import client from "prom-client";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import {
  defineSaga,
  type CompensableStep,
  type PivotStep,
  type RetryableStep,
  type SagaContext,
  type SagaDefinition,
  type SagaInstance,
  type SagaStepResult,
} from "@shared/types/saga.js";
import { SagaManagerImpl } from "../../../src/saga/SagaManager.js";
import type { SagaManagerLifecycle } from "../../../src/saga/SagaManagerLifecycle.js";
import type { SagaExecutionEngine } from "../../../src/saga/SagaManagerExecution.js";
import {
  createMockEventService,
  createMockPrisma,
  createMockRedis,
  type MockEventService,
  type MockPrismaClient,
} from "../sagaManager.test-helpers.js";

const ACCOUNT_ID = "acc-22222222-2222-4222-8222-222222222222";
const DEFINITION_ID = "compensation-walk-probe";

/** The persisted row, as the double holds it. */
interface StoredRow {
  id: string;
  status: string;
  currentStep: number;
  error?: string | null;
  nextRetryAt?: Date | null;
  updatedAt?: Date;
  stepResults: SagaStepResult[];
  compensationResults: SagaStepResult[];
}

/** What a step saw in the DATABASE at the moment it was asked to compensate. */
interface CompensationObservation {
  stepIndex: number;
  status: string;
  error: string | null | undefined;
  nextRetryAt: Date | null | undefined;
  /** Indices whose compensation was already durable when this step started. */
  durableOutcomes: number[];
}

type CompensateBehavior = "succeed" | "fail" | "throw" | "hang";

/**
 * A compensable step that records what the durable row said when its
 * compensation was invoked.
 *
 * Reading the row from inside `compensate()` is the only way to prove ORDER:
 * an assertion taken after the walk cannot tell "persisted before the next
 * step" from "persisted once at the end".
 */
class ObservingCompensableStep implements CompensableStep {
  readonly class = "compensable" as const;
  executeAttempts = 0;
  compensateAttempts = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly options: {
      index: number;
      executeSucceeds: boolean;
      behavior: CompensateBehavior;
      readRow: () => Promise<StoredRow | null>;
      observations: CompensationObservation[];
    }
  ) {}

  async execute(): Promise<SagaStepResult> {
    this.executeAttempts += 1;
    return this.options.executeSucceeds
      ? { success: true, data: { stepId: this.id }, compensationData: { stepId: this.id } }
      : { success: false, error: `step ${this.id} failed` };
  }

  async compensate(_context: SagaContext, _compensationData?: unknown): Promise<SagaStepResult> {
    this.compensateAttempts += 1;
    const row = await this.options.readRow();
    this.options.observations.push({
      stepIndex: this.options.index,
      status: row?.status ?? "<absent>",
      error: row?.error,
      nextRetryAt: row?.nextRetryAt,
      durableOutcomes: (row?.compensationResults ?? [])
        .map((result, index) => (result ? index : -1))
        .filter((index) => index >= 0),
    });

    if (this.options.behavior === "throw") {
      throw new Error(`compensation for ${this.id} exploded`);
    }
    if (this.options.behavior === "hang") {
      await new Promise(() => undefined);
    }
    return this.options.behavior === "succeed"
      ? { success: true, data: { compensated: this.id } }
      : { success: false, error: `compensation for ${this.id} failed` };
  }
}

/** The pivot every probe definition needs; never reached by these scenarios. */
class ProbePivotStep implements PivotStep {
  readonly class = "pivot" as const;
  readonly id = "probe-pivot";
  readonly name = "Probe Pivot";
  executeAttempts = 0;

  async execute(): Promise<SagaStepResult> {
    this.executeAttempts += 1;
    return { success: true, data: { stepId: this.id } };
  }
}

/** The post-pivot step; its execution would mean the walk went FORWARD. */
class ProbeRetryableStep implements RetryableStep {
  readonly class = "retryable" as const;
  readonly id = "probe-retryable";
  readonly name = "Probe Retryable";
  executeAttempts = 0;

  async execute(): Promise<SagaStepResult> {
    this.executeAttempts += 1;
    return { success: true, data: { stepId: this.id } };
  }
}

interface WalkHarness {
  manager: SagaManagerImpl;
  lifecycle: SagaManagerLifecycle;
  engine: SagaExecutionEngine;
  scheduler: NoopBackgroundTaskScheduler;
  prisma: MockPrismaClient;
  events: MockEventService;
  definition: SagaDefinition;
  steps: ObservingCompensableStep[];
  pivot: ProbePivotStep;
  postPivot: ProbeRetryableStep;
  observations: CompensationObservation[];
  redis: MockRedis;
  row: (sagaId: string) => Promise<StoredRow | null>;
  seed: (row: Partial<StoredRow> & { id: string }) => Promise<void>;
  /** Moves a row's `updatedAt` back, so a stalled walk can be observed. */
  age: (sagaId: string, updatedAt: Date) => Promise<void>;
  /** Makes the next upsert that writes `status` throw, once. */
  failNextWriteOf: (status: string, error: string) => void;
  /** Records when this saga's compensation was born, as the durable event does. */
  seedCompensationStarted: (sagaId: string, at: Date) => Promise<void>;
}

/**
 * The lifecycle and engine behind the facade. Reached through a documented cast
 * because the walk is deliberately not public API: the manager exposes
 * `compensateSaga` (the operator's door) and nothing else, while the scenarios
 * here need to drive the walk and the forward path independently.
 */
function partsOf(manager: SagaManagerImpl): {
  lifecycle: SagaManagerLifecycle;
  engine: SagaExecutionEngine;
} {
  const internals = manager as unknown as {
    lifecycle: SagaManagerLifecycle;
    execution: SagaExecutionEngine;
  };
  return { lifecycle: internals.lifecycle, engine: internals.execution };
}

/**
 * Builds a manager over in-memory doubles with `compensableCount` compensable
 * steps, a pivot and one post-pivot step.
 *
 * @param options.failingIndex - Compensable step whose execute() fails; the
 *   walk it triggers covers every index below it.
 * @param options.behaviors - Per-index compensation behaviour.
 * @param options.withRetryPolicy - When false the first failure exhausts the
 *   budget immediately, which is what puts the walk under test rather than the
 *   retry scheduler.
 */
function createWalkHarness(options: {
  compensableCount: number;
  failingIndex: number;
  behaviors?: Record<number, CompensateBehavior>;
  withRetryPolicy?: boolean;
}): WalkHarness {
  const prisma = createMockPrisma();
  const redis = createMockRedis();
  const events = createMockEventService();
  const scheduler = new NoopBackgroundTaskScheduler();
  const observations: CompensationObservation[] = [];

  // A durable write that fails is not a hypothetical: the transition opens an
  // interactive transaction against the pool the HTTP layer shares, and the
  // storm this slice can produce is exactly when it will not get one.
  let failWriteOfStatus: { status: string; error: string } | undefined;
  const realUpsert = prisma.sagaInstance.upsert.bind(prisma.sagaInstance);
  prisma.sagaInstance.upsert = async (args: {
    where: { id: string };
    create?: { status?: string };
  }): Promise<unknown> => {
    if (failWriteOfStatus && args.create?.status === failWriteOfStatus.status) {
      const message = failWriteOfStatus.error;
      failWriteOfStatus = undefined;
      throw new Error(message);
    }
    return await realUpsert(args);
  };

  const readRow = async (sagaId: string): Promise<StoredRow | null> =>
    (await prisma.sagaInstance.findUnique({ where: { id: sagaId } })) as StoredRow | null;

  let currentSagaId = "";
  const steps = Array.from(
    { length: options.compensableCount },
    (_unused, index) =>
      new ObservingCompensableStep(`step-${index}`, `Compensable Step ${index}`, {
        index,
        executeSucceeds: index !== options.failingIndex,
        behavior: options.behaviors?.[index] ?? "succeed",
        readRow: () => readRow(currentSagaId),
        observations,
      })
  );
  const pivot = new ProbePivotStep();
  const postPivot = new ProbeRetryableStep();

  const definition = defineSaga({
    id: DEFINITION_ID,
    name: "Compensation Walk Probe",
    version: "1.0.0",
    preCommit: steps,
    pivot,
    postCommit: [postPivot],
    timeout: 30 * 60 * 1000,
    ...(options.withRetryPolicy === true && {
      retryPolicy: { maxRetries: 3, backoffMs: 5000, exponential: true },
    }),
  });

  const manager = new SagaManagerImpl({
    prisma: prisma as never,
    redis: redis as never,
    eventService: events as never,
    scheduler,
    enableMetrics: false,
  });
  manager.registerSaga(definition);
  const { lifecycle, engine } = partsOf(manager);

  return {
    manager,
    lifecycle,
    engine,
    scheduler,
    prisma,
    events,
    definition,
    steps,
    pivot,
    postPivot,
    observations,
    redis,
    failNextWriteOf: (status: string, error: string): void => {
      failWriteOfStatus = { status, error };
    },
    seedCompensationStarted: async (sagaId: string, at: Date): Promise<void> => {
      await prisma.storedEvent.create({
        data: {
          streamId: `stream:Saga:${sagaId}`,
          eventType: "saga.compensation.started",
          timestamp: at,
        },
      });
    },
    row: async (sagaId: string): Promise<StoredRow | null> => {
      currentSagaId = sagaId;
      return await readRow(sagaId);
    },
    seed: async (row: Partial<StoredRow> & { id: string }): Promise<void> => {
      currentSagaId = row.id;
      await prisma.sagaInstance.upsert({
        where: { id: row.id },
        create: {
          definitionId: DEFINITION_ID,
          accountId: ACCOUNT_ID,
          context: {
            sagaId: row.id,
            correlationId: `corr-${row.id}`,
            accountId: ACCOUNT_ID,
            metadata: { accountId: ACCOUNT_ID },
            stepData: {},
            events: [],
          },
          stepResults: [],
          compensationResults: [],
          retryCount: 0,
          error: null,
          startedAt: new Date(),
          completedAt: null,
          nextRetryAt: null,
          currentStep: 0,
          status: "COMPENSATING",
          ...row,
        },
      });
    },
    age: async (sagaId: string, updatedAt: Date): Promise<void> => {
      // The column is database-applied on every write, so a test cannot seed it
      // through the ordinary path — the double stamps it exactly as Postgres
      // does. Ageing the stored row is how "this walk stopped writing an hour
      // ago" is expressed without an hour of wall time.
      const stored = (await prisma.sagaInstance.findUnique({ where: { id: sagaId } })) as {
        updatedAt?: Date;
      } | null;
      if (stored) stored.updatedAt = updatedAt;
    },
  };
}

/** Starts a saga through the manager, under its own owning account. */
async function startProbeSaga(harness: WalkHarness): Promise<SagaInstance> {
  const started = await harness.manager.startSaga(DEFINITION_ID, {
    accountId: ACCOUNT_ID,
    metadata: { accountId: ACCOUNT_ID },
  });
  // Bind the row the observing steps read from.
  await harness.row(started.id);
  return started;
}

/** A step result recording a successful compensation of `stepId`. */
function succeededCompensation(stepId: string): SagaStepResult {
  return { success: true, data: { compensated: stepId } };
}

/** Waits until `probe` holds, so a detached walk is observed, never guessed. */
async function until(probe: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Total `saga_recovery_failures_total{stage="compensation"}` right now. */
async function compensationFailureCount(): Promise<number> {
  const metric = client.register.getSingleMetric("saga_recovery_failures_total");
  if (!metric) return 0;
  const collected = await metric.get();
  return collected.values
    .filter((value) => value.labels.stage === "compensation")
    .reduce((total, value) => total + value.value, 0);
}

describe("the compensation walk", () => {
  let baselineFailures = 0;

  beforeEach(async () => {
    baselineFailures = await compensationFailureCount();
  });

  it("persists COMPENSATING, its error and a cleared retry marker BEFORE the first compensate()", async () => {
    const harness = createWalkHarness({ compensableCount: 2, failingIndex: 1 });
    const started = await startProbeSaga(harness);

    await until(
      async () => harness.steps[0]!.compensateAttempts > 0,
      "the walk to reach the first compensable step"
    );

    // The status is written AHEAD of the undo: a process that dies at any
    // point from here on leaves a row that says it was undoing itself.
    const [observed] = harness.observations;
    expect(observed?.status).toBe("COMPENSATING");
    // The triggering error is durable, not only in memory.
    expect(observed?.error).toBe("step step-1 failed");
    // Nulling the retry marker is what removes the row from the retry scan's
    // predicate and from the boot pass's checker-owned branch, so neither
    // reader can convert a compensation into a forward retry.
    expect(observed?.nextRetryAt ?? null).toBeNull();

    await until(
      async () => (await harness.row(started.id))?.status === "COMPENSATED",
      "the walk to settle"
    );
  });

  it("records each step's outcome durably before the next compensate() runs", async () => {
    const harness = createWalkHarness({ compensableCount: 4, failingIndex: 3 });
    const started = await startProbeSaga(harness);

    await until(
      async () => (await harness.row(started.id))?.status === "COMPENSATED",
      "the walk to settle"
    );

    // Walk order is reverse: 2, then 1, then 0 — and each one starts with its
    // successors already durable, so a crash costs at most ONE in-flight step.
    expect(harness.observations.map((observation) => observation.stepIndex)).toEqual([2, 1, 0]);
    expect(harness.observations.map((observation) => observation.durableOutcomes)).toEqual([
      [],
      [2],
      [1, 2],
    ]);
    expect(harness.steps[3]!.compensateAttempts).toBe(0);
  });

  it("skips the steps a previous walk already recorded, and re-dispatches only the rest", async () => {
    const harness = createWalkHarness({ compensableCount: 4, failingIndex: 3 });
    const sagaId = "saga-resumed-walk";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 3,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: true, compensationData: { stepId: "step-1" } },
        { success: true, compensationData: { stepId: "step-2" } },
        { success: false, error: "step step-3 failed" },
      ],
      compensationResults: [
        undefined as unknown as SagaStepResult,
        undefined as unknown as SagaStepResult,
        succeededCompensation("step-2"),
      ],
    });

    await harness.engine.resumeCompensationWalk(sagaId);

    expect(harness.steps[2]!.compensateAttempts).toBe(0);
    expect(harness.steps[1]!.compensateAttempts).toBe(1);
    expect(harness.steps[0]!.compensateAttempts).toBe(1);
    expect((await harness.row(sagaId))?.status).toBe("COMPENSATED");
  });

  it("leaves the row COMPENSATING when a step's compensation fails", async () => {
    const harness = createWalkHarness({
      compensableCount: 3,
      failingIndex: 2,
      behaviors: { 1: "fail" },
    });
    const started = await startProbeSaga(harness);

    await until(
      async () => harness.steps[0]!.compensateAttempts > 0,
      "the walk to run past the failing compensation"
    );

    const row = await harness.row(started.id);
    // Claiming COMPENSATED here is the dishonesty this replaces: the saga is
    // NOT compensated, one of its effects is still standing.
    expect(row?.status).toBe("COMPENSATING");
    expect(await compensationFailureCount()).toBe(baselineFailures + 1);
  });

  it("records a failed compensation as ATTEMPTED, distinct from never attempted", async () => {
    const harness = createWalkHarness({
      compensableCount: 3,
      failingIndex: 2,
      behaviors: { 1: "fail" },
    });
    const started = await startProbeSaga(harness);

    await until(
      async () => harness.steps[0]!.compensateAttempts > 0,
      "the walk to run past the failing compensation"
    );

    const row = await harness.row(started.id);
    // A resumed walk must be able to tell "tried and failed" from "not yet
    // tried"; a hole in the array means the latter.
    expect(row?.compensationResults?.[1]?.success).toBe(false);
    expect(row?.compensationResults?.[2]).toBeUndefined();
  });
});

describe("the write-ahead transition is an ORDERING, never a gate on the undo", () => {
  it("leaves the row COMPENSATING before the walk is even dispatched", async () => {
    const harness = createWalkHarness({ compensableCount: 2, failingIndex: 1 });
    const sagaId = "saga-write-ahead-order";
    await harness.seed({
      id: sagaId,
      status: "RUNNING",
      currentStep: 1,
      stepResults: [{ success: true, compensationData: { stepId: "step-0" } }],
      nextRetryAt: new Date(Date.now() - 60_000),
    });

    // Awaited, so this returns at the exact moment the walk has been QUEUED and
    // not yet run: the crash window the transition exists to close. A defensive
    // transition inside the walk cannot satisfy this — it has not run yet.
    await harness.engine.executeSaga(sagaId);

    const row = await harness.row(sagaId);
    expect(harness.steps[0]!.compensateAttempts).toBe(0);
    expect(row?.status).toBe("COMPENSATING");
    expect(row?.error).toBe("step step-1 failed");
    expect(row?.nextRetryAt ?? null).toBeNull();
  });

  it("still runs the undo when the transition's persist fails", async () => {
    const harness = createWalkHarness({ compensableCount: 2, failingIndex: 1 });
    const before = await compensationFailureCount();
    harness.failNextWriteOf("COMPENSATING", "db write failed");

    const started = await startProbeSaga(harness);
    await until(
      async () => (await harness.row(started.id))?.status === "COMPENSATED",
      "the walk to run and settle despite the failed transition"
    );

    // A durable write that fails must not DELETE the rollback. Pre-change the
    // walk was always dispatched; the write-ahead reorders that, it does not
    // gate it — and the walk's own first per-step persist re-establishes the
    // durable status.
    expect(harness.steps[0]!.compensateAttempts).toBe(1);
    const row = await harness.row(started.id);
    expect(row?.status).toBe("COMPENSATED");
    expect(row?.error).not.toBe("db write failed");
    expect(await compensationFailureCount()).toBe(before + 1);
  });
});

describe("forward execution and the walk never both own a row", () => {
  it("refuses on the DURABLE status even when the hot cache still says RUNNING", async () => {
    const harness = createWalkHarness({ compensableCount: 2, failingIndex: 1 });
    const sagaId = "saga-stale-cache";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 1,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: false, error: "step step-1 failed" },
      ],
    });
    // The cache is written fire-and-forget and the engine is designed to
    // survive losing it, so a pre-transition copy is an ordinary state — and
    // the guard must not be decidable from it.
    await harness.redis.setex(
      `saga:${sagaId}`,
      3600,
      JSON.stringify({
        id: sagaId,
        definitionId: DEFINITION_ID,
        status: "RUNNING",
        currentStep: 1,
        accountId: ACCOUNT_ID,
        context: {
          sagaId,
          correlationId: `corr-${sagaId}`,
          accountId: ACCOUNT_ID,
          metadata: { accountId: ACCOUNT_ID },
          stepData: {},
          events: [],
        },
        stepResults: [{ success: true, compensationData: { stepId: "step-0" } }],
        compensationResults: [],
        startedAt: new Date().toISOString(),
        retryCount: 0,
      })
    );
    const before = await compensationFailureCount();

    await harness.engine.executeSaga(sagaId);

    expect(harness.steps[1]!.executeAttempts).toBe(0);
    expect((await harness.row(sagaId))?.status).toBe("COMPENSATING");
    expect(await compensationFailureCount()).toBe(before + 1);
  });

  it("refuses to advance a saga whose PERSISTED status is COMPENSATING", async () => {
    const harness = createWalkHarness({ compensableCount: 2, failingIndex: 1 });
    const sagaId = "saga-refused-forward";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 1,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: false, error: "step step-1 failed" },
      ],
    });
    const before = await compensationFailureCount();

    await harness.engine.executeSaga(sagaId);

    // Forward execution sets RUNNING unconditionally once it starts, so the
    // refusal has to happen BEFORE it: re-running the failed step over
    // partially-undone state is the defect this whole slice exists to close.
    const row = await harness.row(sagaId);
    expect(row?.status).toBe("COMPENSATING");
    expect(harness.steps[1]!.executeAttempts).toBe(0);
    expect(harness.pivot.executeAttempts).toBe(0);
    expect(await compensationFailureCount()).toBe(before + 1);
  });
});

describe("one walk per saga at a time", () => {
  it("refuses a second walk while one is in flight", async () => {
    const harness = createWalkHarness({
      compensableCount: 3,
      failingIndex: 2,
      behaviors: { 1: "hang" },
    });
    const sagaId = "saga-concurrent-walk";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 2,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: true, compensationData: { stepId: "step-1" } },
        { success: false, error: "step step-2 failed" },
      ],
    });

    void harness.engine.resumeCompensationWalk(sagaId);
    await until(
      async () => harness.steps[1]!.compensateAttempts === 1,
      "the first walk to reach the hanging step"
    );

    await harness.engine.resumeCompensationWalk(sagaId);

    // Two walks over one instance interleave read-modify-write on the SAME
    // compensationResults array: both can observe "not recorded" for a step and
    // invoke compensate() concurrently. Idempotent does not mean concurrent-safe.
    expect(harness.steps[1]!.compensateAttempts).toBe(1);
    expect(harness.steps[0]!.compensateAttempts).toBe(0);
  });

  it("answers the operator with a conflict while a walk is in flight", async () => {
    const harness = createWalkHarness({
      compensableCount: 3,
      failingIndex: 2,
      behaviors: { 1: "hang" },
    });
    const sagaId = "saga-redrive-conflict";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 2,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: true, compensationData: { stepId: "step-1" } },
        { success: false, error: "step step-2 failed" },
      ],
    });

    void harness.engine.resumeCompensationWalk(sagaId);
    await until(
      async () => harness.steps[1]!.compensateAttempts === 1,
      "the walk to reach the hanging step"
    );

    // The alert fires around five minutes and the horizon is thirty, so the
    // runbook actively invites a re-drive while the first walk is still in
    // flight. The endpoint has to say so instead of obliging.
    await expect(harness.manager.compensateSaga(sagaId)).rejects.toThrow(/already/i);
    expect(harness.steps[1]!.compensateAttempts).toBe(1);
  });
});

describe("a concurrent walk cannot regress the durable record", () => {
  it("merges its own outcome BY INDEX into what the row already holds", async () => {
    const harness = createWalkHarness({ compensableCount: 3, failingIndex: 2 });
    const sagaId = "saga-index-merge";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 2,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: true, compensationData: { stepId: "step-1" } },
        { success: false, error: "step step-2 failed" },
      ],
    });
    // Another process recorded step 1 while this one was holding an older copy
    // of the array. Persisting the whole array wholesale erases that success,
    // and the runbook sends a human to undo by hand whatever the record says is
    // missing.
    const instance = await harness.manager.getSaga(sagaId);
    expect(instance).not.toBeNull();
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 2,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: true, compensationData: { stepId: "step-1" } },
        { success: false, error: "step step-2 failed" },
      ],
      compensationResults: [
        undefined as unknown as SagaStepResult,
        { success: true, data: { compensated: "by another walk" } },
      ],
    });

    await harness.engine.resumeCompensationWalk(sagaId);

    const row = await harness.row(sagaId);
    expect(row?.compensationResults?.[1]?.success).toBe(true);
    expect(row?.compensationResults?.[0]?.success).toBe(true);
    expect(row?.status).toBe("COMPENSATED");
    // The step another process already undid is not undone twice.
    expect(harness.steps[1]!.compensateAttempts).toBe(0);
  });

  it("abandons the walk rather than overwrite a row that went terminal", async () => {
    const harness = createWalkHarness({
      compensableCount: 3,
      failingIndex: 2,
      behaviors: { 1: "hang" },
    });
    const sagaId = "saga-terminal-race";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 2,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: true, compensationData: { stepId: "step-1" } },
        { success: false, error: "step step-2 failed" },
      ],
      compensationResults: [
        undefined as unknown as SagaStepResult,
        succeededCompensation("step-1"),
      ],
    });
    // The horizon terminalized this row while the walk was inside a long
    // compensate(). Resurrecting it — COMPENSATING again, then COMPENSATED
    // after SAGA_FAILED — is worse than stopping.
    await harness.seed({ id: sagaId, status: "FAILED", currentStep: 2 });

    await harness.engine.resumeCompensationWalk(sagaId);

    expect((await harness.row(sagaId))?.status).toBe("FAILED");
  });
});

describe("the operator re-drive", () => {
  it("accepts a COMPENSATING row and RESUMES it from durable progress", async () => {
    const harness = createWalkHarness({ compensableCount: 4, failingIndex: 3 });
    const sagaId = "saga-redrive-resume";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 3,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: true, compensationData: { stepId: "step-1" } },
        { success: true, compensationData: { stepId: "step-2" } },
        { success: false, error: "step step-3 failed" },
      ],
      compensationResults: [
        undefined as unknown as SagaStepResult,
        undefined as unknown as SagaStepResult,
        succeededCompensation("step-2"),
      ],
    });

    await expect(harness.manager.compensateSaga(sagaId)).resolves.toMatchObject({ id: sagaId });
    await until(
      async () => (await harness.row(sagaId))?.status === "COMPENSATED",
      "the re-driven walk to settle"
    );

    // The operator's door and the automatic one are the SAME walk with the
    // same progress semantics — a re-drive is not a second code path.
    expect(harness.steps[2]!.compensateAttempts).toBe(0);
    expect(harness.steps[1]!.compensateAttempts).toBe(1);
    expect(harness.steps[0]!.compensateAttempts).toBe(1);
  });

  it("still refuses a terminal saga and dispatches nothing", async () => {
    const harness = createWalkHarness({ compensableCount: 2, failingIndex: 1 });
    const sagaId = "saga-redrive-terminal";
    await harness.seed({ id: sagaId, status: "COMPENSATED", currentStep: 1 });

    await expect(harness.manager.compensateSaga(sagaId)).rejects.toThrow(/not in a/i);
    expect(harness.steps[0]!.compensateAttempts).toBe(0);
  });
});

describe("the COMPENSATING liveness horizon", () => {
  it("terminalizes a stalled walk under a reason naming the compensation, exactly once", async () => {
    const harness = createWalkHarness({
      compensableCount: 2,
      failingIndex: 1,
      behaviors: { 0: "hang" },
    });
    const sagaId = "saga-stalled-walk";
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 1,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: false, error: "step step-1 failed" },
      ],
      startedAt: stale,
    } as Partial<StoredRow> & { id: string });
    await harness.age(sagaId, stale);
    // The walk is stalled inside a compensate() that never returns, which is
    // what "nobody is advancing this row" looks like from the outside.
    harness.lifecycle.activeInstances.set(sagaId, {
      id: sagaId,
      definitionId: DEFINITION_ID,
      status: "COMPENSATING",
      currentStep: 1,
      accountId: ACCOUNT_ID,
      context: {
        sagaId,
        correlationId: `corr-${sagaId}`,
        accountId: ACCOUNT_ID,
        metadata: { accountId: ACCOUNT_ID },
        stepData: {},
        events: [],
      },
      stepResults: [],
      compensationResults: [],
      startedAt: stale,
      retryCount: 0,
      updatedAt: stale,
    } as SagaInstance);
    await harness.lifecycle.initialize();

    await harness.scheduler.triggerTask("saga-timeout-checker");
    const afterFirst = await harness.row(sagaId);
    expect(afterFirst?.status).toBe("FAILED");
    expect(afterFirst?.error).toMatch(/compensat/i);

    const failedEvents = (): number =>
      harness.events.publishedEvents.filter((event) => event.type === "saga.failed").length;
    const afterOne = failedEvents();
    await harness.scheduler.triggerTask("saga-timeout-checker");
    // Exactly once: the terminal transition stops tracking, so the checker has
    // nothing to revisit however many further ticks run.
    expect(failedEvents()).toBe(afterOne);
  });

  it("terminalizes on the ABSOLUTE deadline even when the walk keeps rewriting the row", async () => {
    const harness = createWalkHarness({
      compensableCount: 2,
      failingIndex: 1,
      behaviors: { 0: "hang" },
    });
    const sagaId = "saga-restart-loop";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 1,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: false, error: "step step-1 failed" },
      ],
    });
    // The rollback was born four horizons ago. Every restart re-attempts the
    // same failing compensation and rewrites the row, so the LIVENESS anchor is
    // always fresh — which is exactly how a crash loop defers the terminal
    // guarantee one restart at a time.
    await harness.seedCompensationStarted(sagaId, new Date(Date.now() - 4 * 30 * 60 * 1000));
    harness.lifecycle.activeInstances.set(sagaId, {
      id: sagaId,
      definitionId: DEFINITION_ID,
      status: "COMPENSATING",
      currentStep: 1,
      accountId: ACCOUNT_ID,
      context: {
        sagaId,
        correlationId: `corr-${sagaId}`,
        accountId: ACCOUNT_ID,
        metadata: { accountId: ACCOUNT_ID },
        stepData: {},
        events: [],
      },
      stepResults: [],
      compensationResults: [],
      startedAt: new Date(),
      retryCount: 0,
      updatedAt: new Date(),
    } as SagaInstance);
    await harness.lifecycle.initialize();

    await harness.scheduler.triggerTask("saga-timeout-checker");

    const row = await harness.row(sagaId);
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toMatch(/compensat/i);
  });

  it("still bounds a COMPENSATING row whose definition this process never registered", async () => {
    const harness = createWalkHarness({ compensableCount: 2, failingIndex: 1 });
    const sagaId = "saga-unregistered-definition";
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 1,
      definitionId: "a-definition-this-process-does-not-have",
      startedAt: stale,
    } as Partial<StoredRow> & { id: string });
    await harness.age(sagaId, stale);
    harness.lifecycle.activeInstances.set(sagaId, {
      id: sagaId,
      definitionId: "a-definition-this-process-does-not-have",
      status: "COMPENSATING",
      currentStep: 1,
      accountId: ACCOUNT_ID,
      context: {
        sagaId,
        correlationId: `corr-${sagaId}`,
        accountId: ACCOUNT_ID,
        metadata: { accountId: ACCOUNT_ID },
        stepData: {},
        events: [],
      },
      stepResults: [],
      compensationResults: [],
      startedAt: stale,
      retryCount: 0,
      updatedAt: stale,
    } as SagaInstance);
    await harness.lifecycle.initialize();

    await harness.scheduler.triggerTask("saga-timeout-checker");

    // The runbook and the alert both name "a definition this process has not
    // registered" as an expected cause and promise the horizon terminalizes it.
    // An early return on a missing definition made that promise false for the
    // one class the alert surfaces most.
    expect((await harness.row(sagaId))?.status).toBe("FAILED");
  });

  it("re-reads the fresh row instead of terminalizing on a missing updatedAt", async () => {
    const harness = createWalkHarness({
      compensableCount: 2,
      failingIndex: 1,
      behaviors: { 0: "hang" },
    });
    const sagaId = "saga-no-updatedat";
    await harness.seed({
      id: sagaId,
      status: "COMPENSATING",
      currentStep: 1,
      stepResults: [
        { success: true, compensationData: { stepId: "step-0" } },
        { success: false, error: "step step-1 failed" },
      ],
    });
    // An in-process instance built by `startSaga` carries no `updatedAt` at
    // all. Treating that absence as "fresh" would hide a stalled walk; treating
    // it as "expired" would kill a live one. It is SUSPICIOUS: it routes to the
    // fresh re-read, which is authoritative.
    harness.lifecycle.activeInstances.set(sagaId, {
      id: sagaId,
      definitionId: DEFINITION_ID,
      status: "COMPENSATING",
      currentStep: 1,
      accountId: ACCOUNT_ID,
      context: {
        sagaId,
        correlationId: `corr-${sagaId}`,
        accountId: ACCOUNT_ID,
        metadata: { accountId: ACCOUNT_ID },
        stepData: {},
        events: [],
      },
      stepResults: [],
      compensationResults: [],
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      retryCount: 0,
    } as SagaInstance);
    await harness.lifecycle.initialize();

    await harness.scheduler.triggerTask("saga-timeout-checker");

    const row = await harness.row(sagaId);
    expect(row?.status).toBe("COMPENSATING");
  });
});
