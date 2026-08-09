/**
 * @file sagaCrashRecovery.test.ts
 * @description MERGE-BLOCKING crash-recovery proof for the saga engine, run
 *   against a REAL Postgres, a REAL Redis and a REAL BullMQ queue, with the
 *   engine wired the way production wires it: a base client extended with
 *   `tenantGuardExtension` handed to a `SagaManagerLifecycle` +
 *   `SagaExecutionEngine` pair, driving the REAL post-publishing saga
 *   definition whose commands land on the REAL post command handlers.
 *
 *   Three properties are under test, and each one needs a process boundary that
 *   in-memory state cannot fake:
 *
 *     - CRASH REPLAY — a saga whose durable row was written BEFORE the pivot's
 *       side effect reached the queue must resume on a fresh manager, must not
 *       enqueue a second publish job for the same (post, channel) pair, and
 *       must leave the post in ONE consistent status. The absorber is the
 *       BullMQ job id (the queue adapter passes the step's dedupe key straight
 *       through as the job id), and the post-pivot status transition CLAIMS to
 *       tolerate re-application. Both are measured here instead of trusted: a
 *       tolerance that only exists in a comment is not a recovery guarantee.
 *     - SHUTDOWN ORPHAN — a graceful shutdown parks a retry-pending saga as
 *       PENDING while keeping `nextRetryAt` set, so the row belongs to neither
 *       a boot pass that owns `nextRetryAt IS NULL` nor a retry checker that
 *       only claims RUNNING. Some owner has to claim it, or it sits
 *       non-terminal until the 30-minute timeout force-fails it.
 *     - TERMINAL SAFETY — a restart must not touch a saga that already reached
 *       a terminal state, and a failure at or past the pivot must compensate
 *       nothing: the pivot is the point of no return, so walking back over it
 *       would undo state a provider may already have accepted.
 *
 *   Every recovery tick is fired explicitly through the noop scheduler, and the
 *   persisted `nextRetryAt` is moved into the past before each tick. The retry
 *   envelope is 5s + 10s + 20s of wall time otherwise, and a suite that waits
 *   it out measures the clock rather than the engine.
 *
 *   Requires Postgres + Redis up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { createTestPrismaClient, type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { createBullMQQueueAdapter, type BullMQQueueAdapter } from "@adapters/queue-bullmq";
import {
  createPostPublishingSagaDefinition,
  createSagaContext,
  type SagaDefinition,
  type SagaInstance,
} from "@shared/types/saga.js";
import type { Command } from "@shared/types/cqrs.js";
import { InMemoryEventDispatcher } from "@core/domain/index.js";
import { CreatePostUseCase, UpdatePostUseCase, DeletePostUseCase } from "@core/posts/index.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import {
  getSystemContext,
  getTenantContext,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { SagaManagerLifecycle } from "../../src/saga/SagaManagerLifecycle.js";
import { SagaExecutionEngine } from "../../src/saga/SagaManagerExecution.js";
import { EventService } from "../../src/events/EventService.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
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
const PUBLISHING_SAGA_ID = "post-publishing-saga";

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

/** One command the saga issued, recorded at the seam the CQRS bus occupies. */
interface RecordedCommand {
  id: string;
  type: string;
  aggregateId: string;
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

/** Manager under test: one lifecycle, its engine, and its firing scheduler. */
interface Manager {
  lifecycle: SagaManagerLifecycle;
  execution: SagaExecutionEngine;
  scheduler: NoopBackgroundTaskScheduler;
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
  /** Channel whose publish job the worker rejects, so the wait step exhausts. */
  let rejectingChannelId = "";

  const dispatchedCommands: RecordedCommand[] = [];
  const processedJobs: ProcessedJob[] = [];
  const createdSagaIds: string[] = [];

  /** Business metrics are counters; the recovery properties do not read them. */
  const businessMetrics: BusinessMetricsPort = {
    incrementPostCreated: () => undefined,
    incrementPostPublished: () => undefined,
    incrementPostDeleted: () => undefined,
  };

