/**
 * @file sagaStepOutcome.test.ts
 * @description Pins the three-state step outcome and the two mechanisms that
 *              rest on it: a step that has not finished costs no retry budget,
 *              and one saga is advanced by one execution at a time.
 *
 *              A step has three possible outcomes — it succeeded, it failed, or
 *              it has not finished yet — and for as long as the contract modelled
 *              two, the publish wait step signalled "the channels are still
 *              going" with the same value it uses for "this step failed". These
 *              scenarios are what makes the difference observable: the budget,
 *              the row's error text, the audit stream, and the number of
 *              executions a burst of sibling events produces.
 *
 *              The engine under test is the REAL one over in-memory doubles;
 *              what it PERSISTS after each outcome is the whole subject.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import client from "prom-client";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { ok, err } from "@shared/types";
import {
  defineSaga,
  WaitForPublishingCompletionStep,
  createSagaContext,
  type CompensableStep,
  type PivotStep,
  type RetryableStep,
  type SagaContext,
  type SagaDefinition,
  type SagaStepResult,
} from "@shared/types/saga.js";
import { SagaManagerImpl } from "../../../src/saga/SagaManager.js";
import type { SagaManagerLifecycle } from "../../../src/saga/SagaManagerLifecycle.js";
import type { SagaExecutionEngine } from "../../../src/saga/SagaManagerExecution.js";
import { deserializeSagaInstanceRow } from "../../../src/saga/sagaInstanceRow.js";
import {
  createMockEventService,
  createMockPrisma,
  createMockRedis,
  type MockEventService,
  type MockPrismaClient,
  type MockRedis,
} from "../sagaManager.test-helpers.js";

const ACCOUNT_ID = "acc-33333333-3333-4333-8333-333333333333";
const DEFINITION_ID = "step-outcome-probe";
const SAGA_TIMEOUT_MS = 30 * 60 * 1000;

/** The persisted row, as the double holds it. */
interface StoredRow {
  id: string;
  status: string;
  currentStep: number;
  retryCount: number;
  error?: string | null;
  nextRetryAt?: Date | null;
  stepResults: SagaStepResult[];
}

/** A pre-pivot step that always succeeds; these scenarios never walk back. */
class ProbeCompensableStep implements CompensableStep {
  readonly class = "compensable" as const;
  readonly id = "probe-compensable";
  readonly name = "Probe Compensable";

  async execute(): Promise<SagaStepResult> {
    return { outcome: "succeeded", data: { stepId: this.id } };
  }

  async compensate(): Promise<SagaStepResult> {
    return { outcome: "succeeded" };
  }
}

/** The point of no return; these scenarios all cross it and stop after it. */
class ProbePivotStep implements PivotStep {
  readonly class = "pivot" as const;
  readonly id = "probe-pivot";
  readonly name = "Probe Pivot";

  async execute(): Promise<SagaStepResult> {
    return { outcome: "succeeded", data: { stepId: this.id } };
  }
}

/**
 * The post-pivot step under test. Its outcome is scripted per attempt, and it
 * observes how many executions of ITSELF overlap — which is how "one advancer
 * per saga" is proven rather than assumed.
 */
class ScriptedRetryableStep implements RetryableStep {
  readonly class = "retryable" as const;
  readonly id = "probe-retryable";
  readonly name = "Probe Retryable";
  attempts = 0;
  inFlight = 0;
  maxInFlight = 0;

  constructor(private readonly script: (attempt: number) => Promise<SagaStepResult>) {}

  async execute(): Promise<SagaStepResult> {
    this.attempts += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      return await this.script(this.attempts);
    } finally {
      this.inFlight -= 1;
    }
  }
}

interface OutcomeHarness {
  manager: SagaManagerImpl;
  lifecycle: SagaManagerLifecycle;
  engine: SagaExecutionEngine;
  scheduler: NoopBackgroundTaskScheduler;
  prisma: MockPrismaClient;
  redis: MockRedis;
  events: MockEventService;
  definition: SagaDefinition;
  step: ScriptedRetryableStep;
  row: (sagaId: string) => Promise<StoredRow | null>;
  /**
   * Makes upserts that would write `status` throw, after letting `spare` of
   * them through — a pass writes its own RUNNING before it re-arms, so the
   * re-arm is only reachable by sparing the first.
   */
  failWritesOf?: (status: string, spare?: number) => void;
  /** How many times the pre-pivot step's compensation ran. */
  compensated?: { attempts: number };
  /** Holds the NEXT durable read inside real I/O for `ms`. */
  delayNextRead?: (ms: number) => void;
}

