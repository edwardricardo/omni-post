/**
 * @file sagaManager.test-helpers.ts
 * @description Test helpers for saga manager test helpers
 * @layer infrastructure
 */
import { SagaManagerImpl } from "../../src/saga/SagaManager";
import { SagaDefinition, SagaStep, SagaContext, SagaStepResult } from "@shared/saga";
import { DomainEvent } from "@shared/events";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

export interface MockPrismaClient {
  $queryRaw: (query: any) => Promise<any>;
  $executeRaw: (query: any) => Promise<any>;
  $transaction: <T>(fn: (tx: MockPrismaClient) => Promise<T>) => Promise<T>;
  sagaInstance: {
    upsert: (args: any) => Promise<any>;
    findMany: (args?: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
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
  publishEvent: (event: DomainEvent) => Promise<void>;
  appendEventInTx: (tx: unknown, event: DomainEvent) => Promise<void>;
  broadcastEvent: (event: DomainEvent) => Promise<void>;
  publishedEvents: DomainEvent[];
}

export function createMockPrisma(): MockPrismaClient {
  const store = new Map<string, any>();

  const mock: MockPrismaClient = {
    $queryRaw: async () => [{ result: 1 }],
    $executeRaw: async () => 1,
    $transaction: async <T>(fn: (tx: MockPrismaClient) => Promise<T>) => fn(mock),
    sagaInstance: {
      upsert: async (args: any) => {
        const data = args.create ?? args.update;
        store.set(args.where.id, data);
        return data;
      },
      findMany: async (args?: any) => {
        if (!args?.where) return Array.from(store.values());
        const statuses: string[] = args.where.status?.in ?? [];
        return Array.from(store.values()).filter((v: any) =>
          statuses.length ? statuses.includes(v.status) : true
        );
      },
      findUnique: async (args: any) => {
        return store.get(args.where.id) ?? null;
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
  const publishedEvents: DomainEvent[] = [];

  return {
    initialize: async () => {},
    publishEvent: async (event: DomainEvent) => {
      publishedEvents.push(event);
    },
    appendEventInTx: async (_tx: unknown, event: DomainEvent) => {
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
      success: true,
      data: { stepId: this.id, ...data },
      compensationData: { stepId: this.id },
    };
  }

  async compensate(context: SagaContext, _compensationData?: any): Promise<SagaStepResult> {
    context.stepData[`${this.id}-compensated`] = true;
    return { success: true, data: { compensated: true } };
  }
}

export class FailingStep implements SagaStep {
  readonly id = "failing-step";
  readonly name = "Failing Step";

  async execute(_context: SagaContext, _data?: any): Promise<SagaStepResult> {
    return {
      success: false,
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
    return { success: true, data: { delayed: true } };
  }
}

export class CompensationFailingStep implements SagaStep {
  readonly id = "compensation-failing-step";
  readonly name = "Compensation Failing Step";

  async execute(context: SagaContext, _data?: any): Promise<SagaStepResult> {
    context.stepData[this.id] = { executed: true };
    return { success: true, compensationData: { stepId: this.id } };
  }

  async compensate(_context: SagaContext, _compensationData?: any): Promise<SagaStepResult> {
    return {
      success: false,
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
