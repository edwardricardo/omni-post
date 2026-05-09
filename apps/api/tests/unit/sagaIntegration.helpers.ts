/**
 * Shared test helpers for SagaIntegration test suites.
 *
 * Provides lightweight mock factories for Fastify, EventService, CQRSBus,
 * Redis and QueuePort so every test file can set up its own isolated
 * integration instance without sharing mutable state.
 *
 * @file sagaIntegration.helpers.ts
 * @description Test helpers for saga integration helpers
 * @layer infrastructure
 */

import { DomainEvent } from "@shared/events";
import { Command } from "@shared/cqrs";
import { ok } from "@shared/types";
import type { QueuePort, QueueJob, QueueHealth } from "@ports/core";
import type { Result } from "@shared/types";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { SagaIntegration } from "../../src/saga/SagaIntegration";

export const TEST_CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
export const TEST_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
export const TEST_CHANNEL_IDS = [
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];

/** UUID of an existing DRAFT post owned by TEST_PROJECT_ID. The mock post
 * repo recognises this id; any other id resolves to NotFound. */
export const TEST_EXISTING_DRAFT_POST_ID = "77777777-7777-4777-8777-777777777777";

// ---------------------------------------------------------------------------
// Mock type definitions
// ---------------------------------------------------------------------------

export interface MockFastifyInstance {
  prisma: { $queryRaw: () => Promise<{ result: number }[]> };
  post: (path: string, optionsOrHandler: unknown, handler?: (req: any, reply: any) => any) => void;
  get: (path: string, optionsOrHandler: unknown, handler?: (req: any, reply: any) => any) => void;
  registeredRoutes: Map<string, (req: any, reply: any) => any>;
}

export interface MockEventService {
  initialize: () => Promise<void>;
  publishEvent: (event: DomainEvent) => Promise<void>;
  appendEventInTx: (tx: unknown, event: DomainEvent) => Promise<void>;
  broadcastEvent: (event: DomainEvent) => Promise<void>;
  publishedEvents: DomainEvent[];
}

export interface MockCQRSBus {
  executeCommand: (command: Command) => Promise<{ success: boolean; data: unknown }>;
  executedCommands: Command[];
}

