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

import { vi } from "vitest";
import { EventStoreEvent } from "@shared/types/events.js";
import { Command } from "@shared/types/cqrs.js";
import { ok } from "@shared/types";
import type {
  QueuePort,
  QueueJob,
  QueueHealth,
  JobStatesAggregate,
  SemanticLockPort,
} from "@ports/core";
import type { Result } from "@shared/types";
import {
  ATTEMPT_CLASSIFICATIONS,
  CHANNEL_FAILURE_CODES,
  ChannelId,
  Content,
  ContentFingerprint,
  FragmentReference,
  PostAggregate,
  PostId,
  ProjectId,
  PublishStatus,
  providedReference,
  PUBLICATION_OUTCOME_KINDS,
  type AttemptResult,
} from "@core/domain/index.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";

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
  publishEvent: (event: EventStoreEvent) => Promise<void>;
  appendEventInTx: (tx: unknown, event: EventStoreEvent) => Promise<void>;
  broadcastEvent: (event: EventStoreEvent) => Promise<void>;
  publishedEvents: EventStoreEvent[];
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
 * Subscriber-mode Redis double for the saga pub/sub connection injected via
 * `sagaSubscriber`. Records subscribe/message wiring so tests can assert the
 * INJECTED connection is the one used (not a self-constructed one).
 */
