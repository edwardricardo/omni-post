/**
 * @file sagaManager.test-helpers.ts
 * @description Test helpers for saga manager test helpers
 * @layer infrastructure
 */
import { until, untilValue } from "@packages/vitest-shared/determinism";
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import type { SagaExecutionEngine } from "../../src/saga/SagaManagerExecution.js";
import {
  SagaDefinition,
  SagaStep,
  SagaContext,
  SagaStepResult,
  defineSaga,
  type PivotStep,
} from "@shared/types/saga.js";
import { EventStoreEvent } from "@shared/types/events.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

/**
 * Account every test saga belongs to. The engine rehydrates a saga's owning
 * account before it runs any step or persists any state, and skips work it
 * cannot scope to a tenant — so a saga started without one models a corrupted
 * row, not a normal one.
 */
export const TEST_ACCOUNT_ID = "acc-11111111-1111-4111-8111-111111111111";

/** A saga row as the doubles store it: whatever the engine wrote, keyed by column. */
export type StoredSagaRow = Record<string, unknown>;

/** The engine's conditional update: one row by id, and only while its status is allowed. */
export interface SagaRowUpdateArgs {
  where: { id: string; status?: { notIn?: string[] } };
  data: StoredSagaRow;
}

/** The engine's create of a new saga's row. */
export interface SagaRowCreateArgs {
  data: StoredSagaRow & { id: string };
}

/** The two saga-row writes the engine issues, as a `sagaInstance` double exposes them. */
export interface SagaRowWrites {
  updateMany: (args: SagaRowUpdateArgs) => Promise<{ count: number }>;
  create: (args: SagaRowCreateArgs) => Promise<StoredSagaRow>;
}

/**
 * @function sagaRowWrites
 * @description The engine's two row writes, modelled as Postgres answers them. The
 *   state write is a compare-and-swap: the update lands only on a row whose status is
 *   outside the `notIn` it names, the count is the verdict, and the columns it omits
 *   keep their values. A create on an id that already exists fails the way the primary
 *   key makes it fail, with Prisma's `P2002`. One model shared by every saga double, so
 *   no double can answer the compare-and-swap differently from another.
 * @param store - The double's rows, keyed by saga id.
 * @param stampUpdatedAt - Whether the double applies `@updatedAt` on every write.
 * @returns The `updateMany` and `create` members of a `sagaInstance` double.
 */
export function sagaRowWrites(
  store: Map<string, StoredSagaRow>,
  stampUpdatedAt = false
): SagaRowWrites {
  const stamped = (row: StoredSagaRow): StoredSagaRow =>
    stampUpdatedAt ? { ...row, updatedAt: new Date() } : row;
  return {
    updateMany: async (args) => {
      const row = store.get(args.where.id);
      const refused = args.where.status?.notIn ?? [];
      if (row === undefined || refused.includes(String(row.status))) return { count: 0 };
      store.set(args.where.id, stamped({ ...row, ...args.data }));
      return { count: 1 };
    },
    create: async (args) => {
      if (store.has(args.data.id)) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), {
          code: "P2002",
        });
      }
      const row = stamped({ ...args.data });
      store.set(args.data.id, row);
      return row;
    },
  };
}

/**
 * @function interceptRowWrites
 * @description Runs `inspect` on the data of every saga-row write before the double
 *   applies it, the conditional update and the create alike, so a test can refuse a
 *   chosen write by throwing from `inspect`, as a database that refuses it would, or
 *   let another advancer act on the row first by awaiting inside it.
 * @param writes - The `sagaInstance` double whose writes are intercepted, in place.
 * @param inspect - Called with each write's data and row id; a throw refuses that write.
 */
export function interceptRowWrites(
  writes: SagaRowWrites,
  inspect: (data: StoredSagaRow, id: string) => void | Promise<void>
): void {
  const update = writes.updateMany.bind(writes);
  const create = writes.create.bind(writes);
  writes.updateMany = async (args) => {
    await inspect(args.data, args.where.id);
    return await update(args);
  };
  writes.create = async (args) => {
    await inspect(args.data, args.data.id);
    return await create(args);
  };
}