  let executeCommand: (command: Command) => Promise<unknown>;

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
   * Builds a saga definition exactly as the API integration builds it: the real
   * factory, the real queue adapter, and the real post command handlers. Each
   * manager gets its OWN definition object so nothing but the durable row and
   * the queue crosses the simulated process boundary.
   *
   * The job-queueing closure mirrors the integration's own: the dedupe key is
   * `publish-<postId>-<channelId>` and the adapter passes it through as the
   * BullMQ job id. That derivation is pinned in source by the static invariant
   * suite, so replicating its SHAPE here cannot drift from production silently.
   */
  function makePublishingSaga(): SagaDefinition {
    return createPostPublishingSagaDefinition(
      async (command: Command) => await executeCommand(command),
      async (job: Record<string, unknown>) => {
        const sagaId = job.sagaId as string | undefined;
        const postId = job.postId as string | undefined;
        const channelId = job.channelId as string | undefined;
        const dedupeKey = `publish-${postId}-${channelId}`;

        const result = await producer().enqueue({
          dedupeKey,
          payload: {
            type: "publish-post",
            ...job,
            ...(sagaId !== undefined && { sagaId }),
          },
        });

        if (!result.ok) {
          throw new Error(`Queue enqueue failed: ${result.error}`);
        }
        return result.value;
      },
      async (jobIds: string[]) => {
        const result = await producer().getJobStates(jobIds);
        if (!result.ok) {
          return { completed: 0, failed: 0, pending: jobIds.length };
        }
        return result.value;
      },
      async (postIdRaw: string) => {
        const row = await guarded.post.findUnique({
          where: { id: postIdRaw },
          select: { status: true },
        });
        return row?.status ?? null;
      }
    );
  }

  /**
   * A manager with no boot: `initialize()` is the behaviour under test, so a
   * harness that always called it could never tell a resumed saga from one the
   * harness itself started. The retry checker is registered directly for the
   * managers whose retries the test drives.
   */
  function buildManager(): Manager {
    const scheduler = new NoopBackgroundTaskScheduler();
    const config = { prisma: guarded, redis, eventService, scheduler, enableMetrics: true };
    const lifecycle = new SagaManagerLifecycle(config);
    const execution = new SagaExecutionEngine(config, lifecycle);
    lifecycle.executionEngine = execution;
    lifecycle.registerSaga(makePublishingSaga());
    return { lifecycle, execution, scheduler };
  }

  /** Registers the retry checker without loading the whole non-terminal table. */
  function registerRetryChecker(manager: Manager): void {
    (
      manager.lifecycle as unknown as { startRetryRecoveryChecker(): void }
    ).startRetryRecoveryChecker();
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
    timeoutMs = 15_000
  ): Promise<SagaSnapshot> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snapshot = await sagaSnapshot(sagaId);
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