/**
 * The lifecycle and engine behind the facade, reached through a documented cast
 * for the same reason the walk suite does it: the dispatch entry points are
 * deliberately not public API, and these scenarios drive them directly.
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

function createOutcomeHarness(options: {
  script: (attempt: number) => Promise<SagaStepResult>;
  waitPollMs?: number;
}): OutcomeHarness {
  const prisma = createMockPrisma();
  const redis = createMockRedis();
  const events = createMockEventService();
  const scheduler = new NoopBackgroundTaskScheduler();
  const step = new ScriptedRetryableStep(options.script);

  // A durable write that fails is not hypothetical: the poll re-arm opens a
  // transaction against the pool the HTTP layer shares, and it now runs up to
  // sixty times per saga.
  let failWritesOfStatus: string | undefined;
  let writesToSpare = 0;
  const realUpsert = prisma.sagaInstance.upsert.bind(prisma.sagaInstance);
  prisma.sagaInstance.upsert = async (args: {
    where: { id: string };
    create?: { status?: string };
  }): Promise<unknown> => {
    if (failWritesOfStatus !== undefined && args.create?.status === failWritesOfStatus) {
      if (writesToSpare > 0) writesToSpare--;
      else throw new Error("the database refused the write");
    }
    return await realUpsert(args);
  };

  const definition = defineSaga({
    id: DEFINITION_ID,
    name: "Step Outcome Probe",
    version: "1.0.0",
    preCommit: [new ProbeCompensableStep()],
    pivot: new ProbePivotStep(),
    postCommit: [step],
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
    ...(options.waitPollMs !== undefined && { waitPollMs: options.waitPollMs }),
  });
  manager.registerSaga(definition);
  const { lifecycle, engine } = partsOf(manager);

  return {
    manager,
    lifecycle,
    engine,
    scheduler,
    prisma,
    redis,
    events,
    definition,
    step,
    failWritesOf: (status: string, spare = 0): void => {
      failWritesOfStatus = status;
      writesToSpare = spare;
    },
    row: async (sagaId: string): Promise<StoredRow | null> =>
      (await prisma.sagaInstance.findUnique({ where: { id: sagaId } })) as StoredRow | null,
  };
}

/**
 * A harness whose SCRIPTED step is the pre-pivot one, so a failure that
 * exhausts the budget hands the row to the compensation walk.
 *
 * @param script - The scripted outcome, per attempt.
 */
