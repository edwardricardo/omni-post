/**
 * @file sagaManager.test-helpers.ts
 * @description Test helpers for saga manager test helpers
 * @layer infrastructure
 */
import { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import { SagaDefinition, SagaStep, SagaContext, SagaStepResult } from "@shared/types/saga.js";
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
 *   chosen write by throwing from `inspect`, as a database that refuses it would.
 * @param writes - The `sagaInstance` double whose writes are intercepted, in place.
 * @param inspect - Called with each write's data; a throw refuses that write.
 */
export function interceptRowWrites(
  writes: SagaRowWrites,
  inspect: (data: StoredSagaRow) => void
): void {
  const update = writes.updateMany.bind(writes);
  const create = writes.create.bind(writes);
  writes.updateMany = async (args) => {
    inspect(args.data);
    return await update(args);
  };
  writes.create = async (args) => {
    inspect(args.data);
    return await create(args);
  };
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

export class SuccessfulStep implements SagaStep {
  readonly id = "successful-step";
  readonly name = "Successful Step";

  async execute(context: SagaContext, data?: any): Promise<SagaStepResult> {
    context.stepData[this.id] = { executed: true, timestamp: new Date() };
    return {
      outcome: "succeeded",
      data: { stepId: this.id, ...data },
      compensationData: { stepId: this.id },
    };
  }

  async compensate(context: SagaContext, _compensationData?: any): Promise<SagaStepResult> {
    context.stepData[`${this.id}-compensated`] = true;
    return { outcome: "succeeded", data: { compensated: true } };
  }
}

export class FailingStep implements SagaStep {
  readonly id = "failing-step";
  readonly name = "Failing Step";

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

  async execute(context: SagaContext, _data?: any): Promise<SagaStepResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    context.stepData[this.id] = { executed: true };
    return { outcome: "succeeded", data: { delayed: true } };
  }
}

export class CompensationFailingStep implements SagaStep {
  readonly id = "compensation-failing-step";
  readonly name = "Compensation Failing Step";

  async execute(context: SagaContext, _data?: any): Promise<SagaStepResult> {
    context.stepData[this.id] = { executed: true };
    return { outcome: "succeeded", compensationData: { stepId: this.id } };
  }

  async compensate(_context: SagaContext, _compensationData?: any): Promise<SagaStepResult> {
    return {
      outcome: "failed",
      error: "Compensation failed for testing",
    };
  }
}

export function createSimpleSagaDefinition(): SagaDefinition {
  return {
    id: "simple-test-saga",
    name: "Simple Test Saga",
    version: "1.0.0",
    steps: [new SuccessfulStep()],
  };
}

export function createMultiStepSagaDefinition(): SagaDefinition {
  return {
    id: "multi-step-test-saga",
    name: "Multi-Step Test Saga",
    version: "1.0.0",
    steps: [new SuccessfulStep(), new DelayedStep(), new SuccessfulStep()],
  };
}

export function createFailingSagaDefinition(): SagaDefinition {
  return {
    id: "failing-test-saga",
    name: "Failing Test Saga",
    version: "1.0.0",
    steps: [new SuccessfulStep(), new FailingStep()],
  };
}
