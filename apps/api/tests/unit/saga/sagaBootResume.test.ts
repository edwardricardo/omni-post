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
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import type { SagaDefinition, SagaInstance } from "@shared/types/saga.js";
import type { EventStoreEvent } from "@shared/types/events.js";
import { SagaManagerLifecycle } from "../../../src/saga/SagaManagerLifecycle.js";
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
  persisted: string[];
  peakConcurrency: number;
}

/**
 * An execution engine that records what the pass asked of it, and how much of it
 * at once. `executeSaga` yields to the event loop before resolving, so a pass
 * that dispatched everything in one go would register a peak equal to the whole
 * batch.
 */
function createEngineSpy(): EngineSpy {
  const executed: string[] = [];
  const persisted: string[] = [];
  let inFlight = 0;
  const spy: EngineSpy = {
    executed,
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
    compensateSagaAsync: (): void => undefined,
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
  } = {}
): { lifecycle: SagaManagerLifecycle; engine: EngineSpy } {
  const tx = {
    $executeRaw: async (): Promise<number> => 1,
    sagaInstance: {
      count: async (): Promise<number> => rows.length,
      findMany: async (args: { take?: number }): Promise<SeededRow[]> =>
        rows.slice(0, args.take ?? rows.length),
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
  const engine = createEngineSpy();
  lifecycle.executionEngine = engine;
  for (const definition of options.definitions ?? [makeDefinition()]) {
    lifecycle.registerSaga(definition);
  }
  return { lifecycle, engine };
}

/** Waits until `probe` holds, so a detached dispatch is observed, never guessed. */
async function until(probe: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!probe()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Silences the durable event append the terminal paths would attempt. */
const noEvents: EventStoreEvent[] = [];

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
      expect(noEvents).toEqual([]);
    });
  });
});
