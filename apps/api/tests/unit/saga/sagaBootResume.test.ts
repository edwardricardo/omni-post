/**
 * @file sagaBootResume.test.ts
 * @description Pins the containment and the bounds of the boot recovery pass:
 *              one unreadable row costs one saga's recovery and never the pass
 *              or the process; a row whose definition this process has not
 *              registered gets its own disposition; a boot in which EVERY row is
 *              unregistered is reported as the composition defect it is rather
 *              than as a fleet of stuck sagas; the load has a ceiling and names
 *              what it deferred; the dispatch honours the configured
 *              concurrency; and a parked row is not written to.
 *
 *              It also carries what a process really does with a row a crash
 *              left mid-automatic-compensation, exercised against the REAL
 *              execution engine through both readers that can reach such a row
 *              (the boot pass and the retry scan).
 * @layer infrastructure
 */
import { describe, it, expect, vi, type MockInstance } from "vitest";
import client from "prom-client";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import type {
  CompensableStep,
  PivotStep,
  RetryableStep,
  SagaContext,
  SagaDefinition,
  SagaInstance,
  SagaStepResult,
} from "@shared/types/saga.js";
import { defineSaga } from "@shared/types/saga.js";
import { SagaManagerLifecycle } from "../../../src/saga/SagaManagerLifecycle.js";
import { SagaManagerImpl } from "../../../src/saga/SagaManager.js";
import { logger } from "../../../src/lib/logger.js";
import {
  createMockEventService,
  createMockPrisma,
  createMockRedis,
  type MockPrismaClient,
} from "../sagaManager.test-helpers.js";
import type {
  SagaExecutionEnginePort,
  SagaManagerConfig,
} from "../../../src/saga/sagaManagerTypes.js";

const ACCOUNT_ID = "acc-11111111-1111-4111-8111-111111111111";
const DEFINITION_ID = "post-publishing-saga";
const PIVOT_STEP_INDEX = 2;

/** The persisted row shape the boot load reads, as this suite seeds it. */
interface SeededRow {
  id: string;
  definitionId: string;
  status: string;
  currentStep: number;
  accountId: string | null;
  context: unknown;
  stepResults: unknown;
  compensationResults: unknown;
  retryCount: number;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  nextRetryAt: Date | null;
}

/** A well-formed row: a saga interrupted before its pivot. */
function makeRow(id: string, overrides: Partial<SeededRow> = {}): SeededRow {
  return {
    id,
    definitionId: DEFINITION_ID,
    status: "RUNNING",
    currentStep: 1,
    accountId: ACCOUNT_ID,
    context: {
      sagaId: id,
      correlationId: `corr-${id}`,
      accountId: ACCOUNT_ID,
      metadata: { accountId: ACCOUNT_ID },
      stepData: {},
      events: [],
    },
    stepResults: [],
    compensationResults: [],
    retryCount: 0,
    error: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: null,
    nextRetryAt: null,
    ...overrides,
  };
}

/**
 * A row whose persisted context lost its `metadata` object — a legacy row, a
 * hand-repaired row, a partial restore. The deserializer casts the JSON without
 * checking it, so tenant resolution dereferences `context.metadata.accountId`
 * and throws while the row is being classified.
 */
function makePoisonRow(id: string): SeededRow {
  return makeRow(id, { context: { sagaId: id, correlationId: `corr-${id}`, stepData: {} } });
}

/** The minimal saga definition the pass consults for its pivot boundary. */
function makeDefinition(): SagaDefinition {
  return {
    id: DEFINITION_ID,
    name: "Post Publishing Saga",
    version: "2.0.0",
    steps: [],
    pivotStepIndex: PIVOT_STEP_INDEX,
    timeout: 30 * 60 * 1000,
  } as unknown as SagaDefinition;
}

interface EngineSpy extends SagaExecutionEnginePort {
  executed: string[];
  compensated: string[];
  persisted: string[];
  peakConcurrency: number;
}

/**
 * An execution engine that records what the pass asked of it, and how much of it
 * at once. `executeSaga` yields to the event loop before resolving, so a pass
 * that dispatched everything in one go would register a peak equal to the whole
 * batch.
 */