function createCompensableOutcomeHarness(
  script: (attempt: number) => Promise<SagaStepResult>
): OutcomeHarness {
  const prisma = createMockPrisma();
  const redis = createMockRedis();
  const events = createMockEventService();
  const scheduler = new NoopBackgroundTaskScheduler();
  const scripted = new ScriptedRetryableStep(script);
  const compensated = { attempts: 0 };
  // The step whose effect the walk has to undo. Without one that SUCCEEDED, a
  // walk has nothing eligible to compensate and settles COMPENSATED having done
  // nothing — which would make the hand-off scenarios vacuous.
  const landed: CompensableStep = {
    class: "compensable",
    id: "probe-landed",
    name: "Probe Landed",
    execute: async () => ({
      outcome: "succeeded",
      data: { stepId: "probe-landed" },
      compensationData: { stepId: "probe-landed" },
    }),
    compensate: async () => {
      compensated.attempts += 1;
      return { outcome: "succeeded", data: { compensated: "probe-landed" } };
    },
  };
  const step: CompensableStep = {
    class: "compensable",
    id: scripted.id,
    name: scripted.name,
    execute: () => scripted.execute(),
    compensate: async () => ({ outcome: "succeeded", data: { compensated: scripted.id } }),
  };

  // One slow durable read, on demand. The walk is dispatched with
  // `setImmediate`; without a way to keep a pass inside real I/O, the in-memory
  // doubles always let the walk win the race and the refusal path is never
  // exercised — which is exactly how it stayed unproven.
  let delayNextRead = 0;
  const realFindUnique = prisma.sagaInstance.findUnique.bind(prisma.sagaInstance);
  prisma.sagaInstance.findUnique = async (args: { where: { id: string } }): Promise<unknown> => {
    if (delayNextRead > 0) {
      const waitFor = delayNextRead;
      delayNextRead = 0;
      await new Promise((resolve) => setTimeout(resolve, waitFor));
    }
    return await realFindUnique(args);
  };

  const definition = defineSaga({
    id: DEFINITION_ID,
    name: "Step Outcome Probe",
    version: "1.0.0",
    preCommit: [landed, step],
    pivot: new ProbePivotStep(),
    // No retry policy: the first failure exhausts the budget, which is what
    // puts the compensation transition — and the trailing pass that follows
    // it — under test rather than the retry scheduler.
    postCommit: [],
    timeout: SAGA_TIMEOUT_MS,
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
  const { lifecycle, engine } = partsOf(manager);

  return {
    manager,
    lifecycle,
    engine,
    scheduler,
    prisma,
    redis,
    events,
    definition,
    step: scripted,
    compensated,
    delayNextRead: (ms: number): void => {
      delayNextRead = ms;
    },
    row: async (sagaId: string): Promise<StoredRow | null> =>
      (await prisma.sagaInstance.findUnique({ where: { id: sagaId } })) as StoredRow | null,
  };
}

/** Starts a probe saga and waits for the dispatch its start defers. */
async function startProbeSaga(harness: OutcomeHarness): Promise<string> {
  const started = await harness.manager.startSaga(DEFINITION_ID, {
    accountId: ACCOUNT_ID,
    metadata: { accountId: ACCOUNT_ID },
  });
  await settle();
  return started.id;
}

/** Drains the deferred dispatches the engine schedules with setImmediate. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Waits until `probe` holds, so detached work is observed, never guessed. */
async function until(probe: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Total `saga_recovery_failures_total{stage=…}` right now. */
async function failureCount(stage: string): Promise<number> {
  const metric = client.register.getSingleMetric("saga_recovery_failures_total");
  if (!metric) return 0;
  const collected = await metric.get();
  return collected.values
    .filter((value) => value.labels.stage === stage)
    .reduce((total, value) => total + value.value, 0);
}

/** A context shaped the way the publish saga hands one to its wait step. */
function publishContext(jobIds: string[]): SagaContext {
  const context = createSagaContext({
    sagaId: "saga-wait-probe",
    correlationId: "corr-wait-probe",
    accountId: ACCOUNT_ID,
    metadata: { accountId: ACCOUNT_ID, mode: "publish-now" },
  });
  context.stepData["schedule-publishing-jobs"] = { jobIds, channelCount: jobIds.length };
  return context;
}

describe("the publish wait step reports which of the three outcomes it has", () => {
  const jobIds = ["job-1", "job-2", "job-3", "job-4"];

  it("returns waiting while any sibling job is still pending", async () => {
    const step = new WaitForPublishingCompletionStep(async () =>
      ok({ completed: 3, failed: 0, pending: 1 })
    );

    const result = await step.execute(publishContext(jobIds));

    expect(result.outcome).toBe("waiting");
    expect(result).not.toHaveProperty("error");
  });

  it("returns failed when a job really ended in error", async () => {
    const step = new WaitForPublishingCompletionStep(async () =>
      ok({ completed: 3, failed: 1, pending: 0 })
    );

    const result = await step.execute(publishContext(jobIds));

    expect(result.outcome).toBe("failed");
    expect(result).toMatchObject({ error: expect.stringMatching(/publishing jobs failed/i) });
  });

  it("returns succeeded once every job completed", async () => {
    const step = new WaitForPublishingCompletionStep(async () =>
      ok({ completed: 4, failed: 0, pending: 0 })
    );

    const result = await step.execute(publishContext(jobIds));

    expect(result.outcome).toBe("succeeded");
  });

  it("returns failed — never waiting — when the job status could not be READ at all", async () => {
    // "I could not observe" is not "nothing has finished". Fabricating an
    // all-pending answer for a queue outage makes a dead dependency
    // byte-identical to four channels healthily publishing, at the exact seam
    // the three-state contract exists to disambiguate — and `waiting` spends no
    // budget, so the first external signal would be a timeout half an hour
    // later instead of a step failure in ~35 s.
    const step = new WaitForPublishingCompletionStep(async () => err("CONNECTION_ERROR"));

    const result = await step.execute(publishContext(jobIds));

    expect(result.outcome).toBe("failed");
    expect(result).toMatchObject({ error: expect.stringMatching(/could not be read|CONNECTION/i) });
  });

  it("returns failed — never waiting — when its own scheduling data is missing", async () => {
    const step = new WaitForPublishingCompletionStep(async () =>
      ok({ completed: 0, failed: 0, pending: 0 })
    );
    const context = publishContext([]);
    delete context.stepData["schedule-publishing-jobs"];

    const result = await step.execute(context);

    expect(result.outcome).toBe("failed");
  });
});

describe("a waiting outcome against the retry budget", () => {
  it("leaves the budget, the error and the step index untouched, and the saga non-terminal", async () => {
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "publishing jobs still in progress" }),
    });

    const sagaId = await startProbeSaga(harness);
    // Ask again, twice, exactly as a sibling completion event would.
    await harness.engine.executeSaga(sagaId);
    await harness.engine.executeSaga(sagaId);
    await settle();

    const row = await harness.row(sagaId);
    expect(harness.step.attempts).toBe(3);
    expect(row?.retryCount).toBe(0);
    expect(row?.error ?? null).toBeNull();
    expect(row?.currentStep).toBe(2);
    expect(row?.status).toBe("RUNNING");
  });

  it("keeps an arrangement to ask again, on the dedicated poll cadence", async () => {
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "publishing jobs still in progress" }),
      waitPollMs: 30_000,
    });

    const before = Date.now();
    const sagaId = await startProbeSaga(harness);
    const row = await harness.row(sagaId);

    // The re-arm is a POLL cadence, not an error backoff: the step is not
    // failing, so the interval must not grow with a retry count that never
    // moves.
    const armedFor = (row?.nextRetryAt?.getTime() ?? 0) - before;
    expect(armedFor).toBeGreaterThanOrEqual(29_000);
    expect(armedFor).toBeLessThanOrEqual(35_000);
  });

  it("writes no step event per poll, so the audit stream is not one line per channel check", async () => {
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "publishing jobs still in progress" }),
    });

    const sagaId = await startProbeSaga(harness);
    await harness.engine.executeSaga(sagaId);
    await harness.engine.executeSaga(sagaId);
    await settle();

    const stepEvents = harness.events.publishedEvents.filter(
      (event) => event.type === "saga.step.failed" || event.type === "saga.step.completed"
    );
    // Two: the compensable step and the pivot. The waiting outcomes add none.
    expect(stepEvents).toHaveLength(2);
  });

  it("spends exactly one retry on the failure that follows a run of waits", async () => {
    const harness = createOutcomeHarness({
      script: async (attempt) =>
        attempt <= 3
          ? { outcome: "waiting", reason: "publishing jobs still in progress" }
          : { outcome: "failed", error: "the provider rejected the post" },
    });

    const sagaId = await startProbeSaga(harness);
    await harness.engine.executeSaga(sagaId);
    await harness.engine.executeSaga(sagaId);
    const waitingRow = await harness.row(sagaId);
    expect(waitingRow?.retryCount).toBe(0);

    await harness.engine.executeSaga(sagaId);
    await settle();

    const row = await harness.row(sagaId);
    expect(row?.retryCount).toBe(1);
    // The cause is recorded where the engine records step causes while a retry
    // is still available: on the step's own outcome. The saga row keeps no
    // error until the budget runs out — the waits before it changed neither.
    expect(row?.stepResults[2]).toMatchObject({
      outcome: "failed",
      error: expect.stringMatching(/provider rejected/i),
    });
    expect(row?.status).toBe("RUNNING");
  });

  it("still terminalizes a step that never stops waiting, under a reason naming the timeout", async () => {
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "publishing jobs still in progress" }),
    });

    const sagaId = await startProbeSaga(harness);

    // The checker is a registered background task, so the harness has to be the
    // process that registered it — and the boot pass it runs re-reads the rows
    // it tracks, so the saga is aged AFTER it, on the copy the checker reads.
    await harness.lifecycle.initialize();
    const tracked = harness.lifecycle.activeInstances.get(sagaId);
    expect(tracked).toBeDefined();
    // The saga has been asking the same question since before its horizon.
    tracked!.startedAt = new Date(Date.now() - (SAGA_TIMEOUT_MS + 60_000));

    await harness.scheduler.triggerTask("saga-timeout-checker", { swallowErrors: false });

    const row = await harness.row(sagaId);
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toMatch(/timeout/i);
  });
});