      if (Date.now() > deadline) {
        assert.fail(
          `timed out after ${timeoutMs}ms waiting for ${description}: the saga is still ` +
            `${snapshot.status} at step ${snapshot.currentStep} ` +
            `(nextRetryAt=${String(snapshot.nextRetryAt)}, retryCount=${snapshot.retryCount}, ` +
            `error=${String(snapshot.error)})`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /** Starts one publish-now saga through a manager, under the tenant's scope. */
  async function startPublishNowSaga(
    manager: Manager,
    channelId: string,
    label: string
  ): Promise<SagaInstance> {
    const started = await withTenantContext({ accountId }, () =>
      manager.lifecycle.startSaga(
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

  before(async () => {
    base = createTestPrismaClient();
    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

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

    // The commands the saga issues run through the REAL handlers, so the OCC
    // token the post-pivot step passes is evaluated by the real use case and
    // the real version-guarded repository update. A harness that answered the
    // command itself would be asserting its own tolerance, not the engine's.
    const postRepository = new PrismaPostRepository(guarded);
    const eventDispatcher = new InMemoryEventDispatcher();
    const channelRepository = new PrismaChannelRepository(
      guarded,
      new ChannelCredentialsCrypto(new EncryptionService())
    );
    const handlerConfig = {
      createPostUseCase: new CreatePostUseCase(postRepository, eventDispatcher, businessMetrics),
      updatePostUseCase: new UpdatePostUseCase(postRepository, eventDispatcher),
      deletePostUseCase: new DeletePostUseCase(postRepository, businessMetrics),
      postRepository,
      channelRepository,
      redis,
    };
    const createHandler = new CreatePostCommandHandler(handlerConfig);
    const updateHandler = new UpdatePostCommandHandler(handlerConfig);

    executeCommand = async (command: Command): Promise<unknown> => {
      dispatchedCommands.push({
        id: command.id,
        type: command.type,
        aggregateId: command.aggregateId,
      });
      if (command.type === "post.create") {
        return await createHandler.handle(command);
      }
      if (command.type === "post.update") {
        return await updateHandler.handle(command);
      }
      throw new Error(`the harness received an unrouted command type: ${command.type}`);
    };
  });

  after(async () => {
    await worker?.close().catch(() => undefined);
    await inspectQueue?.obliterate({ force: true }).catch(() => undefined);
    await inspectQueue?.close().catch(() => undefined);
    await queueAdapter?.close().catch(() => undefined);

    if (typeof projectId === "string") {
      const postIds = (
        await base.post.findMany({ where: { projectId }, select: { id: true } })
      ).map((row) => row.id);
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
      .deleteMany({ where: { streamId: { in: createdSagaIds.map(sagaStreamId) } } })
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

  describe("a saga interrupted at the pivot and replayed by a fresh manager", () => {
    let sagaId: string;
    let postId: string;
    let dedupeKey: string;
    let beforeReplay: PostSnapshot;
    let jobsProcessedBeforeReplay: number;
    let managerB: Manager;

    before(async () => {
      // 1. A manager runs the saga end to end, so the pivot's side effect (the
      //    publish job) and everything after it really happened.
      const managerA = buildManager();
      registerRetryChecker(managerA);
      const started = await startPublishNowSaga(managerA, deliveringChannelId, "replay");
      sagaId = started.id;

      const completed = await driveToTerminal(
        sagaId,
        managerA.scheduler,
        `the first run of ${sagaId} to finish before the simulated crash`
      );
      assert.strictEqual(
        completed.status,
        "COMPLETED",
        `the pre-crash run must finish cleanly or the replay proves nothing (error=${String(completed.error)})`
      );

      postId = readCreatedPostId(completed.context);
      dedupeKey = `publish-${postId}-${deliveringChannelId}`;
      beforeReplay = await postSnapshot(postId);
      jobsProcessedBeforeReplay = processedJobs.filter(
        (job) => job.postId === postId && job.channelId === deliveringChannelId
      ).length;

      // 2. Rewind the durable row to the pivot and drop the hot cache. This is
      //    the crash-before-persist state: the row says "about to run the
      //    pivot" while the queue, the worker and the post already carry
      //    everything the later steps did.
      await base.sagaInstance.update({
        where: { id: sagaId },
        data: {
          status: "RUNNING",
          currentStep: 2,
          completedAt: null,
          nextRetryAt: null,
          retryCount: 0,
          error: null,
        },
      });
      await redis.del(`saga:${sagaId}`);

      // 3. A manager with no memory of the saga boots against that row.
      managerB = buildManager();
      await managerB.lifecycle.initialize();
    });

    it("resumes the interrupted saga to a terminal state", async () => {
      // The row is non-terminal with NO pending retry, so the retry checker
      // never claims it: whatever runs at boot is the only thing that can.
      const snapshot = await driveToTerminal(
        sagaId,
        managerB.scheduler,
        `the boot of a fresh manager to resume ${sagaId} (a non-terminal row with no pending retry is nobody's until the boot claims it)`
      );

      assert.ok(
        TERMINAL_STATES.includes(snapshot.status as SagaInstance["status"]),
        `a resumed saga must reach a terminal state, got ${snapshot.status}`
      );
    });

    it("enqueues no second publish job for the replayed pivot", async () => {
      const byId = await jobsWithId(dedupeKey);
      assert.strictEqual(
        byId.length,
        1,
        `exactly one job must hold the dedupe key ${dedupeKey} after the replay`
      );

      const byTarget = await jobsForTarget(postId, deliveringChannelId);
      assert.strictEqual(
        byTarget.length,
        1,
        "the replayed pivot must not add a second job addressed at the same post and channel"
      );

      const processedAfter = processedJobs.filter(
        (job) => job.postId === postId && job.channelId === deliveringChannelId
      ).length;
      assert.strictEqual(
        processedAfter,
        jobsProcessedBeforeReplay,
        "no worker executed the publish a second time — the duplicate side effect the dedupe exists to prevent"
      );
    });

    it("leaves the post in a single consistent status", async () => {
      const afterReplay = await postSnapshot(postId);

      assert.strictEqual(
        afterReplay.status,
        beforeReplay.status,
        "the replay must not move the post to a second status"
      );
      assert.strictEqual(
        afterReplay.publishedAt?.toISOString() ?? null,
        beforeReplay.publishedAt?.toISOString() ?? null,
        "the replay must not stamp a second publication time"
      );

      const posts = await base.post.count({ where: { projectId } });
      assert.strictEqual(
        posts,
        1,
        "the replay re-ran the pivot, never the pre-pivot create: a second post row would mean the rewind resumed too far back"
      );
    });

    it("re-applies the post-pivot status transition without a version conflict", async () => {
      // The step's own documentation claims the update use case tolerates
      // re-application of the same transition. That claim is what makes an
      // automatic resume safe, so it is measured here rather than assumed: the
      // replayed command carries the version the create step recorded, while
      // the first run already advanced the persisted one.
      const snapshot = await sagaSnapshot(sagaId);

      assert.strictEqual(
        snapshot.status,
        "COMPLETED",
        `the replayed saga must finish, not fail (error=${String(snapshot.error)})`
      );
      assert.ok(
        !/version conflict/i.test(String(snapshot.error ?? "")),
        `the re-applied status transition was rejected by optimistic concurrency: ${String(snapshot.error)}`
      );
    });
  });

  describe("a retry-pending saga parked by a graceful shutdown", () => {
    let sagaId: string;
    let managerE: Manager;

    before(async () => {
      // A manager schedules a retry (the publish job is rejected, so the
      // post-pivot wait step fails), then shuts down gracefully. The drain
      // flips RUNNING to PENDING while the persist keeps the pending retry.
      const managerD = buildManager();
      registerRetryChecker(managerD);
      const started = await startPublishNowSaga(managerD, rejectingChannelId, "orphan");
      sagaId = started.id;

      const deadline = Date.now() + 15_000;
      for (;;) {
        const snapshot = await sagaSnapshot(sagaId);
        if (snapshot.nextRetryAt !== null && snapshot.status === "RUNNING") break;
        if (Date.now() > deadline) {
          assert.fail(
            `timed out waiting for ${sagaId} to schedule a retry: status=${snapshot.status}, ` +
              `nextRetryAt=${String(snapshot.nextRetryAt)}, error=${String(snapshot.error)}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      await managerD.lifecycle.shutdown();

      managerE = buildManager();
      registerRetryChecker(managerE);
      await managerE.lifecycle.initialize();
    });

    it("parks the saga as PENDING while keeping its pending retry", async () => {
      // The premise of the orphan class. Without it the next assertion could
      // pass for the wrong reason — a RUNNING row is claimed by today's
      // checker, so the gap would never be exercised.
      const snapshot = await sagaSnapshot(sagaId);

      assert.strictEqual(
        snapshot.status,
        "PENDING",
        "the graceful drain parks a running saga as PENDING"
      );
      assert.notStrictEqual(
        snapshot.nextRetryAt,
        null,
        "the parked row keeps its pending retry, which is what puts it outside a boot pass that owns rows with none"
      );
    });

    it("is claimed by the retry checker and reaches a terminal state", async () => {
      const snapshot = await driveToTerminal(
        sagaId,
        managerE.scheduler,
        `the retry checker to claim PENDING saga ${sagaId} (a row this shape is skipped by a boot pass that owns rows with no pending retry, so a checker restricted to RUNNING leaves it to the timeout)`
      );

      assert.ok(
        TERMINAL_STATES.includes(snapshot.status as SagaInstance["status"]),
        `a parked retry-pending saga must terminalize within its retry envelope, got ${snapshot.status}`
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
            // Parked one step short of the end: a boot that resumed this row
            // would run the post-pivot status step and its command would show
            // up in the recorder below.
            currentStep: 4,
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

      const commandsBefore = dispatchedCommands.length;
      const manager = buildManager();
      await manager.lifecycle.initialize();
      // The boot work is dispatched detached, so a snapshot taken immediately
      // would pass before anything had the chance to touch the rows.
      await new Promise((resolve) => setTimeout(resolve, 1_500));

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
      const manager = buildManager();
      registerRetryChecker(manager);
      const started = await startPublishNowSaga(manager, rejectingChannelId, "postpivot");
      const sagaId = started.id;

      const snapshot = await driveToTerminal(
        sagaId,
        manager.scheduler,
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
});