export interface MockSubscriber {
  connect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
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
    /** The boot load counts before it pages, so it can report what it deferred. */
    count: (args?: any) => Promise<number>;
    findMany: (args?: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
  };
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createMockPrisma(): MockPrisma {
  const store = new Map<string, any>();

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

/**
 * Build a subscriber-mode Redis double. `setupEventHandling()` calls
 * `connect()`, `on()`, then `subscribe(channel)` on the INJECTED connection —
 * recording these lets tests prove the injected subscriber is the one used.
 */
export function createMockSubscriber(): MockSubscriber {
  return {
    connect: vi.fn(async () => undefined),
    on: vi.fn(),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    disconnect: vi.fn(),
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
    async enqueueBulk(
      jobs: QueueJob[]
    ): Promise<Result<string[], "CONNECTION_ERROR" | "VALIDATION_ERROR">> {
      const ids: string[] = [];
      for (const job of jobs) {
        jobCounter++;
        const jobId = job.id ?? `mock-job-${jobCounter}`;
        enqueuedJobs.push({ ...job, id: jobId });
        ids.push(jobId);
      }
      return ok(ids);
    },
    // The saga's fallback poll calls this. The double did not HAVE it, so any test that
    // reached the poll would have failed on a missing method rather than on the state it
    // was asserting — invisible to `tsc`, because no tsconfig opens this file.
    async getJobStates(jobIds: string[]): Promise<Result<JobStatesAggregate, "CONNECTION_ERROR">> {
      return ok({ completed: 0, failed: 0, pending: jobIds.length });
    },
    async health(): Promise<Result<QueueHealth, "CONNECTION_ERROR">> {
      return ok({
        connected: true,
        waiting: enqueuedJobs.length,
        active: 0,
        completed: 0,
        failed: 0,
        consumers: 1,
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
    findByIdIncludingDeleted: async (id: any) => {
      const idStr = id?.toString?.() ?? String(id);
      if (idStr === TEST_PROJECT_ID) {
        return ok({
          accountId: { toString: () => TEST_ACCOUNT_ID },
        }) as any;
      }
      return { ok: false, error: { kind: "NotFound" } } as any;
    },
    findByAccountId: async () => [],
    save: async () => ok(undefined),
    delete: async () => ok(undefined),
    restore: async () => ok(undefined),
    hardDelete: async () => ok(undefined),
    exists: async () => true,
    findByName: async () => null,
    findPublishLogsByProjectId: async () => [],
  };
}

const FIXTURE_ACCOUNT_UUID = "a0000000-0000-4000-8000-000000000001";
const FIXTURE_MOMENT = new Date("2026-03-01T09:00:00.000Z");

/**
 * Build the existing post `TEST_EXISTING_DRAFT_POST_ID` resolves to.
 *
 * A REAL aggregate, not a duck type. The route reads the post's publication record now,
 * and a stand-in carrying only the two fields the route used to read would have answered
 * `undefined` for the record on every call — which is not "no record", it is a crash, and
 * `tsc` never opens this file to say so.
 *
 * @param status - The post's word; DRAFT unless a case is about another one.
 * @returns The aggregate.
 */
export function makeExistingPost(status: PublishStatus = PublishStatus.draft()): PostAggregate {
  return PostAggregate.reconstitute({
    id: PostId.fromStringUnsafe(TEST_EXISTING_DRAFT_POST_ID),
    projectId: ProjectId.fromStringUnsafe(TEST_PROJECT_ID),
    accountId: FIXTURE_ACCOUNT_UUID,
    content: Content.reconstitute({ body: "Test post content", tags: [], locale: "en" }),
    status,
    media: [],
    contentVersions: [],
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    version: 3,
  });
}

/**
 * Declare one channel's targets and open the first episode, so an attempt can be recorded
 * against it.
 *
 * @param post - The aggregate to prepare.
 * @param channels - The channels to declare.
 */
function openTargets(post: PostAggregate, channels: readonly string[]): void {
  const declared = post.declarePublicationTargets(
    channels.map((id) => ChannelId.fromStringUnsafe(id))
  );
  if (!declared.ok) {
    throw new Error(`fixture could not declare targets: ${declared.error.message}`);
  }
  const opened = post.openPublicationEpisode({ enterPublishing: false });
  if (!opened.ok) {
    throw new Error(`fixture could not open an episode: ${opened.error.message}`);
  }
  post.clearDomainEvents();
}

/**
 * @function recordAttempt
 * @description Records one attempt's result against a prepared post.
 * @param post - The prepared aggregate.
 * @param channel - The channel the attempt was for.
 * @param result - What the attempt produced.
 */
function recordAttempt(post: PostAggregate, channel: string, result: AttemptResult): void {
  const recorded = post.recordChannelAttempt({
    channelId: ChannelId.fromStringUnsafe(channel),
    episode: 1,
    attemptNo: 1,
    planSize: 1,
    result,
    now: FIXTURE_MOMENT,
  });
  if (!recorded.ok) {
    throw new Error(`fixture could not record an attempt: ${recorded.error.message}`);
  }
  post.clearDomainEvents();
}

/**
 * A post whose only channel published: its record holds nothing re-drivable, which is the
 * shape the duplicate-send guard has to keep refusing once the record is the truth.
 *
 * @returns The aggregate.
 */
export function makeFullyPublishedPost(): PostAggregate {
  const post = makeExistingPost(PublishStatus.scheduled());
  openTargets(post, [TEST_CHANNEL_IDS[0]!]);
  const head = providedReference("frag-1");
  if (!head.ok) {
    throw new Error("fixture head reference must build");
  }
  recordAttempt(post, TEST_CHANNEL_IDS[0]!, {
    kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    fragments: [buildFragment(1)],
    publishedAt: FIXTURE_MOMENT,
    contentHash: ContentFingerprint.ofContent({ body: "Test post content", mediaIds: [] }),
  });
  return post;
}

/**
 * A post whose first channel failed with fragments still live on the provider, and whose
 * second channel is still owed an attempt.
 *
 * @returns The aggregate.
 */
export function makeStrandedPost(): PostAggregate {
  const post = makeExistingPost(PublishStatus.scheduled());
  openTargets(post, [TEST_CHANNEL_IDS[0]!, TEST_CHANNEL_IDS[1]!]);
  recordAttempt(post, TEST_CHANNEL_IDS[0]!, {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
    code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
    publishedFragments: [buildFragment(1)],
  });
  return post;
}

/**
 * @function buildFragment
 * @description One fragment reference for the fixtures.
 * @param index - Its one-based position in the thread.
 * @returns The reference.
 */
function buildFragment(index: number): FragmentReference {
  const fragment = FragmentReference.create({ index, externalId: `frag-${index}` });
  if (!fragment.ok) {
    throw new Error("fixture fragment must build");
  }
  return fragment.value;
}

function createMockPostRepo(post: PostAggregate) {
  return {
    findById: async (id: any) => {
      const idStr = id?.toString?.() ?? String(id);
      if (idStr === TEST_EXISTING_DRAFT_POST_ID) {
        // canon-exception: test-fixture — the double answers the port's Result shape
        // without implementing the port's full error union, which a negative case needs.
        return ok(post) as any;
      }
      return { ok: false, error: { kind: "NotFound" } } as any;
    },
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
    findIdsByProjectId: async () => TEST_CHANNEL_IDS.map((cid) => ({ toString: () => cid })) as any,
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
export async function buildIntegration(
  overrides: {
    /** The aggregate `TEST_EXISTING_DRAFT_POST_ID` resolves to; a record-less DRAFT by default. */
    post?: PostAggregate;
    /** The semantic-lock backend; omitted, as in a deployment that runs without one. */
    lockStore?: SemanticLockPort;
  } = {}
): Promise<{
  integration: SagaIntegration;
  routes: Map<string, (req: any, reply: any) => any>;
  mockEventService: MockEventService;
  mockCQRSBus: MockCQRSBus;
  mockRedis: MockRedis;
  mockSubscriber: MockSubscriber;
}> {
  const mockFastify = createMockFastify();
  const mockEventService = createMockEventService();
  const mockCQRSBus = createMockCQRSBus();
  const mockRedis = createMockRedis();
  const mockSubscriber = createMockSubscriber();
  const mockPrisma = createMockPrisma();
  const mockQueue = createMockQueue();

  const integration = new SagaIntegration({
    fastify: mockFastify as any,
    prisma: mockPrisma as any,
    eventService: mockEventService as any,
    cqrsBus: mockCQRSBus as any,
    redis: mockRedis as any,
    sagaSubscriber: mockSubscriber as any,
    queue: mockQueue,
    scheduler: new NoopBackgroundTaskScheduler(),
    projectRepository: createMockProjectRepo() as any,
    channelRepository: createMockChannelRepo() as any,
    // canon-exception: test-fixture — the double implements the members the admission
    // reads, not the whole PostRepository port.
    postRepository: createMockPostRepo(overrides.post ?? makeExistingPost()) as any,
    ...(overrides.lockStore && { lockStore: overrides.lockStore }),
  });

  await integration.initialize();

  return {
    integration,
    routes: mockFastify.registeredRoutes,
    mockEventService,
    mockCQRSBus,
    mockRedis,
    mockSubscriber,
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
      roleId: "role-owner",
      roleName: "OWNER",
      permissions: [],
    },
    headers: {},
    ip: "127.0.0.1",
  };
}

/** Minimal reply stub that returns whatever is sent. */
export const passthroughReply = { send: (data: any) => data };