describe("step results persisted before the three-state contract", () => {
  it("normalizes a row's boolean results when it is read back", () => {
    const instance = deserializeSagaInstanceRow({
      id: "saga-legacy-row",
      definitionId: DEFINITION_ID,
      status: "RUNNING",
      currentStep: 2,
      accountId: ACCOUNT_ID,
      context: { sagaId: "saga-legacy-row", stepData: {}, metadata: {}, events: [] },
      stepResults: [
        { success: true, data: { stepId: "one" } },
        { success: false, error: "boom" },
      ],
      compensationResults: [{ success: true, data: { compensated: "one" } }],
      retryCount: 1,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    });

    expect(instance.stepResults[0]).toMatchObject({
      outcome: "succeeded",
      data: { stepId: "one" },
    });
    expect(instance.stepResults[1]).toMatchObject({ outcome: "failed", error: "boom" });
    expect(instance.compensationResults[0]).toMatchObject({ outcome: "succeeded" });
    // Read-side forever: a pre-change row keeps replaying, so nothing about it
    // is rewritten by the normalization itself.
    expect(instance.stepResults[0]).not.toHaveProperty("success");
  });

  it("normalizes the hot-cache copy the same way", async () => {
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "still going" }),
    });
    const sagaId = "saga-legacy-cache";
    await harness.redis.setex(
      `saga:${sagaId}`,
      60,
      JSON.stringify({
        id: sagaId,
        definitionId: DEFINITION_ID,
        status: "RUNNING",
        currentStep: 1,
        accountId: ACCOUNT_ID,
        context: { sagaId, stepData: {}, metadata: {}, events: [] },
        stepResults: [{ success: false, error: "boom" }],
        compensationResults: [{ success: true }],
        retryCount: 2,
        startedAt: new Date().toISOString(),
      })
    );

    const instance = await harness.engine.loadSagaInstance(sagaId);

    expect(instance?.stepResults[0]).toMatchObject({ outcome: "failed", error: "boom" });
    expect(instance?.compensationResults[0]).toMatchObject({ outcome: "succeeded" });
  });
});