export interface MockRedis {
  setex: (key: string, ttl: number, data: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  keys: (pattern: string) => Promise<string[]>;
  ping: () => Promise<string>;
}

/**
 * MockQueue tracks every enqueued job for assertions.
 * Implements the QueuePort interface from @ports/core.
 */
export interface MockQueue extends QueuePort {
  enqueuedJobs: QueueJob[];
}

export interface MockPrisma {
  $queryRaw: (query: any) => Promise<any>;
  $executeRaw: (query: any) => Promise<any>;
  $transaction: <T>(fn: (tx: MockPrisma) => Promise<T>) => Promise<T>;
  sagaInstance: {
    upsert: (args: any) => Promise<any>;
    findMany: (args?: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
  };
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createMockPrisma(): MockPrisma {
  const store = new Map<string, any>();

  const mock: MockPrisma = {
    $queryRaw: async () => [{ result: 1 }],
    $executeRaw: async () => 1,
    $transaction: async <T>(fn: (tx: MockPrisma) => Promise<T>) => fn(mock),
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

export function createMockFastify(): MockFastifyInstance {
  const registeredRoutes = new Map<string, (req: any, reply: any) => any>();
  const resolveHandler = (
    optionsOrHandler: unknown,
    handler?: (req: any, reply: any) => any
  ): ((req: any, reply: any) => any) => {
    if (typeof optionsOrHandler === "function") {
      return optionsOrHandler as (req: any, reply: any) => any;
    }
    if (typeof handler !== "function") {
      throw new Error("Mock fastify: handler must be a function");
    }
    return handler;
  };
  return {
    prisma: { $queryRaw: async () => [{ result: 1 }] },
    post: (path, optionsOrHandler, handler) => {
      registeredRoutes.set(`POST:${path}`, resolveHandler(optionsOrHandler, handler));
    },
    get: (path, optionsOrHandler, handler) => {
      registeredRoutes.set(`GET:${path}`, resolveHandler(optionsOrHandler, handler));
    },
    registeredRoutes,
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
      // No-op in tests; appendEventInTx already recorded the event.
    },
    publishedEvents,
  };
}

export function createMockCQRSBus(): MockCQRSBus {
  const executedCommands: Command[] = [];
  return {
    executeCommand: async (command: Command) => {
      executedCommands.push(command);
      return { success: true, data: { id: command.aggregateId, version: 1 } };
    },
    executedCommands,
  };
}

export function createMockRedis(): MockRedis {
  const storage = new Map<string, string>();
  return {
    setex: async (key: string, _ttl: number, data: string) => {
      storage.set(key, data);
    },
    get: async (key: string) => storage.get(key) ?? null,
    keys: async (pattern: string) => {
      const prefix = pattern.replace("*", "");
      return Array.from(storage.keys()).filter((k) => k.startsWith(prefix));
    },
    ping: async () => "PONG",
  };
}

export function createMockQueue(): MockQueue {
  const enqueuedJobs: QueueJob[] = [];
  let jobCounter = 0;

  return {
    enqueuedJobs,
    async enqueue(job: QueueJob): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">> {
      jobCounter++;
      const jobId = job.id ?? `mock-job-${jobCounter}`;
      enqueuedJobs.push({ ...job, id: jobId });
      return ok(jobId);
    },
    async health(): Promise<Result<QueueHealth, "CONNECTION_ERROR">> {
      return ok({
        connected: true,
        waiting: enqueuedJobs.length,
        active: 0,
        completed: 0,
        failed: 0,
      });
    },
    async remove(_jobId: string): Promise<Result<boolean, "CONNECTION_ERROR" | "NOT_FOUND">> {
      return ok(true);
    },
  };
}

function createMockProjectRepo() {
  return {
    findById: async (id: any) => {
      const idStr = id?.toString?.() ?? String(id);
      if (idStr === TEST_PROJECT_ID) {
        // Duck-typed Project: SagaIntegration only reads `project.accountId.toString()`.
        return ok({
          accountId: { toString: () => TEST_ACCOUNT_ID },
        }) as any;
      }
      return { ok: false, error: { kind: "NotFound" } } as any;
    },
    findByAccountId: async () => [],
    save: async () => ok(undefined),
    delete: async () => ok(undefined),
    hardDelete: async () => ok(undefined),
    exists: async () => true,
    findByName: async () => null,
    findPublishLogsByProjectId: async () => [],
  };
}

function createMockPostRepo() {
  return {
    findById: async (id: any) => {
      const idStr = id?.toString?.() ?? String(id);
      if (idStr === TEST_EXISTING_DRAFT_POST_ID) {
        // Duck-typed PostAggregate: SagaIntegration only reads
        // `post.projectId.toString()` and `post.status.value`.
        return ok({
          projectId: { toString: () => TEST_PROJECT_ID },
          status: { value: "DRAFT" },
        }) as any;
      }
      return { ok: false, error: { kind: "NotFound" } } as any;
    },
    findByProjectId: async () => ({ items: [], total: 0, page: 1, limit: 20 }),
    findByStatus: async () => ({ items: [], total: 0, page: 1, limit: 20 }),
    findReadyForPublishing: async () => [],
    findWithFilters: async () => ({ items: [], total: 0, page: 1, limit: 20 }),
    countByProjectId: async () => 0,
    countByStatus: async () => 0,
    save: async () => ok(undefined),
    delete: async () => ok(undefined),
    exists: async () => false,
  };
}

function createMockChannelRepo() {
  return {
    findById: async () => ({ ok: false, error: {} }),
    findByProjectId: async () =>
      TEST_CHANNEL_IDS.map((cid) => ({
        id: { toString: () => cid },
      })) as any,
    findByProjectAndProvider: async () => [],
    bulkMarkForReauthByProvider: async () => ({ count: 0, channelIds: [] }),
    bulkSoftDeleteByProvider: async () => ({ count: 0, channelIds: [] }),
    findPrimaryByProjectAndProvider: async () => ({ ok: false, error: {} }),
    findByProjectProviderAccount: async () => null,
    findUsageByChannelIds: async () => new Map(),
    save: async () => ok(undefined),
    delete: async () => ok(undefined),
    hardDelete: async () => ok(undefined),
  };
}

/**
 * Build a fully initialized SagaIntegration with isolated mocks.
 * Returns the integration instance AND the registered-routes map so callers
 * can invoke handlers directly without going through a real HTTP layer.
 */
export async function buildIntegration(): Promise<{
  integration: SagaIntegration;
  routes: Map<string, (req: any, reply: any) => any>;
  mockEventService: MockEventService;
  mockCQRSBus: MockCQRSBus;
  mockRedis: MockRedis;
}> {
  const mockFastify = createMockFastify();
  const mockEventService = createMockEventService();
  const mockCQRSBus = createMockCQRSBus();
  const mockRedis = createMockRedis();
  const mockPrisma = createMockPrisma();
  const mockQueue = createMockQueue();

  const integration = new SagaIntegration({
    fastify: mockFastify as any,
    prisma: mockPrisma as any,
    eventService: mockEventService as any,
    cqrsBus: mockCQRSBus as any,
    redis: mockRedis as any,
    queue: mockQueue,
    scheduler: new NoopBackgroundTaskScheduler(),
    projectRepository: createMockProjectRepo() as any,
    channelRepository: createMockChannelRepo() as any,
    postRepository: createMockPostRepo() as any,
  });

  await integration.initialize();

  return {
    integration,
    routes: mockFastify.registeredRoutes,
    mockEventService,
    mockCQRSBus,
    mockRedis,
  };
}

export function makeStartRequest(
  overrides: Partial<{
    body: string;
    channelIds: string[];
    priority: string;
    mode: "draft" | "schedule" | "publish-now";
    scheduledAt: string;
    title: string;
    locale: string;
    projectId: string;
    accountId: string;
  }> = {}
) {
  const mode = overrides.mode ?? "publish-now";
  const baseBody = {
    projectId: overrides.projectId ?? TEST_PROJECT_ID,
    locale: overrides.locale ?? "en",
    body: overrides.body ?? "Test post content",
    tags: [],
    mediaIds: [],
    ...(overrides.title ? { title: overrides.title } : {}),
  };

  let body: Record<string, unknown>;
  if (mode === "draft") {
    body = { mode, ...baseBody };
  } else if (mode === "schedule") {
    body = {
      mode,
      ...baseBody,
      channelIds: overrides.channelIds ?? [TEST_CHANNEL_IDS[0]],
      scheduledAt: overrides.scheduledAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  } else {
    body = {
      mode,
      ...baseBody,
      channelIds: overrides.channelIds ?? [TEST_CHANNEL_IDS[0]],
    };
  }

  return {
    body,
    customerUser: {
      id: TEST_CUSTOMER_ID,
      accountId: overrides.accountId ?? TEST_ACCOUNT_ID,
      role: "owner",
    },
    headers: {},
    ip: "127.0.0.1",
  };
}

/** Minimal reply stub that returns whatever is sent. */
export const passthroughReply = { send: (data: any) => data };
