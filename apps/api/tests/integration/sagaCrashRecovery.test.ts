/**
 * @file sagaCrashRecovery.test.ts
 * @description MERGE-BLOCKING crash-recovery proof for the saga engine, run
 *   against a REAL Postgres, a REAL Redis and a REAL BullMQ queue, and booted
 *   through the REAL production composition: every manager here is a
 *   `SagaIntegration` built the way the API bootstrap builds it — a base client
 *   extended with `tenantGuardExtension`, a real `CQRSBusImpl` carrying the real
 *   post command handlers, the real queue adapter, and the real post-publishing
 *   saga definition. The wrapper owns the ORDER in which definitions are
 *   registered and the manager initializes, and that order is itself under test:
 *   a harness that registers first and boots second exercises a wiring
 *   production does not have and cannot fail on a composition defect.
 *
 *   Four properties are under test, and each one needs a process boundary that
 *   in-memory state cannot fake:
 *
 *     - RESUME — a saga interrupted BEFORE its pivot must be dispatched exactly
 *       once by the process that inherits it and must reach a terminal state
 *       with no operator action. This is the capability the change exists to
 *       ship, so it is asserted positively, never inferred from the absence of
 *       failures.
 *     - CRASH REPLAY — a saga whose durable row was written BEFORE the pivot's
 *       side effect reached the queue must NOT be replayed by the boot pass. The
 *       absorber is the BullMQ job id (the queue adapter passes the step's
 *       dedupe key straight through as the job id), and the post-pivot status
 *       transition CLAIMS to tolerate re-application. Both are measured here
 *       instead of trusted: a tolerance that only exists in a comment is not a
 *       recovery guarantee.
 *     - THE PARKED WINDOW — a parked row is excluded from the ordinary timeout
 *       sweep and terminalizes only after a full operator window measured from
 *       the moment of parking, under its own failure class. Both halves are
 *       fired through the noop scheduler here, because an operator contract
 *       nothing exercises is a comment.
 *     - TERMINAL SAFETY — a restart must not touch a saga that already reached
 *       a terminal state, and a failure at or past the pivot must compensate
 *       nothing: the pivot is the point of no return, so walking back over it
 *       would undo state a provider may already have accepted.
 *
 *   Every recovery tick is fired explicitly through the noop scheduler, and the
 *   persisted `nextRetryAt` is moved into the past before each tick. The retry
 *   envelope is 5s + 10s + 20s of wall time otherwise, and a suite that waits it
 *   out measures the clock rather than the engine. Negative assertions are gated
 *   on a POSITIVE synchronization point — a canary saga seeded into the same
 *   boot whose terminal state proves the pass's detached dispatches ran — never
 *   on a sleep, which a slow runner turns into a false green.
 *
 *   Requires Postgres + Redis up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import pino from "pino";
import { Queue, Worker, type Job } from "bullmq";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { createBullMQQueueAdapter, type BullMQQueueAdapter } from "@adapters/queue-bullmq";
import {
  createPostPublishingSagaDefinition,
  createSagaContext,
  type SagaInstance,
} from "@shared/types/saga.js";
import type { Command, CommandResult } from "@shared/types/cqrs.js";
import { InMemoryEventDispatcher } from "@core/domain/index.js";
import { CreatePostUseCase, UpdatePostUseCase, DeletePostUseCase } from "@core/posts/index.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import {
  getSystemContext,
  getTenantContext,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import type { SagaManagerImpl } from "../../src/saga/SagaManager.js";
import type { SagaManagerLifecycle } from "../../src/saga/SagaManagerLifecycle.js";
import { CQRSBusImpl } from "../../src/cqrs/CQRSBus.js";
import { EventService } from "../../src/events/EventService.js";
import { logger } from "../../src/lib/logger.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { PrismaProjectRepository } from "../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { ChannelCredentialsCrypto } from "../../src/security/ChannelCredentialsCrypto.js";
import { EncryptionService } from "../../src/security/EncryptionService.js";
import {
  CreatePostCommandHandler,
  UpdatePostCommandHandler,
} from "../../src/cqrs/handlers/PostCommandHandlers.js";

const TAG = `saga-crash-${Date.now()}`;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const QUEUE_NAME = `${TAG}-publish`;
const RETRY_RECOVERY_TASK_ID = "saga-retry-recovery";
const TIMEOUT_CHECKER_TASK_ID = "saga-timeout-checker";

/**
 * The definition's own arithmetic, read once. Every index the scenarios below
 * seed derives from here rather than from a literal: "this row sits at the
 * pivot" is the premise the whole suite rests on, and a bare `2` states it only
 * in prose while the engine reads `definition.pivotStepIndex`. The callbacks are
 * inert — this instance is never executed, it is consulted.
 */
const REFERENCE_DEFINITION = createPostPublishingSagaDefinition(
  async () => ({ success: true }),
  async () => "the reference definition is consulted, never executed",
  async () => ({ completed: 0, failed: 0, pending: 0 }),
  async () => null
);
const PUBLISHING_SAGA_ID = REFERENCE_DEFINITION.id;
const PIVOT_STEP_INDEX = REFERENCE_DEFINITION.pivotStepIndex;
const LAST_STEP_INDEX = REFERENCE_DEFINITION.steps.length - 1;
const MAX_RETRIES = REFERENCE_DEFINITION.retryPolicy?.maxRetries ?? 3;
const SAGA_TIMEOUT_MS = REFERENCE_DEFINITION.timeout ?? 30 * 60 * 1000;

/** The three states the saga canon accepts as an ending. */
const TERMINAL_STATES: ReadonlyArray<SagaInstance["status"]> = [
  "COMPLETED",
  "FAILED",
  "COMPENSATED",
];

/**
 * The persisted stream key for a saga's durable events. The event store applies
 * its own `stream:` prefix on top of `<aggregateType>:<aggregateId>`, so the
 * unprefixed form matches no row at all — a cleanup written without it deletes
 * nothing while reading as thorough.
 */
function sagaStreamId(sagaId: string): string {
  return `stream:Saga:${sagaId}`;
}

/** The persisted stream key for a post's durable events. */
function postStreamId(postId: string): string {
  return `stream:Post:${postId}`;
}

/**
 * The publish job's dedupe key, which the queue adapter passes through as the
 * BullMQ job id. The saga this suite drives is the PRODUCTION definition, so
 * this expression is the expectation the assertions check production against —
 * it is never the value production used.
 */
function publishDedupeKey(postId: string, channelId: string): string {
  return `publish-${postId}-${channelId}`;
}