describe("one execution advances one saga at a time", () => {
  it("never overlaps two executions of the same saga, however many sources fire at once", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createOutcomeHarness({
      script: async (attempt) => {
        if (attempt === 1) await held;
        return { outcome: "waiting", reason: "publishing jobs still in progress" };
      },
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    // Three independent dispatchers, all while the first execution is inside
    // the step: the retry scan, a worker event and an operator continue.
    const dispatches = [
      harness.engine.executeSaga(sagaId),
      harness.engine.executeSaga(sagaId),
      harness.engine.executeSaga(sagaId),
    ];
    release();
    await Promise.all(dispatches);
    await settle();

    expect(harness.step.maxInFlight).toBe(1);
    // NOT multiplied: three simultaneous arrivals never become three
    // executions. That the arrivals are also not LOST is pinned by the
    // deterministic sibling below ("re-enters a saga that is still moving
    // forward", attempts === 2) — a bound of 2 alone would pass if the
    // dispatches were dropped, so it is deliberately not claimed here.
    expect(harness.step.attempts).toBeLessThanOrEqual(2);
  });

  it("is advanceable again after an execution ends normally", async () => {
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "still going" }),
    });

    const sagaId = await startProbeSaga(harness);
    const first = harness.step.attempts;
    await harness.engine.executeSaga(sagaId);

    expect(harness.step.attempts).toBe(first + 1);
  });

  it("is advanceable again after an execution ends by throwing", async () => {
    const harness = createOutcomeHarness({
      script: async (attempt) => {
        if (attempt === 1) throw new Error("the step exploded");
        return { outcome: "waiting", reason: "still going" };
      },
    });

    const sagaId = await startProbeSaga(harness);
    const afterThrow = harness.step.attempts;
    await harness.engine.executeSaga(sagaId);

    expect(harness.step.attempts).toBe(afterThrow + 1);
  });

  it("leaves a terminal saga refused rather than permanently blocked", async () => {
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "succeeded", data: { done: true } }),
    });

    const sagaId = await startProbeSaga(harness);
    expect((await harness.row(sagaId))?.status).toBe("COMPLETED");

    // The refusal a terminal row gets is the canon re-execution guard, not a
    // guard entry nobody released.
    await harness.engine.executeSaga(sagaId);

    expect(harness.step.attempts).toBe(1);
    expect((await harness.row(sagaId))?.status).toBe("COMPLETED");
  });
});