/**
 * @function endRowAtNextWrite
 * @description Another advancer ends the saga's row in the window between the engine's
 *   last read and its next write: right before the first write `selects` picks, the
 *   stored row takes `ending`. That window is the one only the compare-and-swap closes.
 * @param prisma - The double whose row is ended.
 * @param ending - The terminal status the other advancer writes.
 * @param selects - Picks the write that loses the race, by the data it would write.
 * @returns Whether the race has happened, so a test waits on it rather than on time.
 */
export function endRowAtNextWrite(
  prisma: MockPrismaClient,
  ending: string,
  selects: (data: StoredSagaRow) => boolean
): () => boolean {
  let armed = true;
  interceptRowWrites(prisma.sagaInstance, async (data, id) => {
    if (!armed || !selects(data)) return;
    armed = false;
    const stored = (await prisma.sagaInstance.findUnique({ where: { id } })) as StoredSagaRow;
    stored.status = ending;
  });
  return () => !armed;
}

export interface MockPrismaClient {
  $queryRaw: (query: any) => Promise<any>;
  $executeRaw: (query: any) => Promise<any>;
  $transaction: <T>(fn: (tx: MockPrismaClient) => Promise<T>) => Promise<T>;
  sagaInstance: SagaRowWrites & {
    upsert: (args: any) => Promise<any>;
    /** The boot load counts before it pages, so it can report what it deferred. */
    count: (args?: any) => Promise<number>;
    findMany: (args?: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
  };
  /**
   * The durable event log. The engine reads ONE event type out of it — the
   * compensation-started marker, which is the absolute birth of a rollback and
   * therefore the only anchor a restart loop cannot reset.
   */
  storedEvent: {
    findFirst: (args?: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
}

export interface MockRedis {
  setex: (key: string, ttl: number, data: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  keys: (pattern: string) => Promise<string[]>;
  ping: () => Promise<string>;
}

export interface MockEventService {
  initialize: () => Promise<void>;
  publishEvent: (event: EventStoreEvent) => Promise<void>;
  appendEventInTx: (tx: unknown, event: EventStoreEvent) => Promise<void>;
  broadcastEvent: (event: EventStoreEvent) => Promise<void>;
  publishedEvents: EventStoreEvent[];
}

/**
 * @function createMockPrisma
 * @description An in-memory Prisma double for the saga rows and stored events the engine reads
 *   and writes. Its transaction runs the callback against the same double, and its row writes
 *   stamp `updatedAt` as the database does.
 * @returns A fresh double with empty stores.
 */
export function createMockPrisma(): MockPrismaClient {
  const store = new Map<string, any>();
  const storedEvents: any[] = [];

  /**
   * The rows a status predicate selects. Shared by `count` and `findMany` so the
   * deferred figure the boot load reports is computed against the same set it
   * pages — which is the property the real read gets from doing both inside one
   * transaction.
   */
  const matching = (args?: any): any[] => {
    if (!args?.where) return Array.from(store.values());
    const statuses: string[] = args.where.status?.in ?? [];
    return Array.from(store.values()).filter((v: any) =>
      statuses.length ? statuses.includes(v.status) : true
    );
  };

  const mock: MockPrismaClient = {
    $queryRaw: async () => [{ result: 1 }],
    $executeRaw: async () => 1,
    $transaction: async <T>(fn: (tx: MockPrismaClient) => Promise<T>) => fn(mock),
    sagaInstance: {
      // `@updatedAt` is applied by the database on every write, so the double
      // applies it too: the COMPENSATING liveness horizon is measured from
      // this column, and a double that froze it would make a stalled walk and
      // a live one indistinguishable.
      ...sagaRowWrites(store, true),
      // Kept for the suites that SEED a row through it; the engine no longer upserts.
      upsert: async (args: any) => {
        const data = { ...(args.create ?? args.update), updatedAt: new Date() };
        store.set(args.where.id, data);
        return data;
      },
      // The boot load counts twice inside its ONE read boundary: the rows it
      // is about to page, and the COMPENSATING rows it deliberately never
      // loads. Routed by the predicate so the two cannot be confused.
      count: async (args?: any) =>
        args?.where?.status === "COMPENSATING"
          ? Array.from(store.values()).filter((v: any) => v.status === "COMPENSATING").length
          : matching(args).length,
      findMany: async (args?: any) => {
        const rows = matching(args);
        return typeof args?.take === "number" ? rows.slice(0, args.take) : rows;
      },
      findUnique: async (args: any) => {
        return store.get(args.where.id) ?? null;
      },
    },
    storedEvent: {
      findFirst: async (args?: any) =>
        storedEvents.find(
          (event: any) =>
            event.streamId === args?.where?.streamId && event.eventType === args?.where?.eventType
        ) ?? null,
      create: async (args: any) => {
        storedEvents.push(args.data);
        return args.data;
      },
    },
  };
  return mock;
}

/**
 * @function createMockRedis
 * @description An in-memory Redis double for the engine's hot cache: `setex` stores without
 *   expiring, `keys` matches by prefix, and `ping` always answers `PONG`.
 * @returns A fresh double with an empty store.
 */
export function createMockRedis(): MockRedis {
  const storage = new Map<string, string>();

  return {
    setex: async (key: string, _ttl: number, data: string) => {
      storage.set(key, data);
    },
    get: async (key: string) => {
      return storage.get(key) || null;
    },
    keys: async (pattern: string) => {
      const prefix = pattern.replace("*", "");
      return Array.from(storage.keys()).filter((key) => key.startsWith(prefix));
    },
    ping: async () => "PONG",
  };
}

/**
 * @function createMockEventService
 * @description An event-service double that records every published or transactionally appended
 *   event in `publishedEvents`, so a test can assert what the engine emitted; broadcasting does
 *   nothing.
 * @returns A fresh double with no recorded events.
 */
export function createMockEventService(): MockEventService {
  const publishedEvents: EventStoreEvent[] = [];

  return {
    initialize: async () => {},
    publishEvent: async (event: EventStoreEvent) => {
      publishedEvents.push(event);
    },
    appendEventInTx: async (_tx: unknown, event: EventStoreEvent) => {
      publishedEvents.push(event);
    },
    broadcastEvent: async () => {
      // No-op in tests; the durable append already recorded the event.
    },
    publishedEvents,
  };
}

/**
 * @function createSagaManager
 * @description Builds a real `SagaManagerImpl` over the given doubles, with metrics enabled and a
 *   no-op scheduler, so no background checker runs unless a test triggers it.
 * @param mockPrisma - The Prisma double the engine persists to.
 * @param mockRedis - The Redis double it uses as its hot cache.
 * @param mockEventService - The event-service double that records its events.
 * @returns The saga manager under test, not yet initialized.
 */
export function createSagaManager(
  mockPrisma: MockPrismaClient,
  mockRedis: MockRedis,
  mockEventService: MockEventService
): SagaManagerImpl {
  return new SagaManagerImpl({
    prisma: mockPrisma as any,
    redis: mockRedis as any,
    eventService: mockEventService as any,
    scheduler: new NoopBackgroundTaskScheduler(),
    enableMetrics: true,
  });
}

/** The statuses no pass moves a saga out of. */
const ENDED_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "COMPENSATED"]);

/**
 * @function awaitSagaEnded
 * @description Waits until the detached pass over a saga has ended it and let go of it. The
 *   ending alone is not enough: the engine moves the status before it persists the row, appends
 *   the event and counts the metric, and it releases its claim on the saga only after all three.
 *   The claim is read through a cast because `isAdvancerInFlight` is deliberately not on the
 *   facade. The deadline stays under vitest's 5 s test timeout, so the wait's own message is the
 *   failure a reader sees.
 * @param manager - The saga manager running the saga.
 * @param sagaId - The saga to wait on.
 * @returns A promise that resolves once the saga is COMPLETED, FAILED or COMPENSATED and no pass
 *   holds it; it rejects after 3 s, naming the last status it read.
 */
export async function awaitSagaEnded(manager: SagaManagerImpl, sagaId: string): Promise<void> {
  const engine = (manager as unknown as { execution: SagaExecutionEngine }).execution;
  let lastStatus = "unread";
  await until(
    async () => {
      lastStatus = (await manager.getSaga(sagaId))?.status ?? "absent";
      return ENDED_STATUSES.has(lastStatus) && !engine.isAdvancerInFlight(sagaId);
    },
    {
      description: () => `saga ${sagaId} to end and be released; last status ${lastStatus}`,
      timeoutMs: 3_000,
      intervalMs: 5,
    }
  );
}

/**
 * @function awaitSagaParked
 * @description Waits until the detached pass over a saga has parked it and let go of it: the saga
 *   is RUNNING, carries the retry time its waiting step armed, and no pass holds it. That is the
 *   state a shutdown hands off as PENDING, and once it is reached no pass is left to run against
 *   the stopped manager. The claim is read through the same cast as in `awaitSagaEnded`, and the
 *   deadline stays under vitest's 5 s test timeout for the same reason.
 * @param manager - The saga manager running the saga.
 * @param sagaId - The saga to wait on.
 * @returns The retry time the parked saga carries; the promise rejects after 3 s, naming the last
 *   status it read.
 */
export async function awaitSagaParked(manager: SagaManagerImpl, sagaId: string): Promise<Date> {
  const engine = (manager as unknown as { execution: SagaExecutionEngine }).execution;
  let lastStatus = "unread";
  return await untilValue(
    async () => {
      const saga = await manager.getSaga(sagaId);
      lastStatus = saga?.status ?? "absent";
      const parked = lastStatus === "RUNNING" && !engine.isAdvancerInFlight(sagaId);
      return parked ? saga?.nextRetryAt : undefined;
    },
    {
      description: () => `saga ${sagaId} to park and be released; last status ${lastStatus}`,
      timeoutMs: 3_000,
      intervalMs: 5,
    }
  );
}

export class SuccessfulStep implements SagaStep {
  readonly id = "successful-step";
  readonly name = "Successful Step";

  /**
   * @method execute
   * @description Records its run in `context.stepData` and succeeds, returning compensation data
   *   that names the step.
   * @param context - The saga context the step records its run in.
   * @param data - Extra fields merged into the result data.
   * @returns A succeeded result.
   */
  async execute(context: SagaContext, data?: any): Promise<SagaStepResult> {
    context.stepData[this.id] = { executed: true, timestamp: new Date() };
    return {
      outcome: "succeeded",
      data: { stepId: this.id, ...data },
      compensationData: { stepId: this.id },
    };
  }

  /**
   * @method compensate
   * @description Marks the step compensated in `context.stepData` and succeeds.
   * @param context - The saga context the compensation is recorded in.
   * @param _compensationData - The data `execute` returned; unused.
   * @returns A succeeded result.
   */
  async compensate(context: SagaContext, _compensationData?: any): Promise<SagaStepResult> {
    context.stepData[`${this.id}-compensated`] = true;
    return { outcome: "succeeded", data: { compensated: true } };
  }
}

export class FailingStep implements SagaStep {
  readonly id = "failing-step";
  readonly name = "Failing Step";

  /**
   * @method execute
   * @description Fails on every run without recording anything, to drive the engine's step
   *   failure path.
   * @param _context - Unused.
   * @param _data - Unused.
   * @returns A failed result.
   */
  async execute(_context: SagaContext, _data?: any): Promise<SagaStepResult> {
    return {
      outcome: "failed",
      error: "Intentional step failure for testing",
    };
  }
}

export class DelayedStep implements SagaStep {
  readonly id = "delayed-step";
  readonly name = "Delayed Step";

  constructor(private delayMs: number = 100) {}

  /**
   * @method execute
   * @description Waits `delayMs` before recording its run and succeeding, so the saga stays inside
   *   this step for that long.
   * @param context - The saga context the step records its run in.
   * @param _data - Unused.
   * @returns A succeeded result.
   */
  async execute(context: SagaContext, _data?: any): Promise<SagaStepResult> {
    // fixed-wait: latency-injection — models a slow step; callers wait on the saga's ending.
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    context.stepData[this.id] = { executed: true };
    return { outcome: "succeeded", data: { delayed: true } };
  }
}

export class CompensationFailingStep implements SagaStep {
  readonly id = "compensation-failing-step";
  readonly name = "Compensation Failing Step";

  /**
   * @method execute
   * @description Records its run and succeeds with compensation data; only its compensation fails.
   * @param context - The saga context the step records its run in.
   * @param _data - Unused.
   * @returns A succeeded result carrying compensation data.
   */
  async execute(context: SagaContext, _data?: any): Promise<SagaStepResult> {
    context.stepData[this.id] = { executed: true };
    return { outcome: "succeeded", compensationData: { stepId: this.id } };
  }

  /**
   * @method compensate
   * @description Fails on every call, to drive the engine's compensation failure path.
   * @param _context - Unused.
   * @param _compensationData - Unused.
   * @returns A failed result.
   */
  async compensate(_context: SagaContext, _compensationData?: any): Promise<SagaStepResult> {
    return {
      outcome: "failed",
      error: "Compensation failed for testing",
    };
  }
}

/**
 * @function createSimpleSagaDefinition
 * @description The smallest definition that runs to completion: one step that always succeeds.
 * @returns The `simple-test-saga` definition.
 */
export function createSimpleSagaDefinition(): SagaDefinition {
  return {
    id: "simple-test-saga",
    name: "Simple Test Saga",
    version: "1.0.0",
    steps: [new SuccessfulStep()],
  };
}

/**
 * @function createMultiStepSagaDefinition
 * @description Three steps that all succeed, the middle one after a delay.
 * @returns The `multi-step-test-saga` definition.
 */
export function createMultiStepSagaDefinition(): SagaDefinition {
  return {
    id: "multi-step-test-saga",
    name: "Multi-Step Test Saga",
    version: "1.0.0",
    steps: [new SuccessfulStep(), new DelayedStep(), new SuccessfulStep()],
  };
}

/**
 * @function createFailingSagaDefinition
 * @description Two steps: one that succeeds, then one that always fails.
 * @returns The `failing-test-saga` definition.
 */
export function createFailingSagaDefinition(): SagaDefinition {
  return {
    id: "failing-test-saga",
    name: "Failing Test Saga",
    version: "1.0.0",
    steps: [new SuccessfulStep(), new FailingStep()],
  };
}

/**
 * @function createParkingSagaDefinition
 * @description One step that answers `waiting` on every run, so the start's pass leaves the saga
 *   RUNNING with the retry time of its next poll and lets go of it: the parked state a shutdown
 *   hands off. Nothing advances the saga afterwards, because the no-op scheduler runs no retry
 *   checker, so a test can shut down without a pass left to run against the stopped manager.
 * @returns The `parking-test-saga` definition.
 */
export function createParkingSagaDefinition(): SagaDefinition {
  const step: PivotStep = {
    id: "parking-step",
    name: "Parking Step",
    class: "pivot",
    execute: async () => ({ outcome: "waiting", reason: "the awaited work has not finished" }),
  };
  return defineSaga({
    id: "parking-test-saga",
    name: "Parking Test Saga",
    version: "1.0.0",
    preCommit: [],
    pivot: step,
    postCommit: [],
  });
}