/** Parses one pino line, returning null when the chunk is not JSON. */
function safeParseLogLine(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Runs `action` with the shared logger's destination swapped for a recorder.
 * The engine logs through a module-scoped pino instance, so intercepting its
 * stream is the only way to assert what an operator would actually see — and
 * for a decision the engine reports rather than acts on, the log IS the output.
 */
async function captureLogs(action: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const streamSymbol = pino.symbols.streamSym;
  const holder = logger as unknown as Record<symbol, unknown>;
  const original = holder[streamSymbol];
  // The configured level filters BEFORE the stream, so a recorder alone sees
  // nothing an operator would only see with a lower threshold — the routine
  // boot summary among them. The level is lowered for the capture and put back.
  const originalLevel = logger.level;
  logger.level = "trace";
  const lines: Record<string, unknown>[] = [];

  holder[streamSymbol] = {
    write(chunk: string): void {
      for (const raw of chunk.split("\n")) {
        if (raw.trim().length === 0) continue;
        const parsed = safeParseLogLine(raw);
        if (parsed !== null) {
          lines.push(parsed);
        }
      }
    },
  };

  try {
    await action();
  } finally {
    holder[streamSymbol] = original;
    logger.level = originalLevel;
  }

  return lines;
}

/** One command the saga issued, recorded where the CQRS bus hands it to a handler. */
interface RecordedCommand {
  id: string;
  type: string;
}

/** One BullMQ job a worker actually executed — the external side effect. */
interface ProcessedJob {
  jobId: string;
  postId: string;
  channelId: string;
}

/** The saga row fields every assertion below reads. */
interface SagaSnapshot {
  status: string;
  currentStep: number;
  updatedAt: Date;
  nextRetryAt: Date | null;
  error: string | null;
  retryCount: number;
  compensationResults: unknown;
  context: unknown;
}

/** The post fields that prove a replay produced no second outcome. */
interface PostSnapshot {
  status: string;
  version: number;
  publishedAt: Date | null;
}

/** The command-handler shape the recorder wraps, widened to any saga command. */
interface RecordableCommandHandler {
  commandType: string;
  handle(command: Command): Promise<CommandResult<unknown>>;
}

/** One production composition under test, and the handles the scenarios drive. */
interface Harness {
  label: string;
  integration: SagaIntegration;
  manager: SagaManagerImpl;
  lifecycle: SagaManagerLifecycle;
  scheduler: NoopBackgroundTaskScheduler;
  fastify: FastifyInstance;
  subscriber: Redis;
}

describe("Saga crash recovery (MERGE-BLOCKING)", { concurrency: 1 }, () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let redis: Redis;
  let queueConnection: Redis;
  let workerConnection: Redis;
  let eventService: EventService;
  // Left optional on purpose: the teardown runs even when the setup above
  // failed halfway, and a close() on an unbuilt handle would mask that failure
  // behind a TypeError.
  let queueAdapter: BullMQQueueAdapter | undefined;
  let inspectQueue: Queue | undefined;
  let worker: Worker | undefined;

  let accountId: string;
  let customerUserId: string;
  let projectId: string;
  /** Channel whose publish job the worker completes. */
  let deliveringChannelId: string;
  /**
   * Channel whose publish job the worker rejects, so the wait step exhausts.
   * Seeded with an id no job can carry because the worker closure compares
   * against it from the moment the queue is live, which is before the channel
   * fixtures exist.
   */
  let rejectingChannelId = "";

  let handlerConfig: ConstructorParameters<typeof CreatePostCommandHandler>[0];
  let projectRepository: PrismaProjectRepository;
  let channelRepository: PrismaChannelRepository;
  let postRepository: PrismaPostRepository;

  const dispatchedCommands: RecordedCommand[] = [];
  const processedJobs: ProcessedJob[] = [];
  const createdSagaIds: string[] = [];
  const harnesses: Harness[] = [];

  /** Business metrics are counters; the recovery properties do not read them. */
  const businessMetrics: BusinessMetricsPort = {
    incrementPostCreated: () => undefined,
    incrementPostPublished: () => undefined,
    incrementPostDeleted: () => undefined,
  };

  /** The producer adapter, once the harness has built it. */
  function producer(): BullMQQueueAdapter {
    assert.ok(queueAdapter, "the queue adapter must exist before a saga enqueues through it");
    return queueAdapter;
  }

  /** The read-only queue handle used to inspect what the pivot enqueued. */
  function inspector(): Queue {
    assert.ok(inspectQueue, "the inspection queue must exist before the jobs are read");
    return inspectQueue;
  }

  /**
   * Wraps a real command handler so every command the saga issues is recorded
   * at the seam the bus hands it over, while the real handler still answers it.
   * Recording here rather than replacing the executor keeps the OCC token the
   * post-pivot step passes under evaluation by the real use case.
   */
  function recordingHandler(inner: RecordableCommandHandler): RecordableCommandHandler {
    return {
      commandType: inner.commandType,
      handle: async (command: Command): Promise<CommandResult<unknown>> => {
        dispatchedCommands.push({ id: command.id, type: command.type });
        return await inner.handle(command);
      },
    };
  }

  /**
   * The lifecycle behind the facade. Reached through a documented cast because
   * the in-memory recovery state the operator contract rests on — which rows the
   * process tracks, and WHEN each parked row's operator window opened — is
   * deliberately not public API. A test that could only read the database could
   * not distinguish "still inside the window" from "the checker never ran".
   */
  function lifecycleOf(manager: SagaManagerImpl): SagaManagerLifecycle {
    return (manager as unknown as { lifecycle: SagaManagerLifecycle }).lifecycle;
  }

  /**
   * Builds one production composition WITHOUT booting it.
   *
   * Everything the API bootstrap passes to `SagaIntegration` is passed here: the
   * guarded client, the real event service, a real CQRS bus carrying the real
   * post handlers, the real queue adapter and the real repositories. What the
   * wrapper then does with them — in particular WHEN it registers the saga
   * definitions relative to `sagaManager.initialize()` — is production's own
   * decision, and it is exactly what these scenarios exercise.
   */
  function buildHarness(label: string): Harness {
    const scheduler = new NoopBackgroundTaskScheduler();
    const fastify = Fastify({ logger: false });
    // lazyConnect: the integration calls `.connect()` on this socket itself,
    // and ioredis rejects a connect() on an already-connecting connection.
    const subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

    const cqrsBus = new CQRSBusImpl({
      eventService,
      redis,
      enableMetrics: false,
      enableQueryCache: false,
    });
    cqrsBus.registerCommandHandler(recordingHandler(new CreatePostCommandHandler(handlerConfig)));
    cqrsBus.registerCommandHandler(recordingHandler(new UpdatePostCommandHandler(handlerConfig)));

    const integration = new SagaIntegration({
      fastify,
      prisma: guarded,
      eventService,
      cqrsBus,
      redis,
      sagaSubscriber: subscriber,
      queue: producer(),
      scheduler,
      projectRepository,
      channelRepository,
      postRepository,
    });

    const manager = integration.getSagaManager();
    const harness: Harness = {
      label,
      integration,
      manager,
      lifecycle: lifecycleOf(manager),
      scheduler,
      fastify,
      subscriber,
    };
    harnesses.push(harness);
    return harness;
  }

  /** Builds a composition and boots it exactly as the API bootstrap boots it. */
  async function bootHarness(label: string): Promise<{
    harness: Harness;
    logLines: Record<string, unknown>[];
  }> {
    const harness = buildHarness(label);
    const logLines = await captureLogs(async () => {
      await harness.integration.initialize();
    });
    return { harness, logLines };
  }

  /** The boot summary this pass emitted, which is the pass's operator-facing output. */
  function bootSummary(logLines: Record<string, unknown>[]): Record<string, unknown> {
    const summary = logLines.find((line) => line.msg === "Saga boot recovery pass complete");
    assert.ok(summary, "the pass emits a summary an operator can read at a glance");
    return summary;
  }

  async function sagaSnapshot(sagaId: string): Promise<SagaSnapshot> {
    return await base.sagaInstance.findUniqueOrThrow({
      where: { id: sagaId },
      select: {
        status: true,
        currentStep: true,
        updatedAt: true,
        nextRetryAt: true,
        error: true,
        retryCount: true,
        compensationResults: true,
        context: true,
      },
    });
  }

  async function postSnapshot(postId: string): Promise<PostSnapshot> {
    return await base.post.findUniqueOrThrow({
      where: { id: postId },
      select: { status: true, version: true, publishedAt: true },
    });
  }

  /** The post id the saga's create step recorded in its persisted context. */
  function readCreatedPostId(context: unknown): string {
    const stepData = (context as { stepData?: Record<string, unknown> } | null)?.stepData;
    const created = stepData?.["create-post"] as { postId?: unknown } | undefined;
    assert.ok(
      typeof created?.postId === "string",
      "the saga context must carry the post its create step persisted"
    );
    return created.postId;
  }

  /** How many publish jobs a worker executed for one (post, channel) pair. */
  function processedCountFor(postId: string, channelId: string): number {
    return processedJobs.filter((job) => job.postId === postId && job.channelId === channelId)
      .length;
  }

  /** Commands issued by one saga, in order, since a recorded offset. */
  function commandsForSaga(sagaId: string, since = 0): RecordedCommand[] {
    return dispatchedCommands.slice(since).filter((command) => command.id.includes(sagaId));
  }

  /**
   * Polls `probe` until it answers, or fails with the reason it never did. One
   * implementation for every wait in the suite, so no scenario invents its own
   * tick, deadline or failure message.
   */
  async function pollUntil<T>(
    probe: () => Promise<T | null>,
    describeExpectation: () => string,
    timeoutMs = 20_000
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const answer = await probe();
      if (answer !== null) return answer;
      if (Date.now() > deadline) {
        assert.fail(`timed out after ${timeoutMs}ms waiting for ${describeExpectation()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /**
   * Drives a saga to a terminal state through the mechanism that OWNS it,
   * without spending the retry envelope in wall time.
   *
   * A due retry is moved into the past and the recovery tick is fired; a row
   * with NO pending retry is never touched here, because that class belongs to
   * the boot pass and quietly handing it to the checker would hide exactly the
   * gap these tests exist to expose.
   */
  async function driveToTerminal(
    sagaId: string,
    scheduler: NoopBackgroundTaskScheduler,
    description: string,
    timeoutMs = 20_000
  ): Promise<SagaSnapshot> {
    let last: SagaSnapshot | undefined;
    return await pollUntil(
      async () => {
        const snapshot = await sagaSnapshot(sagaId);
        last = snapshot;
        if (TERMINAL_STATES.includes(snapshot.status as SagaInstance["status"])) {
          return snapshot;
        }
        if (snapshot.nextRetryAt !== null) {
          await base.sagaInstance.update({
            where: { id: sagaId },
            data: { nextRetryAt: new Date(Date.now() - 1_000) },
          });
          await scheduler.triggerTask(RETRY_RECOVERY_TASK_ID, { swallowErrors: true });
        }
        return null;
      },
      () =>
        `${description}: the saga is still ${String(last?.status)} at step ` +
        `${String(last?.currentStep)} (nextRetryAt=${String(last?.nextRetryAt)}, ` +
        `retryCount=${String(last?.retryCount)}, error=${String(last?.error)})`,
      timeoutMs
    );
  }

  /** Starts one publish-now saga through a harness, under the tenant's scope. */
  async function startPublishNowSaga(
    harness: Harness,
    channelId: string,
    label: string
  ): Promise<SagaInstance> {
    const started = await withTenantContext({ accountId }, () =>
      harness.manager.startSaga(
        PUBLISHING_SAGA_ID,
        createSagaContext({
          sagaId: "",
          correlationId: `corr-${TAG}-${label}`,
          accountId,
          userId: customerUserId,
          metadata: {
            mode: "publish-now",
            postData: {
              projectId,
              locale: "en",
              body: `crash-recovery harness post (${label})`,
              tags: [],
              mediaIds: [],
              channelIds: [channelId],
            },
            accountId,
            source: "crash-recovery-harness",
          },
        })
      )
    );
    createdSagaIds.push(started.id);
    return started;
  }

  /**
   * Runs one publish-now saga to COMPLETED and rewinds its durable row to the
   * pivot with the hot-cache copy dropped — the crash-before-persist state: the
   * row says "about to run the pivot" while the queue, the worker and the post
   * already carry everything the later steps did.
   */
  async function seedPivotInterruptedSaga(
    harness: Harness,
    label: string
  ): Promise<{ sagaId: string; postId: string; dedupeKey: string; postBefore: PostSnapshot }> {
    const started = await startPublishNowSaga(harness, deliveringChannelId, label);
    const completed = await driveToTerminal(
      started.id,
      harness.scheduler,
      `the first run of ${started.id} to finish before the simulated crash`
    );
    assert.strictEqual(
      completed.status,
      "COMPLETED",
      `the pre-crash run must finish cleanly or the replay proves nothing (error=${String(completed.error)})`
    );

    const postId = readCreatedPostId(completed.context);
    const postBefore = await postSnapshot(postId);

    await base.sagaInstance.update({
      where: { id: started.id },
      data: {
        status: "RUNNING",
        currentStep: PIVOT_STEP_INDEX,
        completedAt: null,
        nextRetryAt: null,
        retryCount: 0,
        error: null,
      },
    });
    await redis.del(`saga:${started.id}`);

    return {
      sagaId: started.id,
      postId,
      dedupeKey: publishDedupeKey(postId, deliveringChannelId),
      postBefore,
    };
  }

  /**
   * Seeds a durable row for a saga interrupted BEFORE its pivot — the class the
   * boot pass exists to rescue. A row is seeded rather than produced by killing
   * a live run because the state under test is precisely "what the database
   * holds once the process that owned it is gone", and a live manager cannot
   * leave that state without also leaving the in-memory copy that hides it.
   */
  async function seedPrePivotSaga(label: string, channelId: string): Promise<string> {
    const sagaId = `${TAG}-prepivot-${label}-${randomUUID()}`;
    createdSagaIds.push(sagaId);
    await base.sagaInstance.create({
      data: {
        id: sagaId,
        definitionId: PUBLISHING_SAGA_ID,
        status: "RUNNING",
        currentStep: 0,
        accountId,
        context: {
          sagaId,
          correlationId: `corr-${sagaId}`,
          accountId,
          userId: customerUserId,
          metadata: {
            mode: "publish-now",
            postData: {
              projectId,
              locale: "en",
              body: `crash-recovery inherited pre-pivot saga (${label})`,
              tags: [],
              mediaIds: [],
              channelIds: [channelId],
            },
            accountId,
            source: "crash-recovery-harness",
          },
          stepData: {},
          events: [],
        },
        stepResults: [],
        compensationResults: [],
        retryCount: 0,
        startedAt: new Date(),
      },
    });
    return sagaId;
  }

  /** Every BullMQ job currently holding the given custom job id. */
  async function jobsWithId(jobId: string): Promise<Job[]> {
    const job = await inspector().getJob(jobId);
    return job === undefined ? [] : [job];
  }

  /** Every job in the queue addressed at one (post, channel) pair, any state. */
  async function jobsForTarget(postId: string, channelId: string): Promise<Job[]> {
    const jobs = await inspector().getJobs([
      "waiting",
      "active",
      "delayed",
      "completed",
      "failed",
      "paused",
    ]);
    return jobs.filter((job) => {
      const data = job.data as { postId?: unknown; channelId?: unknown };
      return data.postId === postId && data.channelId === channelId;
    });
  }

  /** How many `saga.failed` audit events the durable store holds for one saga. */
  async function sagaFailedEventCount(sagaId: string): Promise<number> {
    return await base.storedEvent.count({
      where: { streamId: sagaStreamId(sagaId), eventType: "saga.failed" },
    });
  }

  before(async () => {
    base = createTestPrismaClient();
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    // The boot load spans every tenant by design, so a non-terminal row left
    // behind by ANY other suite would be loaded — and, once the pass resumes
    // what it loads, EXECUTED — by the managers below, through this suite's own
    // queue and command bus. Determinism here has to be a property of the suite
    // rather than of whatever the database happens to hold, so the precondition
    // is checked and named instead of assumed.
    const foreignInFlight = await base.sagaInstance.findMany({
      where: { status: { in: ["RUNNING", "PENDING"] } },
      select: { id: true, status: true, definitionId: true },
    });
    assert.deepStrictEqual(
      foreignInFlight,
      [],
      "this suite boots real saga managers, and a boot loads and dispatches EVERY non-terminal " +
        "row in the table; the rows listed above predate the run and would be executed by it. " +
        "Clear them (they are residue from an earlier suite or an interrupted run) and re-run."
    );

    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    // BullMQ requires `maxRetriesPerRequest: null` on the connections it blocks
    // on, and refuses to start otherwise.
    queueConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    workerConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

    eventService = new EventService({
      prisma: guarded,
      redis,
      scheduler: new NoopBackgroundTaskScheduler(),
    });
    await eventService.initialize();

    queueAdapter = createBullMQQueueAdapter({
      queueName: QUEUE_NAME,
      connection: queueConnection,
    });
    inspectQueue = new Queue(QUEUE_NAME, { connection: queueConnection });

    // Completed and failed jobs are RETAINED (no removeOnComplete/removeOnFail
    // here). That retention is what keeps the job-id dedupe meaningful across
    // the simulated restart: once a job is evicted, the same id can be added
    // again and the replay produces a second publish. The production consumer
    // keeps a bounded window, so the absorber this suite measures is
    // count-bounded in the real deployment too.
    worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        const data = job.data as { postId?: unknown; channelId?: unknown };
        processedJobs.push({
          jobId: String(job.id),
          postId: String(data.postId),
          channelId: String(data.channelId),
        });
        if (data.channelId === rejectingChannelId) {
          throw new Error("provider rejected the publish");
        }
        return { delivered: true };
      },
      { connection: workerConnection, concurrency: 1 }
    );
    await worker.waitUntilReady();

    const account = await base.account.create({
      data: {
        name: `${TAG}-account`,
        email: `${TAG}-${randomUUID()}@test.local`,
        slug: `${TAG}-${randomUUID()}`,
      },
    });
    accountId = account.id;

    const customerUser = await base.customerUser.create({
      data: {
        accountId,
        email: `${TAG}-user-${randomUUID()}@test.local`,
        passwordHash: "ignored-for-test",
        firstName: "Saga",
        lastName: "Recovery",
      },
    });
    customerUserId = customerUser.id;

    const project = await base.project.create({
      data: { name: `${TAG}-project`, accountId, locale: "en" },
    });
    projectId = project.id;

    // The credentials envelope is never decrypted by this suite — no step here
    // resolves a channel — so the columns carry inert values rather than a real
    // encryption round trip.
    const channelFixture = {
      accountId,
      projectId,
      provider: "X" as const,
      credentialsCiphertext: "unused-by-this-suite",
      credentialsIv: "unused-by-this-suite",
      credentialsAuthTag: "unused-by-this-suite",
    };
    const delivering = await base.channel.create({
      data: { ...channelFixture, handle: `${TAG}-delivering` },
    });
    deliveringChannelId = delivering.id;
    const rejecting = await base.channel.create({
      data: { ...channelFixture, handle: `${TAG}-rejecting` },
    });
    rejectingChannelId = rejecting.id;

    // The commands the saga issues run through the REAL bus and the REAL
    // handlers, so the OCC token the post-pivot step passes is evaluated by the
    // real use case and the real version-guarded repository update. A harness
    // that answered the command itself would be asserting its own tolerance,
    // not the engine's.
    postRepository = new PrismaPostRepository(guarded);
    projectRepository = new PrismaProjectRepository(guarded);
    channelRepository = new PrismaChannelRepository(
      guarded,
      new ChannelCredentialsCrypto(new EncryptionService())
    );
    handlerConfig = {
      createPostUseCase: new CreatePostUseCase(
        postRepository,
        new InMemoryEventDispatcher(),
        businessMetrics
      ),
      updatePostUseCase: new UpdatePostUseCase(postRepository, new InMemoryEventDispatcher()),
      deletePostUseCase: new DeletePostUseCase(postRepository, businessMetrics),
      postRepository,
      channelRepository,
      redis,
    };
  });

  after(async () => {
    for (const harness of harnesses) {
      harness.subscriber.disconnect();
      await harness.fastify.close().catch(() => undefined);
    }

    await worker?.close().catch(() => undefined);
    await inspectQueue?.obliterate({ force: true }).catch(() => undefined);
    await inspectQueue?.close().catch(() => undefined);
    await queueAdapter?.close().catch(() => undefined);

    let postIds: string[] = [];
    if (typeof projectId === "string") {
      postIds = (await base.post.findMany({ where: { projectId }, select: { id: true } })).map(
        (row) => row.id
      );
      await base.postMedia
        .deleteMany({ where: { postId: { in: postIds } } })
        .catch(() => undefined);
      await base.postContent
        .deleteMany({ where: { postId: { in: postIds } } })
        .catch(() => undefined);
      await base.post.deleteMany({ where: { id: { in: postIds } } }).catch(() => undefined);
    }

    await base.sagaInstance
      .deleteMany({
        where: {
          OR: [
            { id: { in: createdSagaIds } },
            ...(typeof accountId === "string" ? [{ accountId }] : []),
          ],
        },
      })
      .catch(() => undefined);
    await base.storedEvent
      .deleteMany({
        where: {
          streamId: { in: [...createdSagaIds.map(sagaStreamId), ...postIds.map(postStreamId)] },
        },
      })
      .catch(() => undefined);

    if (typeof accountId === "string") {
      await base.channel.deleteMany({ where: { accountId } }).catch(() => undefined);
      await base.customerUser.deleteMany({ where: { accountId } }).catch(() => undefined);
      await base.project.deleteMany({ where: { accountId } }).catch(() => undefined);
      await base.account.deleteMany({ where: { id: accountId } }).catch(() => undefined);
    }

    if (createdSagaIds.length > 0) {
      await redis.del(...createdSagaIds.map((id) => `saga:${id}`)).catch(() => undefined);
    }
    await redis.quit().catch(() => undefined);
    await queueConnection.quit().catch(() => undefined);
    await workerConnection.quit().catch(() => undefined);
    await base.$disconnect();
  });

  describe("a boot in the production composition order", () => {
    let parkedSagaId: string;
    let parkedPostId: string;
    let parkedDedupeKey: string;
    let postBeforeBoot: PostSnapshot;
    let parkedRowBeforeBoot: SagaSnapshot;
    let parkedRowAfterBoot: SagaSnapshot;
    let inheritedSagaId: string;
    let inheritedTerminal: SagaSnapshot;
    let processedBeforeBoot: number;
    let commandsBeforeBoot: number;
    let parkedCounterAfter: number;
    let bootLogLines: Record<string, unknown>[] = [];

    before(async () => {
      // 1. A composition runs one saga end to end, so the pivot's side effect
      //    (the publish job) and everything after it really happened, and then
      //    the durable row is rewound to the pivot.
      const { harness: crashed } = await bootHarness("crashed");
      const interrupted = await seedPivotInterruptedSaga(crashed, "replay");
      parkedSagaId = interrupted.sagaId;
      parkedPostId = interrupted.postId;
      parkedDedupeKey = interrupted.dedupeKey;
      postBeforeBoot = interrupted.postBefore;
      processedBeforeBoot = processedCountFor(parkedPostId, deliveringChannelId);
      parkedRowBeforeBoot = await sagaSnapshot(parkedSagaId);

      // 2. A saga interrupted BEFORE the pivot is inherited by the SAME boot.
      //    It carries the whole scenario's synchronization: once it reaches a
      //    terminal state the pass's detached dispatches have demonstrably run,
      //    so every "nothing happened to the parked row" assertion below is
      //    measured against a boot that provably DID work, not against a sleep.
      inheritedSagaId = await seedPrePivotSaga("inherited", deliveringChannelId);

      // 3. A process with no memory of either row boots through the production
      //    wrapper. The boot decision is a LOG and a counter, not a mutation, so
      //    both are captured here rather than reconstructed afterwards.
      commandsBeforeBoot = dispatchedCommands.length;
      const booted = await bootHarness("restarted");
      bootLogLines = booted.logLines;
      parkedCounterAfter = booted.harness.manager.getMetrics().bootParkedSagas;

      inheritedTerminal = await driveToTerminal(
        inheritedSagaId,
        booted.harness.scheduler,
        `the inherited pre-pivot saga ${inheritedSagaId} to terminalize without operator action`
      );
      parkedRowAfterBoot = await sagaSnapshot(parkedSagaId);
    });

    it("resumes the saga interrupted before its pivot and drives it to a terminal state", async () => {
      assert.strictEqual(
        inheritedTerminal.status,
        "COMPLETED",
        `the inherited pre-pivot saga must complete with no operator action (error=${String(inheritedTerminal.error)})`
      );
      assert.strictEqual(
        inheritedTerminal.currentStep,
        LAST_STEP_INDEX + 1,
        "and it must have walked every remaining step, not stopped part-way"
      );

      const issued = commandsForSaga(inheritedSagaId, commandsBeforeBoot);
      assert.deepStrictEqual(
        issued.map((command) => command.type),
        ["post.create", "post.update"],
        "exactly one command per remaining command-issuing step: a second create or a second " +
          "update would mean the resume replayed a step the row had already passed"
      );
    });

    it("reports one resume and one parked row in the boot summary", async () => {
      const summary = bootSummary(bootLogLines);

      assert.strictEqual(summary.loaded, 2, "the boot inherited exactly the two seeded rows");
      assert.strictEqual(summary.resumed, 1, "the pre-pivot row is dispatched by the pass");
      assert.strictEqual(summary.checkerOwned, 0, "neither row carries a pending retry");
      assert.strictEqual(summary.skipped, 1, "and the pivot-interrupted row is the only skip");
      assert.deepStrictEqual(
        summary.skipReasons,
        { parked: 1 },
        "the one skip is named as parking, not as an unresolvable account or a checker hand-off"
      );
    });

    it("parks the saga interrupted at the pivot instead of replaying it", async () => {
      // The row is non-terminal with NO pending retry, so the retry checker
      // never claims it: the boot pass is the only mechanism that sees it, and
      // what it does with a pivot-interrupted row is the whole decision.
      assert.strictEqual(
        parkedRowAfterBoot.status,
        "RUNNING",
        "a parked saga is left exactly as the interruption left it, not terminalized"
      );
      assert.strictEqual(
        parkedRowAfterBoot.currentStep,
        PIVOT_STEP_INDEX,
        "and it is left at the step it was cut at"
      );
      assert.strictEqual(parkedRowAfterBoot.error, null, "parking records no failure on the row");
      assert.strictEqual(
        parkedRowAfterBoot.nextRetryAt,
        null,
        "parking schedules no retry — a retry would be the replay under another name"
      );
      assert.strictEqual(
        parkedRowAfterBoot.updatedAt.toISOString(),
        parkedRowBeforeBoot.updatedAt.toISOString(),
        "and NOTHING was written to the row: a boot that re-warmed it would move updatedAt, " +
          "which is the only witness separating 'left alone' from 'rewritten identically'"
      );
    });

    it("counts the parked saga and names it in the logs", async () => {
      // A row the engine declines to recover is invisible unless it says so:
      // the counter is what an operator alerts on, the log is what tells them
      // WHICH saga needs a decision.
      assert.strictEqual(
        parkedCounterAfter,
        1,
        "the boot pass counts every saga it parks, so 'recovered nothing' is distinguishable from 'never ran'"
      );

      const parkedLine = bootLogLines.find(
        (line) => line.sagaId === parkedSagaId && line.reason === "parked"
      );
      assert.ok(parkedLine, "the parked saga must be named in the logs, not just tallied");
      assert.strictEqual(parkedLine.level, "warn", "a row awaiting a human is at least a warning");
      assert.strictEqual(
        parkedLine.currentStep,
        PIVOT_STEP_INDEX,
        "the log carries the step it was cut at, which is what makes the pivot boundary auditable"
      );
      assert.strictEqual(
        parkedLine.pivotStepIndex,
        PIVOT_STEP_INDEX,
        "and the pivot index it was measured against — a boot with no definition registered could not report it"
      );
      assert.match(
        String(parkedLine.msg),
        /PARKED/,
        "the message states the decision in the operator's vocabulary"
      );
    });

    it("dispatches nothing at all for the parked saga", async () => {
      const byId = await jobsWithId(parkedDedupeKey);
      assert.strictEqual(
        byId.length,
        1,
        `exactly one job must hold the dedupe key ${parkedDedupeKey}: the one the first run enqueued`
      );

      const byTarget = await jobsForTarget(parkedPostId, deliveringChannelId);
      assert.strictEqual(
        byTarget.length,
        1,
        "no second job is addressed at the same post and channel"
      );

      assert.strictEqual(
        processedCountFor(parkedPostId, deliveringChannelId),
        processedBeforeBoot,
        "no worker executed the publish a second time"
      );

      assert.deepStrictEqual(
        commandsForSaga(parkedSagaId, commandsBeforeBoot),
        [],
        "a parked saga runs no step, so it issues no command: the command id carries its saga id"
      );
    });

    it("leaves the parked saga's post in a single consistent state", async () => {
      const afterBoot = await postSnapshot(parkedPostId);

      assert.strictEqual(
        afterBoot.status,
        postBeforeBoot.status,
        "the parked row moved the post to no second status"
      );
      assert.strictEqual(
        afterBoot.version,
        postBeforeBoot.version,
        "and bumped its optimistic-concurrency version no second time"
      );
      assert.strictEqual(
        afterBoot.publishedAt?.toISOString() ?? null,
        postBeforeBoot.publishedAt?.toISOString() ?? null,
        "and stamped no second publication time"
      );
    });
  });

  describe("the parked saga, resumed deliberately by an operator", () => {
    let sagaId: string;
    let postId: string;
    let dedupeKey: string;
    let postBefore: PostSnapshot;
    let processedBefore: number;
    let terminal: SagaSnapshot;

    before(async () => {
      // This scenario owns its own interrupted saga rather than consuming the
      // one the previous describe asserts on: the resume below drives that row
      // to a terminal state, and a scenario that mutates another scenario's
      // subject is an ordering dependency nothing in the file states.
      const { harness: crashed } = await bootHarness("evidence-crashed");
      const interrupted = await seedPivotInterruptedSaga(crashed, "evidence");
      sagaId = interrupted.sagaId;
      postId = interrupted.postId;
      dedupeKey = interrupted.dedupeKey;
      postBefore = interrupted.postBefore;
      processedBefore = processedCountFor(postId, deliveringChannelId);

      // The replay is triggered the way a human would trigger it after reading
      // the PARKED log — the continue endpoint's engine method — so this also
      // documents what an operator gets when they take that decision today. It
      // runs on a process that INHERITED the row, because that is the only one
      // whose in-memory view matches the rewound durable state.
      const { harness: restarted } = await bootHarness("evidence-restarted");
      await restarted.manager.continueSaga(sagaId);
      terminal = await driveToTerminal(
        sagaId,
        restarted.scheduler,
        `the manually resumed saga ${sagaId} to reach a terminal state`
      );
    });

    it("records what a replay actually does: the queue absorbs the pivot, the step after it is rejected", async () => {
      // This is the evidence the parking decision rests on, kept executable so
      // it cannot quietly stop being true.
      //
      // The post-pivot step's own documentation claims the update use case
      // TOLERATES re-application of the same transition — the claim that would
      // make an automatic resume safe. Measured, it does not: the replayed
      // command carries the version the create step recorded, the first run
      // already advanced the persisted one, and the use case rejects the stale
      // token. A saga that genuinely succeeded therefore ends FAILED.

      // The absorber half of the verdict: the pivot really is replay-safe.
      const byId = await jobsWithId(dedupeKey);
      assert.strictEqual(byId.length, 1, "the replayed pivot enqueued no second job");
      const byTarget = await jobsForTarget(postId, deliveringChannelId);
      assert.strictEqual(byTarget.length, 1, "and none addressed at the same post and channel");
      assert.strictEqual(
        processedCountFor(postId, deliveringChannelId),
        processedBefore,
        "no worker published a second time: the deterministic job id absorbed the replay"
      );
      const postAfter = await postSnapshot(postId);
      assert.strictEqual(
        postAfter.status,
        postBefore.status,
        "and the post kept its single consistent status"
      );

      // The half that fails, and therefore the reason boot recovery declines.
      // The revisit signal is THIS EXACT transition — FAILED becoming
      // COMPLETED — not any red in this test: a timeout, a queue change or a
      // reworded error would also turn it red without the tolerance holding.
      assert.strictEqual(
        terminal.status,
        "FAILED",
        "the replayed saga ends FAILED; only this assertion changing to COMPLETED means the " +
          "post-pivot tolerance finally holds and the parking decision should be revisited"
      );
      assert.match(
        String(terminal.error),
        /version conflict/i,
        "and it fails for the stale optimistic-concurrency token, not for a queue side effect"
      );
    });
  });

  describe("a parked row and its operator window", () => {
    let sagaId: string;
    let restarted: Harness;

    before(async () => {
      const { harness: crashed } = await bootHarness("window-crashed");
      const interrupted = await seedPivotInterruptedSaga(crashed, "window");
      sagaId = interrupted.sagaId;

      const booted = await bootHarness("window-restarted");
      restarted = booted.harness;
      assert.ok(
        booted.logLines.some((line) => line.sagaId === sagaId && line.reason === "parked"),
        "the scenario's premise: this boot parked the row it is about to time-check"
      );

      // The saga was interrupted long ago — which is exactly why the ORDINARY
      // timeout sweep would already be past its horizon. The parked contract
      // says the horizon that applies is the one that opened at PARKING, so the
      // row is aged well past the ordinary one on purpose.
      const longAgo = new Date(Date.now() - (SAGA_TIMEOUT_MS + 60 * 60 * 1000));
      await base.sagaInstance.update({ where: { id: sagaId }, data: { startedAt: longAgo } });
      const tracked = restarted.lifecycle.activeInstances.get(sagaId);
      assert.ok(tracked, "the timeout checker only sees rows this process is tracking");
      tracked.startedAt = longAgo;
    });

    it("does not terminalize a parked row whose ordinary timeout has already passed", async () => {
      await restarted.scheduler.triggerTask(TIMEOUT_CHECKER_TASK_ID, { swallowErrors: false });

      const snapshot = await sagaSnapshot(sagaId);
      assert.strictEqual(
        snapshot.status,
        "RUNNING",
        "a parked row is excluded from the ordinary sweep: its operator window opens when it is " +
          "parked, not when the saga started, or the human is given no window at all"
      );
      assert.strictEqual(
        await sagaFailedEventCount(sagaId),
        0,
        "and no terminal audit event was written for it"
      );
    });

    it("terminalizes the parked row once its operator window expires, exactly once and as parked-expired", async () => {
      const parkedAt = restarted.lifecycle.parkedAt.get(sagaId);
      assert.ok(
        typeof parkedAt === "number",
        "the process records WHEN it parked each row, or the window has no origin"
      );
      restarted.lifecycle.parkedAt.set(sagaId, parkedAt - (SAGA_TIMEOUT_MS + 1_000));

      const firstTick = await captureLogs(async () => {
        await restarted.scheduler.triggerTask(TIMEOUT_CHECKER_TASK_ID, { swallowErrors: false });
      });

      const snapshot = await sagaSnapshot(sagaId);
      assert.strictEqual(
        snapshot.status,
        "FAILED",
        "an expired parked row reaches a terminal state: the canon forbids an infinite RUNNING"
      );
      assert.match(
        String(snapshot.error),
        /parked/i,
        "and its durable trail says the operator window expired, not that a step hung"
      );
      assert.doesNotMatch(
        String(snapshot.error),
        /timeout exceeded/i,
        "the ordinary timeout wording would send the operator to the wrong runbook"
      );

      const failure = firstTick.find(
        (line) => line.sagaId === sagaId && line.msg === "Saga failed"
      );
      assert.ok(failure, "the terminalization is logged against the saga it ended");
      assert.strictEqual(
        failure.reason,
        "parked-expired",
        "and it carries its own failure class, so the alerting series does not read it as a timeout"
      );

      assert.strictEqual(await sagaFailedEventCount(sagaId), 1, "exactly one terminal audit event");

      // The re-fail loop: a terminal row left in the tracked set is re-failed on
      // every subsequent tick, appending a fresh audit event each time.
      await restarted.scheduler.triggerTask(TIMEOUT_CHECKER_TASK_ID, { swallowErrors: false });
      await restarted.scheduler.triggerTask(TIMEOUT_CHECKER_TASK_ID, { swallowErrors: false });
      assert.strictEqual(
        await sagaFailedEventCount(sagaId),
        1,
        "and still exactly one after two more ticks: a terminal row is neither re-failed nor re-audited"
      );
    });
  });

  describe("an inherited pivot-step retry claimed by the retry checker", () => {
    let sagaId: string;
    let postId: string;
    let dedupeKey: string;
    let processedBefore: number;
    let jobIdsBefore: string[];
    let terminal: SagaSnapshot;

    before(async () => {
      const { harness: crashed } = await bootHarness("pivot-retry-crashed");
      const interrupted = await seedPivotInterruptedSaga(crashed, "pivotretry");
      sagaId = interrupted.sagaId;
      postId = interrupted.postId;
      dedupeKey = interrupted.dedupeKey;

      // Standing in for the publish worker's promotion: in production the
      // worker moves the post out of DRAFT once the provider accepts it, while
      // this suite's worker double only records the job. The state that makes a
      // pivot replay dangerous is therefore applied here explicitly.
      await base.post.update({ where: { id: postId }, data: { status: "PUBLISHED" } });

      // A pivot-step retry that outlived its process: the row carries a due
      // `nextRetryAt`, so the boot pass hands it to the checker rather than
      // parking it — the one path by which a pivot step can be re-entered
      // automatically after a restart. Its retry budget is spent, so the
      // outcome of this single re-entry is the whole answer.
      await base.sagaInstance.update({
        where: { id: sagaId },
        data: {
          status: "RUNNING",
          currentStep: PIVOT_STEP_INDEX,
          nextRetryAt: new Date(Date.now() - 1_000),
          retryCount: MAX_RETRIES,
        },
      });
      await redis.del(`saga:${sagaId}`);

      processedBefore = processedCountFor(postId, deliveringChannelId);
      jobIdsBefore = (await jobsForTarget(postId, deliveringChannelId)).map((job) =>
        String(job.id)
      );

      const { harness: restarted } = await bootHarness("pivot-retry-restarted");
      terminal = await driveToTerminal(
        sagaId,
        restarted.scheduler,
        `the checker to claim the inherited pivot-step retry ${sagaId} and settle it`
      );
    });

    it("aborts the pivot re-entry through its reread countermeasure instead of re-enqueueing", async () => {
      assert.strictEqual(
        terminal.status,
        "FAILED",
        "the pivot is not re-run: the saga settles instead of publishing again"
      );
      assert.match(
        String(terminal.error),
        /Reread check failed/i,
        "and it settles because the pivot's RereadCheck refused, which is the countermeasure " +
          "that makes the checker's claim of a pivot-step row safe"
      );
      assert.match(
        String(terminal.error),
        /expected DRAFT/i,
        "naming the aggregate state that no longer matches the plan"
      );
    });

    it("produces no second job and no second publish for the same post and channel", async () => {
      const byId = await jobsWithId(dedupeKey);
      assert.strictEqual(byId.length, 1, "no second job holds the pivot's deterministic id");

      const jobIdsAfter = (await jobsForTarget(postId, deliveringChannelId)).map((job) =>
        String(job.id)
      );
      assert.deepStrictEqual(
        jobIdsAfter,
        jobIdsBefore,
        "and the queue holds exactly the jobs it held before: the countermeasure aborts BEFORE " +
          "the enqueue, so the guarantee does not depend on the job-id dedupe surviving retention"
      );

      assert.strictEqual(
        processedCountFor(postId, deliveringChannelId),
        processedBefore,
        "no worker published a second time"
      );
    });
  });

  describe("terminal rows and the pivot boundary at restart", () => {
    it("leaves a saga that was already terminal untouched when a manager boots", async () => {
      const terminalIds = new Map<string, string>();
      const seeded: Array<{ id: string; status: string; updatedAt: Date }> = [];

      for (const status of ["COMPLETED", "FAILED", "COMPENSATED"] as const) {
        const id = `${TAG}-terminal-${status.toLowerCase()}-${randomUUID()}`;
        terminalIds.set(id, status);
        createdSagaIds.push(id);
        await base.sagaInstance.create({
          data: {
            id,
            definitionId: PUBLISHING_SAGA_ID,
            status,
            // One step short of the end: a boot that resumed this row would run
            // the post-pivot status step and its command would show up in the
            // recorder below.
            currentStep: LAST_STEP_INDEX,
            accountId,
            context: {
              sagaId: id,
              correlationId: `corr-${id}`,
              accountId,
              userId: customerUserId,
              metadata: { accountId, mode: "publish-now" },
              stepData: {},
              events: [],
            },
            stepResults: [],
            compensationResults: [],
            retryCount: 0,
            startedAt: new Date(Date.now() - 60_000),
            completedAt: new Date(Date.now() - 30_000),
          },
        });
        const row = await sagaSnapshot(id);
        seeded.push({ id, status: row.status, updatedAt: row.updatedAt });
      }

      // The canary is the synchronization point: it is loaded by the SAME boot
      // and it runs to a terminal state, so by the time the assertions below
      // execute the pass's detached work has demonstrably completed.
      const canaryId = await seedPrePivotSaga("terminal-canary", deliveringChannelId);
      const commandsBefore = dispatchedCommands.length;
      const { harness: restarted } = await bootHarness("terminal-restarted");
      await driveToTerminal(
        canaryId,
        restarted.scheduler,
        `the canary ${canaryId} to terminalize, which proves this boot's dispatches ran`
      );

      for (const before of seeded) {
        const after = await sagaSnapshot(before.id);
        assert.strictEqual(
          after.status,
          before.status,
          `a ${before.status} saga must keep its terminal state across a restart`
        );
        assert.strictEqual(
          after.updatedAt.toISOString(),
          before.updatedAt.toISOString(),
          `a ${before.status} saga must not be rewritten at boot — a re-warm or a resume would move updatedAt`
        );
        assert.deepStrictEqual(
          after.compensationResults,
          [],
          `a ${before.status} saga must run no compensation at boot`
        );
      }

      const dispatchedForTerminals = dispatchedCommands
        .slice(commandsBefore)
        .filter((command) => [...terminalIds.keys()].some((id) => command.id.includes(id)));
      assert.deepStrictEqual(
        dispatchedForTerminals,
        [],
        "a terminal saga must dispatch no command at boot; the command id carries its saga id, so any step that ran would appear here"
      );
    });

    it("compensates no pivot or post-pivot step when a post-pivot failure ends the saga", async () => {
      const { harness } = await bootHarness("postpivot");
      const started = await startPublishNowSaga(harness, rejectingChannelId, "postpivot");
      const sagaId = started.id;

      const snapshot = await driveToTerminal(
        sagaId,
        harness.scheduler,
        `the post-pivot failure of ${sagaId} to exhaust its retries`
      );

      assert.strictEqual(
        snapshot.status,
        "FAILED",
        "a retryable step that exhausts its budget past the pivot ends the saga FAILED, never COMPENSATED"
      );
      assert.deepStrictEqual(
        snapshot.compensationResults,
        [],
        "no compensation runs for a failure at or past the pivot: the provider may already hold the side effect"
      );

      const postId = readCreatedPostId(snapshot.context);
      const compensatingCommands = dispatchedCommands.filter(
        (command) => command.id.includes(sagaId) && command.type === "post.delete"
      );
      assert.deepStrictEqual(
        compensatingCommands,
        [],
        "the pre-pivot create step must not be walked back once the pivot has run"
      );

      const survivor = await base.post.findUnique({ where: { id: postId } });
      assert.ok(
        survivor,
        "the post created before the pivot survives a post-pivot failure — a compensation walk would have deleted it"
      );
    });
  });

  describe("a retry-pending saga handed off by a graceful shutdown", () => {
    let sagaId: string;
    let restarted: Harness;

    before(async () => {
      // A composition schedules a retry (the publish job is rejected, so the
      // post-pivot wait step fails), then shuts down gracefully. The drain flips
      // RUNNING to PENDING while the persist keeps the pending retry, so the row
      // is handed off to the retry checker rather than to a boot pass that owns
      // rows with NO pending retry.
      const { harness: draining } = await bootHarness("draining");
      const started = await startPublishNowSaga(draining, rejectingChannelId, "handoff");
      sagaId = started.id;

      await pollUntil(
        async () => {
          const snapshot = await sagaSnapshot(sagaId);
          return snapshot.nextRetryAt !== null && snapshot.status === "RUNNING" ? snapshot : null;
        },
        () => `${sagaId} to schedule a retry before the drain`
      );

      await draining.integration.shutdown();

      const booted = await bootHarness("handoff-restarted");
      restarted = booted.harness;
    });

    it("leaves the saga PENDING with its pending retry intact", async () => {
      // The premise of the hand-off class. Without it the next assertion could
      // pass for the wrong reason — a RUNNING row is claimed by today's
      // checker, so the gap would never be exercised.
      const snapshot = await sagaSnapshot(sagaId);

      assert.strictEqual(
        snapshot.status,
        "PENDING",
        "the graceful drain hands a running saga off as PENDING"
      );
      assert.notStrictEqual(
        snapshot.nextRetryAt,
        null,
        "the row keeps its pending retry, which is what puts it outside a boot pass that owns rows with none"
      );
    });

    it("is claimed by the retry checker and reaches a terminal state", async () => {
      const snapshot = await driveToTerminal(
        sagaId,
        restarted.scheduler,
        `the retry checker to claim PENDING saga ${sagaId} (a row this shape is skipped by a boot pass that owns rows with no pending retry, so a checker restricted to RUNNING leaves it to the timeout)`
      );

      assert.ok(
        TERMINAL_STATES.includes(snapshot.status as SagaInstance["status"]),
        `a handed-off retry-pending saga must terminalize within its retry envelope, got ${snapshot.status}`
      );
    });
  });
});