describe("the trailing rerun decides on the durable row", () => {
  it("refuses to re-enter a saga whose last attempt handed the row to the walk", async () => {
    // The exact hole a coalescing guard opens: a sibling event arrives during
    // the FINAL failing attempt of a pre-pivot step, the attempt exhausts the
    // budget and persists COMPENSATING, and the trailing pass would then
    // re-enter — rewriting COMPENSATING with RUNNING and re-running the failed
    // step over state the walk may already have undone.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createCompensableOutcomeHarness(async (attempt) => {
      if (attempt === 1) await held;
      return { outcome: "failed", error: "the pre-pivot step failed" };
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    const coalesced = harness.engine.executeSaga(sagaId);
    release();
    await coalesced;
    await settle();

    expect(harness.step.attempts).toBe(1);
    // COMPENSATED, not "either": the walk this pass handed off is guaranteed to
    // run — refused mid-pass, it is re-dispatched when the pass releases the
    // saga. A disjunction here would silently absorb a dropped walk.
    await until(
      async () => (await harness.row(sagaId))?.status === "COMPENSATED",
      "the handed-off walk to finish"
    );
  });

  it("re-enters a saga that is still moving forward", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createOutcomeHarness({
      script: async (attempt) => {
        if (attempt === 1) await held;
        return { outcome: "waiting", reason: "still going" };
      },
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    const coalesced = harness.engine.executeSaga(sagaId, "event");
    release();
    await coalesced;
    await settle();

    expect(harness.step.attempts).toBe(2);
    expect((await harness.row(sagaId))?.status).toBe("RUNNING");
  });
});

describe("every advancer is also a terminalizer", () => {
  it("terminalizes a saga past its horizon before advancing it, even when this process never tracked it", async () => {
    // The horizon used to be checked ONLY by the timeout checker, which
    // iterates the tracked set — and nothing tracks a row this process merely
    // loaded by id. While the retry budget was the bound that gap was
    // invisible; a waiting step spends no budget, so an untracked waiting row
    // would be advanced forever and never end. Any advancer is a terminalizer.
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "still going" }),
    });

    const sagaId = await startProbeSaga(harness);
    const attemptsBefore = harness.step.attempts;

    // The row is older than its horizon, and this process does not track it —
    // exactly a row deferred by the boot ceiling, or one whose tracked copy was
    // dropped.
    const agedAt = new Date(Date.now() - (SAGA_TIMEOUT_MS + 60_000));
    const stored = (await harness.prisma.sagaInstance.findUnique({
      where: { id: sagaId },
    })) as { startedAt: Date } | null;
    if (stored) stored.startedAt = agedAt;
    const cached = await harness.redis.get(`saga:${sagaId}`);
    if (cached !== null) {
      await harness.redis.setex(
        `saga:${sagaId}`,
        60,
        JSON.stringify({ ...JSON.parse(cached), startedAt: agedAt.toISOString() })
      );
    }
    harness.lifecycle.activeInstances.delete(sagaId);

    await harness.engine.executeSaga(sagaId);
    await settle();

    const row = await harness.row(sagaId);
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toMatch(/timeout/i);
    expect(harness.step.attempts).toBe(attemptsBefore);
  });

  it("does not strand the tracked copy as FAILED when the terminal persist fails", async () => {
    // `failSaga` mutating the in-memory copy BEFORE its persist means a DB blip
    // leaves the tracked instance FAILED while the row is durably RUNNING — and
    // the timeout checker's terminal guard then silently stops tracking it, so
    // nothing terminalizes the row again for the life of the process.
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "failed", error: "the step failed for good" }),
    });

    const sagaId = await startProbeSaga(harness);
    const tracked = harness.lifecycle.activeInstances.get(sagaId);
    expect(tracked).toBeDefined();

    harness.failWritesOf?.("FAILED");
    await expect(
      harness.engine.failSaga(tracked!, "terminal write that cannot land")
    ).rejects.toThrow();

    // The copy the checker reads still says what the DATABASE says.
    expect(tracked!.status).not.toBe("FAILED");
    const row = await harness.row(sagaId);
    expect(row?.status).not.toBe("FAILED");
    expect(harness.lifecycle.activeInstances.has(sagaId)).toBe(true);
  });
});