function createEngineSpy(rows: SeededRow[] = []): EngineSpy {
  const executed: string[] = [];
  const compensated: string[] = [];
  const persisted: string[] = [];
  const inFlightWalks = new Set<string>();
  let inFlight = 0;
  const spy: EngineSpy = {
    executed,
    compensated,
    persisted,
    peakConcurrency: 0,
    executeSagaAsync: (sagaId: string): void => {
      void spy.executeSaga(sagaId);
    },
    executeSaga: async (sagaId: string): Promise<void> => {
      inFlight++;
      spy.peakConcurrency = Math.max(spy.peakConcurrency, inFlight);
      executed.push(sagaId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    },
    resumeCompensationWalkAsync: (sagaId: string): void => {
      void spy.resumeCompensationWalk(sagaId);
    },
    isCompensationWalkInFlight: (sagaId: string): boolean => inFlightWalks.has(sagaId),
    resumeCompensationWalk: async (sagaId: string): Promise<void> => {
      inFlightWalks.add(sagaId);
      inFlight++;
      spy.peakConcurrency = Math.max(spy.peakConcurrency, inFlight);
      compensated.push(sagaId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      // A walk that finishes terminalizes its row. The double writes that back
      // so the level the pass re-measures afterwards is the level a real drain
      // would leave — otherwise the re-measurement could only ever confirm the
      // number it started from.
      const row = rows.find((candidate) => candidate.id === sagaId);
      if (row) row.status = "COMPENSATED";
      inFlightWalks.delete(sagaId);
      inFlight--;
    },
    persistSagaInstance: async (instance: SagaInstance): Promise<void> => {
      persisted.push(instance.id);
    },
    loadSagaInstance: async (): Promise<SagaInstance | null> => null,
    failSaga: async (): Promise<void> => undefined,
  };
  return spy;
}

/** Builds a lifecycle whose boot load returns exactly `rows`. */
function createLifecycle(
  rows: SeededRow[],
  options: {
    definitions?: SagaDefinition[];
    bootLoadLimit?: number;
    maxConcurrentSagas?: number;
    compensating?: number;
  } = {}
): { lifecycle: SagaManagerLifecycle; engine: EngineSpy } {
  // The double HONOURS the status predicate, because which statuses the load
  // selects is itself under test: a double that returned every seeded row would
  // report a widened predicate as already shipped.
  const matching = (where?: { status?: unknown }): SeededRow[] => {
    const status = where?.status;
    if (typeof status === "string") {
      return rows.filter((row) => row.status === status);
    }
    const included = (status as { in?: string[] } | undefined)?.in;
    return included ? rows.filter((row) => included.includes(row.status)) : rows;
  };

  const tx = {
    $executeRaw: async (): Promise<number> => 1,
    sagaInstance: {
      // The load counts twice inside its ONE read boundary: the non-terminal
      // rows it is about to page, and the COMPENSATING rows it measures for the
      // orphan gauge. Routed by the predicate so the two cannot be confused.
      count: async (args?: { where?: { status?: unknown } }): Promise<number> =>
        args?.where?.status === "COMPENSATING"
          ? (options.compensating ?? matching(args?.where).length)
          : matching(args?.where).length,
      findMany: async (args: {
        take?: number;
        where?: { status?: unknown };
      }): Promise<SeededRow[]> => matching(args.where).slice(0, args.take ?? rows.length),
    },
  };
  const config = {
    prisma: {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => await fn(tx),
      $queryRaw: async (): Promise<number[]> => [1],
    },
    redis: { ping: async (): Promise<string> => "PONG" },
    eventService: { initialize: async (): Promise<void> => undefined },
    scheduler: new NoopBackgroundTaskScheduler(),
    enableMetrics: false,
    ...(options.bootLoadLimit !== undefined && { bootLoadLimit: options.bootLoadLimit }),
    ...(options.maxConcurrentSagas !== undefined && {
      maxConcurrentSagas: options.maxConcurrentSagas,
    }),
  } as unknown as SagaManagerConfig;

  const lifecycle = new SagaManagerLifecycle(config);
  const engine = createEngineSpy(rows);
  lifecycle.executionEngine = engine;
  for (const definition of options.definitions ?? [makeDefinition()]) {
    lifecycle.registerSaga(definition);
  }
  return { lifecycle, engine };
}

/**
 * The gauge value as a SCRAPE would render it.
 *
 * `getMetricsAsJSON` is what the metrics endpoint calls, and it awaits every
 * `collect` callback — so this measures the level the way Prometheus does,
 * rather than whatever some code path last published.
 */
async function scrapeCompensatingOrphans(): Promise<number | undefined> {
  const rendered = await client.register.getMetricsAsJSON();
  const gauge = rendered.find((metric) => metric.name === "saga_compensating_orphans");
  return (gauge?.values?.[0] as { value?: number } | undefined)?.value;
}

/** Waits until `probe` holds, so a detached dispatch is observed, never guessed. */
async function until(probe: () => boolean | Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await probe())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Lets a detached dispatch and every persist it awaits drain before observing. */
async function drain(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** One structured log line, as the engine emitted it. */
interface LogRecord {
  level: "info" | "warn" | "error";
  fields: Record<string, unknown>;
  msg: string;
}

/**
 * Captures the engine's structured log without letting it reach stdout.
 *
 * The boot disposition of a row is reported in the pass summary and nowhere
 * else — it is deliberately not a return value — so reading the log is how a
 * test observes the decision the engine took, rather than re-deriving it.
 */
function captureSagaLogs(): { records: LogRecord[]; restore: () => void } {
  const records: LogRecord[] = [];
  const spies: MockInstance[] = [];
  for (const level of ["info", "warn", "error"] as const) {
    const spy = vi.spyOn(logger, level).mockImplementation(((
      fields: unknown,
      msg?: unknown
    ): void => {
      if (typeof fields === "string") {
        records.push({ level, fields: {}, msg: fields });
        return;
      }
      records.push({
        level,
        fields: (fields ?? {}) as Record<string, unknown>,
        msg: typeof msg === "string" ? msg : "",
      });
    }) as never);
    spies.push(spy);
  }
  return {
    records,
    restore: (): void => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

/** The dispositions the boot pass reported, read off its summary line. */
function bootSummary(records: LogRecord[]): Record<string, unknown> | undefined {
  return records.find((record) => record.msg === "Saga boot recovery pass complete")?.fields;
}

/**
 * A step that counts what the engine asked of it.
 *
 * The counters are the probe's whole instrument: `executeAttempts` on the step
 * whose failure triggered the compensation separates "the engine resumed the
 * undo" from "the engine re-ran the failed step forward over state a partial
 * undo already reverted", and `compensateAttempts` says whether the walk was
 * continued at all.
 */
class CountingCompensableStep implements CompensableStep {
  readonly class = "compensable" as const;
  executeAttempts = 0;
  compensateAttempts = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly succeeds: boolean
  ) {}

  async execute(): Promise<SagaStepResult> {
    this.executeAttempts += 1;
    return this.succeeds
      ? { success: true, data: { stepId: this.id }, compensationData: { stepId: this.id } }
      : { success: false, error: "retries exhausted" };
  }

  async compensate(_context: SagaContext, _compensationData?: unknown): Promise<SagaStepResult> {
    this.compensateAttempts += 1;
    return { success: true, data: { compensated: this.id } };
  }
}

/** A pivot step that counts its executions; it has no compensation by canon. */
class CountingPivotStep implements PivotStep {
  readonly class = "pivot" as const;
  readonly id = "step-2-pivot";
  readonly name = "Pivot Step";
  executeAttempts = 0;

  async execute(): Promise<SagaStepResult> {
    this.executeAttempts += 1;
    return { success: true, data: { stepId: this.id } };
  }
}

/** A post-pivot step that counts its executions; forward recovery only. */
class CountingRetryableStep implements RetryableStep {
  readonly class = "retryable" as const;
  readonly id = "step-3-retryable";
  readonly name = "Retryable Step";
  executeAttempts = 0;

  async execute(): Promise<SagaStepResult> {
    this.executeAttempts += 1;
    return { success: true, data: { stepId: this.id } };
  }
}

interface CountingSteps {
  step0: CountingCompensableStep;
  step1: CountingCompensableStep;
  pivot: CountingPivotStep;
  postPivot: CountingRetryableStep;
}

/** Two compensable steps, a pivot and a post-pivot step, all counting. */
function makeCountingDefinition(): { definition: SagaDefinition; steps: CountingSteps } {
  const steps: CountingSteps = {
    step0: new CountingCompensableStep("step-0", "First Compensable Step", true),
    step1: new CountingCompensableStep("step-1", "Second Compensable Step", false),
    pivot: new CountingPivotStep(),
    postPivot: new CountingRetryableStep(),
  };
  const definition = defineSaga({
    id: DEFINITION_ID,
    name: "Post Publishing Saga",
    version: "2.0.0",
    preCommit: [steps.step0, steps.step1],
    pivot: steps.pivot,
    postCommit: [steps.postPivot],
    timeout: 30 * 60 * 1000,
    retryPolicy: { maxRetries: 3, backoffMs: 5000, exponential: true },
  });
  return { definition, steps };
}

interface RealHarness {
  manager: SagaManagerImpl;
  scheduler: NoopBackgroundTaskScheduler;
  steps: CountingSteps;
  prisma: MockPrismaClient;
  records: LogRecord[];
  /** The row as the durable layer holds it right now. */
  row: () => Promise<SeededRow>;
  teardown: () => Promise<void>;
}

/**
 * A manager built on the REAL execution engine over in-memory doubles.
 *
 * The engine spy above answers "what did the pass decide"; this harness answers
 * "what does the engine then DO", which is the only way to observe a forward
 * re-execution — the spy would record a dispatch either way.
 */
async function createRealHarness(seeded: SeededRow[]): Promise<RealHarness> {
  const prisma = createMockPrisma();
  const redis = createMockRedis();
  const eventService = createMockEventService();
  const scheduler = new NoopBackgroundTaskScheduler();
  for (const row of seeded) {
    await prisma.sagaInstance.upsert({ where: { id: row.id }, create: row });
  }

  const { definition, steps } = makeCountingDefinition();
  const manager = new SagaManagerImpl({
    prisma: prisma as never,
    redis: redis as never,
    eventService: eventService as never,
    scheduler,
    enableMetrics: false,
  });
  manager.registerSaga(definition);

  const capture = captureSagaLogs();

  return {
    manager,
    scheduler,
    steps,
    prisma,
    records: capture.records,
    row: async (): Promise<SeededRow> =>
      (await prisma.sagaInstance.findUnique({ where: { id: seeded[0]!.id } })) as SeededRow,
    teardown: async (): Promise<void> => {
      capture.restore();
      await manager.shutdown();
    },
  };
}

/**
 * A row a crash left mid-automatic-compensation.
 *
 * `status` defaults to what the durable layer records once the compensation
 * transition is write-ahead. Passing `"RUNNING"` reproduces the shape a
 * PRE-CHANGE process left behind: the status was never flipped, the triggering
 * error was set after the persist so it never reached the row, per-step
 * progress was memory-only until a single post-loop persist, and `nextRetryAt`
 * still carried the last retry scheduling because only a step SUCCESS cleared
 * it.
 */
function makeCrashedCompensationRow(
  id: string,
  nextRetryAt: Date | null,
  status: "COMPENSATING" | "RUNNING" = "COMPENSATING"
): SeededRow {
  return makeRow(id, {
    status,
    currentStep: 1,
    stepResults: [
      { success: true, compensationData: { stepId: "step-0" } },
      { success: false, error: "retries exhausted" },
    ],
    compensationResults: [],
    retryCount: 3,
    error: null,
    nextRetryAt,
  });
}

describe("saga boot recovery pass", () => {
  describe("containment", () => {
    it("skips a row it cannot read and still recovers the rows behind it", async () => {
      const { lifecycle, engine } = createLifecycle([
        makeRow("saga-before"),
        makePoisonRow("saga-poison"),
        makeRow("saga-after"),
      ]);

      await expect(lifecycle.initialize()).resolves.toBeUndefined();
      await until(() => engine.executed.length === 2, "both readable rows to be advanced");

      expect(engine.executed).toEqual(["saga-before", "saga-after"]);
      expect(lifecycle.metrics.bootResumeRowFailures).toBe(1);
      // The unreadable row is a per-row failure, NOT a failed pass: a boot that
      // recovered two of three sagas has recovery coverage and must not report
      // itself as blind.
      expect(lifecycle.metrics.bootLoadFailures).toBe(0);
    });
  });

  describe("a definition this process has not registered", () => {
    it("parks the row under its own disposition instead of calling it a pivot", async () => {
      const { lifecycle, engine } = createLifecycle(
        [makeRow("saga-known"), makeRow("saga-foreign", { definitionId: "some-other-saga" })],
        { definitions: [makeDefinition()] }
      );

      await lifecycle.initialize();
      await until(() => engine.executed.length === 1, "the known row to be advanced");

      expect(engine.executed).toEqual(["saga-known"]);
      expect(lifecycle.metrics.bootParkedSagas).toBe(1);
      expect(lifecycle.parkedAt.has("saga-foreign")).toBe(true);
      // One foreign row among known ones is a data condition, not a wiring one.
      expect(lifecycle.metrics.bootLoadFailures).toBe(0);
    });

    it("reports a boot in which EVERY row is unregistered as a composition defect", async () => {
      const { lifecycle, engine } = createLifecycle([makeRow("saga-one"), makeRow("saga-two")], {
        definitions: [],
      });

      await lifecycle.initialize();

      expect(engine.executed).toEqual([]);
      expect(lifecycle.metrics.bootParkedSagas).toBe(2);
      // The distinguishing assertion: parking the whole fleet for want of a
      // definition is the signature of a pass that ran before anything
      // registered one, so it degrades this process's recovery health instead of
      // reading as two ordinary parked rows.
      expect(lifecycle.metrics.bootLoadFailures).toBe(1);
      // Reachable but blind: the dependencies answer, and the process still has
      // no recovery coverage. That distinction is the whole point of `degraded`.
      const health = await lifecycle.healthCheck();
      expect(health.details.database).toBe(true);
      expect(health.details.recoveredAtBoot).toBe(false);
      expect(health.status).toBe("degraded");
    });
  });

  describe("bounds", () => {
    it("advances no more sagas at once than the configured ceiling", async () => {
      const rows = Array.from({ length: 9 }, (_, index) => makeRow(`saga-${index}`));
      const { lifecycle, engine } = createLifecycle(rows, { maxConcurrentSagas: 3 });

      await lifecycle.initialize();
      await until(() => engine.executed.length === rows.length, "every inherited row to advance");

      expect(engine.peakConcurrency).toBeLessThanOrEqual(3);
      // And the cap is a cap, not a drop: every row still gets its nudge.
      expect(new Set(engine.executed).size).toBe(rows.length);
    });

    it("defers the rows past its load ceiling, counted and never silently truncated", async () => {
      const rows = Array.from({ length: 5 }, (_, index) => makeRow(`saga-${index}`));
      const { lifecycle, engine } = createLifecycle(rows, { bootLoadLimit: 2 });

      await lifecycle.initialize();
      await until(() => engine.executed.length === 2, "the loaded page to advance");

      expect(lifecycle.activeInstances.size).toBe(2);
      expect(lifecycle.metrics.bootLoadDeferred).toBe(3);
    });
  });

  describe("the COMPENSATING level", () => {
    it("is measured at SCRAPE time, so a walk that finished stops being reported", async () => {
      const { lifecycle, engine } = createLifecycle([
        makeRow("saga-running"),
        makeRow("saga-compensating", { status: "COMPENSATING" }),
      ]);

      await lifecycle.initialize();
      expect(await scrapeCompensatingOrphans()).toBe(1);

      await until(
        () => engine.executed.length === 1 && engine.compensated.length === 1,
        "the pass to drain both dispositions"
      );

      // Published only at boot, the level would keep reading 1 until the next
      // restart — long after the engine finished the walk — and the alert that
      // keys on it would page for work that already completed.
      await until(
        async () => (await scrapeCompensatingOrphans()) === 0,
        "the scrape to report the level the database now holds"
      );
      await lifecycle.shutdown();
    });

    it("keeps reporting the rows whose walks this process could NOT finish", async () => {
      const { lifecycle, engine } = createLifecycle(
        [makeRow("saga-compensating", { status: "COMPENSATING" })],
        // The double answers the level query with a fixed non-zero count: the
        // walk ran and the row is still COMPENSATING, which is exactly the
        // shape the alert must survive to catch.
        { compensating: 2 }
      );

      await lifecycle.initialize();
      await until(() => engine.compensated.length === 1, "the walk to be dispatched");

      expect(await scrapeCompensatingOrphans()).toBe(2);
      expect(lifecycle.metrics.compensatingOrphans).toBe(2);
      await lifecycle.shutdown();
    });
  });

  describe("an inherited COMPENSATING row", () => {
    it("is loaded by the boot pass", async () => {
      const { lifecycle } = createLifecycle([
        makeRow("saga-forward"),
        makeRow("saga-compensating", { status: "COMPENSATING" }),
      ]);

      await lifecycle.initialize();

      // A status nothing loads is a status nothing can finish: the row sits in
      // the infinite non-terminal state the saga canon forbids.
      expect(lifecycle.activeInstances.has("saga-compensating")).toBe(true);
    });

    it("is reported under its OWN disposition and dispatched into the WALK", async () => {
      const capture = captureSagaLogs();
      try {
        const { lifecycle, engine } = createLifecycle([
          makeRow("saga-forward"),
          makeRow("saga-compensating", { status: "COMPENSATING" }),
          makeRow("saga-parked", { currentStep: PIVOT_STEP_INDEX }),
        ]);

        await lifecycle.initialize();
        await until(
          () => engine.executed.length === 1 && engine.compensated.length === 1,
          "the forward row to advance and the compensating row to resume its walk"
        );

        // "Finishing an interrupted undo" and "finishing an interrupted
        // publish" are different operator situations; one word for both sends
        // them to the same runbook.
        const summary = bootSummary(capture.records);
        expect(summary?.resumed).toBe(1);
        expect(summary?.compensationResumed).toBe(1);
        // A resumed row is not a skip reason. Filing it as one put it in the
        // same list as the rows nothing advanced.
        expect(summary?.skipReasons).toEqual({ parked: 1 });
        expect(engine.executed).toEqual(["saga-forward"]);
        expect(engine.compensated).toEqual(["saga-compensating"]);
      } finally {
        capture.restore();
      }
    });

    it("is PARKED, not auto-resumed, when its recorded step is at or past the pivot", async () => {
      const { lifecycle, engine } = createLifecycle([
        makeRow("saga-post-pivot-compensating", {
          status: "COMPENSATING",
          currentStep: PIVOT_STEP_INDEX + 1,
        }),
      ]);

      await lifecycle.initialize();
      await drain();

      // The operator door accepts a FAILED saga at ANY step, so a post-pivot
      // row can and does sit in COMPENSATING. Rolling it back unattended, on
      // every boot, undoes pre-pivot state a COMMITTED pivot depends on — past
      // the human gate the pivot-parking branch exists to impose.
      expect(engine.compensated).toEqual([]);
      expect(engine.executed).toEqual([]);
      expect(lifecycle.parkedAt.has("saga-post-pivot-compensating")).toBe(true);
      expect(lifecycle.metrics.bootParkedSagas).toBe(1);
    });

    it("resumes the WALK even when a stale nextRetryAt would hand it to the checker", async () => {
      const { lifecycle, engine } = createLifecycle([
        makeRow("saga-legacy-compensating", {
          status: "COMPENSATING",
          nextRetryAt: new Date(Date.now() - 60_000),
        }),
      ]);

      await lifecycle.initialize();
      await until(() => engine.compensated.length === 1, "the walk to be resumed");

      // Status is checked FIRST: a legacy row written before this change can
      // carry a stale retry marker, and the checker would drive it FORWARD.
      expect(engine.compensated).toEqual(["saga-legacy-compensating"]);
      expect(engine.executed).toEqual([]);
    });
  });

  describe("a row a crash left mid-automatic-compensation", () => {
    it("with a stale retry marker, is still resumed as a walk and never handed to the retry scan", async () => {
      const harness = await createRealHarness([
        makeCrashedCompensationRow("saga-p2-a", new Date(Date.now() - 60_000)),
      ]);
      try {
        await harness.manager.initialize();
        await until(
          () => harness.steps.step0.compensateAttempts > 0,
          "the boot pass to resume the walk"
        );
        await drain();

        // Two mechanisms, both load-bearing, both proven here: the boot pass
        // reads the STATUS before the retry marker, and the retry scan cannot
        // see the row at all because its predicate is RUNNING/PENDING.
        expect(bootSummary(harness.records)?.compensationResumed).toBe(1);
        await harness.scheduler.triggerTask("saga-retry-recovery");
        await drain();

        expect(harness.steps.step1.executeAttempts).toBe(0);
        expect(harness.steps.pivot.executeAttempts).toBe(0);
        expect(harness.steps.step0.compensateAttempts).toBe(1);
        const row = await harness.row();
        expect(row.status).toBe("COMPENSATED");
        expect(row.compensationResults).toEqual([
          { success: true, data: { compensated: "step-0" } },
        ]);
      } finally {
        await harness.teardown();
      }
    });

    it("with no retry marker, is resumed as a walk with no step running forward", async () => {
      const harness = await createRealHarness([makeCrashedCompensationRow("saga-p2-b", null)]);
      try {
        await harness.manager.initialize();
        await until(
          () => harness.steps.step0.compensateAttempts > 0,
          "the boot pass to resume the walk"
        );
        await drain();

        expect(bootSummary(harness.records)?.compensationResumed).toBe(1);
        expect(harness.steps.step1.executeAttempts).toBe(0);
        expect(harness.steps.pivot.executeAttempts).toBe(0);
        expect(harness.steps.step0.compensateAttempts).toBe(1);
        expect((await harness.row()).status).toBe("COMPENSATED");
      } finally {
        await harness.teardown();
      }
    });

    it("is still run forward when a pre-change process left it RUNNING (accepted residual)", async () => {
      const harness = await createRealHarness([
        makeCrashedCompensationRow("saga-p2-legacy", null, "RUNNING"),
      ]);
      try {
        await harness.manager.initialize();
        await until(
          () => harness.steps.step1.executeAttempts > 0,
          "the boot pass to dispatch the legacy row"
        );
        await drain();

        // A row written by the OLD engine says RUNNING while a walk was under
        // way, and nothing on it distinguishes that from a saga interrupted
        // mid-step — so this process does what it did before: it re-executes
        // the failed step forward, and its failure starts a fresh walk. The
        // class is bounded (only rows crashed mid-walk at the moment of the
        // deploy) and is not a regression, but it is REAL, so it is pinned
        // here rather than described as closed. See the compensating-orphan
        // runbook in docs/security/MULTI_TENANT_GUARDS.md.
        expect(harness.steps.step1.executeAttempts).toBe(1);
        expect(harness.steps.step0.compensateAttempts).toBe(1);
        expect((await harness.row()).status).toBe("COMPENSATED");
      } finally {
        await harness.teardown();
      }
    });
  });

  describe("what the pass writes", () => {
    it("re-warms the rows it leaves in play and writes nothing to the ones it parks", async () => {
      const { lifecycle, engine } = createLifecycle([
        makeRow("saga-resumable"),
        makeRow("saga-parked", { currentStep: PIVOT_STEP_INDEX }),
      ]);

      await lifecycle.initialize();
      await until(() => engine.executed.length === 1, "the pre-pivot row to advance");

      expect(engine.executed).toEqual(["saga-resumable"]);
      expect(engine.persisted).toEqual(["saga-resumable"]);
      // The promise made about a parked row is that an operator finds the state
      // the interruption left. A re-warm goes through the ordinary persist, so
      // it would rewrite the row and move `updatedAt`.
      expect(engine.persisted).not.toContain("saga-parked");
    });
  });
});