describe("a waiting re-arm that cannot be persisted", () => {
  it("keeps the durable marker, counts the failure, and does not terminalize the saga", async () => {
    // The re-arm now runs up to sixty times per saga. If its persist throws
    // into the step loop's catch, a degraded database TERMINALIZES sagas that
    // are merely waiting; and an in-memory marker claiming a re-arm that never
    // landed makes the engine believe it rescheduled work it did not.
    const harness = createOutcomeHarness({
      script: async () => ({ outcome: "waiting", reason: "still going" }),
    });

    const sagaId = await startProbeSaga(harness);
    const armed = (await harness.row(sagaId))?.nextRetryAt;
    const before = await failureCount("wait-poll");

    // Spare the pass's own status write; fail the RE-ARM that follows it.
    harness.failWritesOf?.("RUNNING", 1);
    await harness.engine.executeSaga(sagaId, "scan");
    await settle();

    const row = await harness.row(sagaId);
    expect(row?.status).toBe("RUNNING");
    expect(row?.nextRetryAt?.getTime()).toBe(armed?.getTime());
    expect(await failureCount("wait-poll")).toBe(before + 1);
  });
});

describe("the dispatch that coalesces is the one that carries news", () => {
  it("coalesces a worker event into a trailing pass", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createOutcomeHarness({
      script: async (attempt) => {
        if (attempt === 1) await held;
        return { outcome: "waiting", reason: "still going" };
      },
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    const coalesced = harness.engine.executeSaga(sagaId, "event");
    release();
    await coalesced;
    await settle();

    expect(harness.step.attempts).toBe(2);
  });

  it("does NOT let a scan re-selection schedule one", async () => {
    // The retry scan does not claim the row: it re-selects the SAME due row
    // every five seconds for the whole duration of a pass. Treating that as
    // news turns a slow pass into back-to-back passes — a hot loop that adds
    // load precisely when the system is slow, and that carries no information
    // an event carries.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createOutcomeHarness({
      script: async (attempt) => {
        if (attempt === 1) await held;
        return { outcome: "waiting", reason: "still going" };
      },
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    const reselected = harness.engine.executeSaga(sagaId, "scan");
    release();
    await reselected;
    await settle();

    expect(harness.step.attempts).toBe(1);
  });

  it("does not count a coalescing refusal as a compensation failure", async () => {
    // The compensation series is what an operator pages on for "something this
    // saga did is still standing". A refusal the design calls normal must not
    // dilute it.
    const before = await failureCount("compensation");
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createOutcomeHarness({
      script: async (attempt) => {
        if (attempt === 1) await held;
        return { outcome: "waiting", reason: "still going" };
      },
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    const coalesced = harness.engine.executeSaga(sagaId, "event");
    const alsoCoalesced = harness.engine.executeSaga(sagaId, "event");
    release();
    await Promise.all([coalesced, alsoCoalesced]);
    await settle();

    expect(await failureCount("compensation")).toBe(before);
  });
});

describe("step outcomes persisted in shapes nobody writes any more", () => {
  const readBack = (stepResults: unknown): SagaStepResult[] =>
    deserializeSagaInstanceRow({
      id: "saga-shapes",
      definitionId: DEFINITION_ID,
      status: "RUNNING",
      currentStep: 0,
      accountId: ACCOUNT_ID,
      context: { sagaId: "saga-shapes", stepData: {}, metadata: {}, events: [] },
      stepResults,
      compensationResults: [],
      retryCount: 0,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    }).stepResults;

  it("resolves a mixed shape by its OUTCOME, never by the boolean beside it", () => {
    // The normalizer is documented as read-side FOREVER over "whichever shape
    // the row was written with", so the precedence IS the guarantee. Reading
    // `success` first would turn an unfinished step into a succeeded one — and
    // a succeeded step is what the walk compensates.
    const results = readBack([
      { outcome: "waiting", success: true, reason: "still going" },
      { outcome: "failed", success: true, error: "boom" },
    ]);

    expect(results[0]).toMatchObject({ outcome: "waiting", reason: "still going" });
    expect(results[1]).toMatchObject({ outcome: "failed", error: "boom" });
  });

  it("treats an entry with neither key as a HOLE, not as a failure", () => {
    const results = readBack([{}, { outcome: "skipped" }, null, 7, "nope"]);

    expect(results[0]).toBeUndefined();
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBeUndefined();
    expect(results[3]).toBeUndefined();
    expect(results[4]).toBeUndefined();
  });

  it("reads a column that is not an array at all as no outcomes", () => {
    expect(readBack(null)).toEqual([]);
    expect(readBack({})).toEqual([]);
    expect(readBack([])).toEqual([]);
  });
});

describe("a walk refused by a forward pass is handed off, never dropped", () => {
  it("runs the rollback the failing pass ordered, after the pass releases the saga", async () => {
    // The shape, exactly: an EVENT arrives during the final failing attempt of
    // a pre-pivot step, so the pass ends with a trailing pass pending. The
    // failing attempt persists COMPENSATING and dispatches the walk; the walk's
    // deferred callback then lands while the trailing pass is inside its
    // durable read, and the shared claim refuses it. Nothing else re-drives it:
    // the transition nulls `nextRetryAt` so the scan cannot see the row, boot
    // only runs at startup, and the liveness horizon TERMINALIZES rather than
    // rolls back — the created post would be left standing.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createCompensableOutcomeHarness(async (attempt) => {
      if (attempt === 1) await held;
      return { outcome: "failed", error: "the pre-pivot step failed" };
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    // News arrives mid-attempt: a trailing pass is now pending.
    const coalesced = harness.engine.executeSaga(sagaId, "event");
    // …and that trailing pass will sit inside its durable read for long enough
    // that the walk's deferred dispatch cannot win the race.
    harness.delayNextRead?.(60);
    release();
    await coalesced;

    await until(
      async () => (harness.compensated?.attempts ?? 0) > 0,
      "the handed-off compensation walk to run"
    );
    expect(harness.compensated?.attempts).toBe(1);
    await until(
      async () => (await harness.row(sagaId))?.status === "COMPENSATED",
      "the handed-off walk to settle the row"
    );
  });
});

describe("the operator re-drive answers on what is really happening", () => {
  it("refuses with a conflict while a FORWARD pass still holds the saga", async () => {
    // The conflict gate used to ask "is a WALK in flight?", so a forward holder
    // walked straight through it: the endpoint persisted COMPENSATING,
    // dispatched a walk that the shared claim then refused, and answered the
    // operator with a success envelope for a rollback that had not started —
    // the exact lie the sibling guard exists to prevent for the unscopable
    // case. The walk-holder direction is pinned in the compensation walk suite;
    // this is the forward one.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createCompensableOutcomeHarness(async (attempt) => {
      if (attempt === 1) await held;
      return { outcome: "failed", error: "the pre-pivot step failed" };
    });

    const sagaId = await new Promise<string>((resolve) => {
      void harness.manager
        .startSaga(DEFINITION_ID, { accountId: ACCOUNT_ID, metadata: { accountId: ACCOUNT_ID } })
        .then((started) => resolve(started.id));
    });
    await settle();

    const coalesced = harness.engine.executeSaga(sagaId, "event");
    harness.delayNextRead?.(80);
    release();
    // The row is COMPENSATING by now and a forward pass still holds the claim.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(harness.manager.compensateSaga(sagaId)).rejects.toThrow(
      /already being (advanced|compensated)/i
    );

    await coalesced;
    await until(
      async () => (await harness.row(sagaId))?.status === "COMPENSATED",
      "the handed-off walk to settle the row"
    );
  });
});
