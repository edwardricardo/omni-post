/**
 * @file publishNowPromotionHarness.ts
 * @description The production composition `sagaPublishNowPromotion.test.ts`
 *   drives, plus the fixtures and row readers its assertions need. It lives
 *   beside the suite rather than inside it so the suite reads as the PROOF —
 *   one case per requirement — instead of as a setup file with assertions at
 *   the bottom.
 *
 *   Everything composed here is REAL. The only two doubles are the queue and,
 *   for the all-or-nothing case alone, an outbox writer that fails after the
 *   row update has already succeeded; both live in
 *   `publishNowPromotionDoubles.js`, so that file is the exhaustive list of
 *   what is not production and this one is the composition.
 *
 *   Requires Postgres + Redis up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { createSagaContext, type SagaInstance } from "@shared/types/saga.js";
import { InMemoryEventDispatcher } from "@core/domain/index.js";
import {
  CreatePostUseCase,
  UpdatePostUseCase,
  DeletePostUseCase,
  CompletePostPublishingUseCase,
} from "@core/posts/index.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import {
  getSystemContext,
  getTenantContext,
  withTenantContext,
} from "../../../src/security/tenantContext.js";
import { SagaIntegration } from "../../../src/saga/SagaIntegration.js";
import type { SagaManagerImpl } from "../../../src/saga/SagaManager.js";
import { CQRSBusImpl } from "../../../src/cqrs/CQRSBus.js";
import { EventService } from "../../../src/events/EventService.js";
import { PrismaPostRepository } from "../../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaChannelRepository } from "../../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { PrismaProjectRepository } from "../../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { PrismaOutboxWriter } from "../../../src/infrastructure/outbox/PrismaOutboxWriter.js";
import { PrismaUnitOfWork } from "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { ChannelCredentialsCrypto } from "../../../src/security/ChannelCredentialsCrypto.js";
import { EncryptionService } from "../../../src/security/EncryptionService.js";
import { signCustomerAccessToken } from "../../../src/auth/customerJwt.js";
import { createSeedPrismaClient } from "./seedPrismaClient.js";
import { RecordingQueue, ThrowingOutboxWriter } from "./publishNowPromotionDoubles.js";
import {
  CreatePostCommandHandler,
  UpdatePostCommandHandler,
  CompletePostPublishingCommandHandler,
  type PostCommandHandlersConfig,
} from "../../../src/cqrs/handlers/PostCommandHandlers.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const TERMINAL_STATES: ReadonlyArray<SagaInstance["status"]> = [
  "COMPLETED",
  "FAILED",
  "COMPENSATED",
];

/** The post fields every promotion assertion reads. */
export interface PostSnapshot {
  status: string;
  version: number;
  publishedAt: Date | null;
}

/** One outbox row, reduced to what the atomicity assertions compare. */
export interface OutboxRow {
  eventType: string;
  payload: unknown;
}

/** One booted production composition, and the handles the scenarios drive. */
export interface PromotionHarnessBoot {
  integration: SagaIntegration;
  manager: SagaManagerImpl;
  fastify: FastifyInstance;
}

/**
 * The suite's fixtures, compositions and row readers, owned in one place so
 * teardown can be exhaustive and the suite can stay assertions-only.
 */
export class PublishNowPromotionHarness {
  readonly tag = `saga-promote-${Date.now()}`;
  readonly queue = new RecordingQueue();

  accountId = "";
  customerUserId = "";
  projectId = "";
  channelId = "";
  secondChannelId = "";
  accessToken = "";

  /** The promotion writer the suite exercises directly, wired as production wires it. */
  promotionUseCase!: CompletePostPublishingUseCase;

  private base!: PrismaClient;
  private guarded!: PrismaClient;
  private redis!: Redis;
  private eventService!: EventService;
  private postRepository!: PrismaPostRepository;
  private channelRepository!: PrismaChannelRepository;
  private projectRepository!: PrismaProjectRepository;
  private handlerConfig!: PostCommandHandlersConfig;

  private readonly createdSagaIds: string[] = [];
  private readonly openFastify: FastifyInstance[] = [];
  private readonly openSubscribers: Redis[] = [];

  private readonly businessMetrics: BusinessMetricsPort = {
    incrementPostCreated: () => undefined,
    incrementPostPublished: () => undefined,
    incrementPostDeleted: () => undefined,
  };

  /**
   * @method setUp
   * @description Connects, asserts the clean-table precondition, and seeds the
   *   account, user, project and two channels every scenario shares.
   * @returns Nothing; the harness fields are populated in place.
   */
  async setUp(): Promise<void> {
    this.base = createSeedPrismaClient();
    this.guarded = this.base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    // This suite boots real saga managers, and a boot loads and dispatches every
    // non-terminal row in the table. A row left behind by another suite would be
    // executed by this one, so determinism has to be a checked precondition
    // rather than a hope about what the database happens to hold.
    const foreignInFlight = await this.base.sagaInstance.findMany({
      where: { status: { in: ["RUNNING", "PENDING"] } },
      select: { id: true, status: true },
    });
    assert.deepStrictEqual(
      foreignInFlight,
      [],
      "non-terminal saga rows predate this run and would be executed by its boot; clear them"
    );

    this.redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    this.eventService = new EventService({
      prisma: this.guarded,
      redis: this.redis,
      scheduler: new NoopBackgroundTaskScheduler(),
    });
    await this.eventService.initialize();

    const account = await this.base.account.create({
      data: {
        name: `${this.tag}-account`,
        email: `${this.tag}-${randomUUID()}@test.local`,
        slug: `${this.tag}-${randomUUID()}`,
      },
    });
    this.accountId = account.id;

    const customerUser = await this.base.customerUser.create({
      data: {
        accountId: this.accountId,
        email: `${this.tag}-user-${randomUUID()}@test.local`,
        passwordHash: "ignored-for-test",
        firstName: "Promotion",
        lastName: "Harness",
      },
    });
    this.customerUserId = customerUser.id;
    this.accessToken = signCustomerAccessToken({
      sub: this.customerUserId,
      accountId: this.accountId,
      roleId: `${this.tag}-role`,
      roleName: "OWNER",
      permissions: [],
    });

    const project = await this.base.project.create({
      data: { name: `${this.tag}-project`, accountId: this.accountId, locale: "en" },
    });
    this.projectId = project.id;

    this.channelId = await this.seedChannel(`${this.tag}-primary`);
    this.secondChannelId = await this.seedChannel(`${this.tag}-secondary`);

    this.postRepository = new PrismaPostRepository(this.guarded, new PrismaOutboxWriter());
    this.projectRepository = new PrismaProjectRepository(this.guarded);
    this.channelRepository = new PrismaChannelRepository(
      this.guarded,
      new ChannelCredentialsCrypto(new EncryptionService())
    );
    this.promotionUseCase = new CompletePostPublishingUseCase(
      this.postRepository,
      this.channelRepository,
      new PrismaUnitOfWork(this.guarded)
    );
    this.handlerConfig = {
      createPostUseCase: new CreatePostUseCase(
        this.postRepository,
        new InMemoryEventDispatcher(),
        this.businessMetrics
      ),
      updatePostUseCase: new UpdatePostUseCase(this.postRepository, new InMemoryEventDispatcher()),
      deletePostUseCase: new DeletePostUseCase(this.postRepository, this.businessMetrics),
      completePostPublishingUseCase: this.promotionUseCase,
      postRepository: this.postRepository,
      channelRepository: this.channelRepository,
      redis: this.redis,
    };
  }

  /**
   * @method tearDown
   * @description Closes every connection and removes every row the suite created.
   * @returns Nothing.
   */
  async tearDown(): Promise<void> {
    for (const subscriber of this.openSubscribers) subscriber.disconnect();
    for (const fastify of this.openFastify) await fastify.close().catch(() => undefined);

    let postIds: string[] = [];
    if (this.projectId !== "") {
      postIds = (
        await this.base.post.findMany({
          where: { projectId: this.projectId },
          select: { id: true },
        })
      ).map((row) => row.id);
      await this.base.postMedia
        .deleteMany({ where: { postId: { in: postIds } } })
        .catch(() => undefined);
      await this.base.postContent
        .deleteMany({ where: { postId: { in: postIds } } })
        .catch(() => undefined);
      await this.base.outboxEvent
        .deleteMany({ where: { aggregateId: { in: postIds } } })
        .catch(() => undefined);
      await this.base.post.deleteMany({ where: { id: { in: postIds } } }).catch(() => undefined);
    }

    // Swept by account as well as by id: a saga started through the HTTP route
    // mints its own id, so a run that fails between the call and the id being
    // recorded would otherwise leave a non-terminal row behind — and the next
    // suite to boot a manager would inherit and EXECUTE it.
    await this.base.sagaInstance
      .deleteMany({
        where: {
          OR: [
            { id: { in: this.createdSagaIds } },
            ...(this.accountId !== "" ? [{ accountId: this.accountId }] : []),
          ],
        },
      })
      .catch(() => undefined);
    await this.base.storedEvent
      .deleteMany({
        where: {
          streamId: {
            in: [
              ...this.createdSagaIds.map((id) => `stream:Saga:${id}`),
              ...postIds.map((id) => `stream:Post:${id}`),
            ],
          },
        },
      })
      .catch(() => undefined);

    if (this.accountId !== "") {
      const scope = { where: { accountId: this.accountId } };
      await this.base.channel.deleteMany(scope).catch(() => undefined);
      await this.base.customerUser.deleteMany(scope).catch(() => undefined);
      await this.base.project.deleteMany(scope).catch(() => undefined);
      await this.base.account.deleteMany({ where: { id: this.accountId } }).catch(() => undefined);
    }
    if (this.createdSagaIds.length > 0) {
      await this.redis.del(...this.createdSagaIds.map((id) => `saga:${id}`)).catch(() => undefined);
    }
    await this.redis.quit().catch(() => undefined);
    await this.base.$disconnect();
  }

  /**
   * @method boot
   * @description Builds and initializes one production composition, registering the
   *   REAL post command handlers on a real CQRS bus.
   * @returns The integration, its saga manager, and the Fastify instance its routes live on.
   */
  async boot(): Promise<PromotionHarnessBoot> {
    const fastify = Fastify({ logger: false });
    const subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    this.openFastify.push(fastify);
    this.openSubscribers.push(subscriber);

    const cqrsBus = new CQRSBusImpl({
      eventService: this.eventService,
      redis: this.redis,
      enableMetrics: false,
      enableQueryCache: false,
    });
    cqrsBus.registerCommandHandler(new CreatePostCommandHandler(this.handlerConfig));
    cqrsBus.registerCommandHandler(new UpdatePostCommandHandler(this.handlerConfig));
    cqrsBus.registerCommandHandler(new CompletePostPublishingCommandHandler(this.handlerConfig));

    const integration = new SagaIntegration({
      fastify,
      prisma: this.guarded,
      eventService: this.eventService,
      cqrsBus,
      redis: this.redis,
      sagaSubscriber: subscriber,
      queue: this.queue,
      scheduler: new NoopBackgroundTaskScheduler(),
      projectRepository: this.projectRepository,
      channelRepository: this.channelRepository,
      postRepository: this.postRepository,
    });
    await integration.initialize();
    return { integration, manager: integration.getSagaManager(), fastify };
  }

  /**
   * @method buildFailingPromotion
   * @description A promotion writer over the same client whose outbox write throws
   *   after the row update has already succeeded.
   * @returns A use case identical to the real one except for that injected failure.
   */
  buildFailingPromotion(): CompletePostPublishingUseCase {
    return new CompletePostPublishingUseCase(
      new PrismaPostRepository(this.guarded, new ThrowingOutboxWriter()),
      this.channelRepository,
      new PrismaUnitOfWork(this.guarded)
    );
  }

  /**
   * @method seedDraftPost
   * @description Creates a DRAFT post carrying real content and one media row,
   *   written through the owner channel.
   * @param label - Distinguishes the fixture in its content and media values.
   * @returns The new post id.
   */
  async seedDraftPost(label: string): Promise<string> {
    const postId = randomUUID();
    await this.base.post.create({
      data: {
        id: postId,
        projectId: this.projectId,
        accountId: this.accountId,
        status: "DRAFT",
        version: 0,
      },
    });
    await this.base.postContent.create({
      data: {
        postId,
        accountId: this.accountId,
        locale: "en",
        revision: 1,
        title: `${this.tag} ${label} title`,
        body: `${this.tag} ${label} body`,
        tags: ["promotion", label],
      },
    });
    await this.base.postMedia.create({
      data: {
        id: randomUUID(),
        postId,
        accountId: this.accountId,
        type: "image",
        url: `https://example.test/${this.tag}-${label}.png`,
        width: 640,
        height: 480,
        alt: `${label} media`,
      },
    });
    return postId;
  }

  /**
   * @method runScoped
   * @description Runs `work` bound to the harness account's tenant scope.
   * @param work - The callback to run inside the scope.
   * @returns Whatever `work` resolves to.
   */
  async runScoped<T>(work: () => Promise<T>): Promise<T> {
    return await withTenantContext({ accountId: this.accountId }, work);
  }

  /**
   * @method startSaga
   * @description Starts one post-publishing saga under the tenant scope and tracks
   *   its id for teardown.
   * @param manager - The booted saga manager to start it on.
   * @param mode - `publish-now`, `schedule` or `draft`.
   * @param postData - The saga's `metadata.postData` payload.
   * @returns The started saga's id.
   */
  async startSaga(
    manager: SagaManagerImpl,
    mode: "publish-now" | "schedule" | "draft",
    postData: Record<string, unknown>
  ): Promise<string> {
    const started = await this.runScoped(() =>
      manager.startSaga(
        "post-publishing-saga",
        createSagaContext({
          sagaId: "",
          correlationId: `corr-${this.tag}-${randomUUID()}`,
          accountId: this.accountId,
          userId: this.customerUserId,
          metadata: { mode, postData, accountId: this.accountId, source: "promotion-harness" },
        })
      )
    );
    this.trackSaga(started.id);
    return started.id;
  }

  /**
   * @method trackSaga
   * @description Registers a saga id for teardown — used for sagas started through
   *   the HTTP route, which mint their own ids.
   * @param sagaId - The id to remove after the suite.
   * @returns Nothing.
   */
  trackSaga(sagaId: string): void {
    this.createdSagaIds.push(sagaId);
  }

  /**
   * @method waitForTerminal
   * @description Polls the DURABLE row until the saga ends.
   * @param sagaId - The saga to watch.
   * @param timeoutMs - How long to wait before failing.
   * @returns The terminal status; on timeout it fails naming the row's own error.
   */
  async waitForTerminal(sagaId: string, timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await this.base.sagaInstance.findUniqueOrThrow({
        where: { id: sagaId },
        select: { status: true, currentStep: true, error: true },
      });
      if (TERMINAL_STATES.includes(row.status as SagaInstance["status"])) return row.status;
      if (Date.now() > deadline) {
        assert.fail(
          `saga ${sagaId} never terminalized: status=${row.status} step=${row.currentStep} error=${String(row.error)}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * @method createdPostId
   * @description Reads the post id the saga's create step recorded in its durable context.
   * @param sagaId - The saga whose context to read.
   * @returns The post id.
   */
  async createdPostId(sagaId: string): Promise<string> {
    const row = await this.base.sagaInstance.findUniqueOrThrow({
      where: { id: sagaId },
      select: { context: true },
    });
    const stepData = (row.context as { stepData?: Record<string, unknown> } | null)?.stepData;
    const created = stepData?.["create-post"] as { postId?: unknown } | undefined;
    assert.ok(typeof created?.postId === "string", "the saga context must carry its post id");
    return created.postId;
  }

  /**
   * @method postSnapshot
   * @description Reads the three post columns every promotion assertion compares.
   * @param postId - The post to read.
   * @returns Status, version and publication timestamp as persisted.
   */
  async postSnapshot(postId: string): Promise<PostSnapshot> {
    return await this.base.post.findUniqueOrThrow({
      where: { id: postId },
      select: { status: true, version: true, publishedAt: true },
    });
  }

  /**
   * @method outboxFor
   * @description Reads the outbox rows one post's transaction committed, in order.
   * @param postId - The aggregate whose rows to read.
   * @returns The rows, reduced to event type and payload.
   */
  async outboxFor(postId: string): Promise<OutboxRow[]> {
    return await this.base.outboxEvent.findMany({
      where: { aggregateId: postId },
      orderBy: { occurredAt: "asc" },
      select: { eventType: true, payload: true },
    });
  }

  /**
   * @method contentSnapshot
   * @description Reads content and media as stored, for the assertion that the
   *   promotion writes no field beyond the status, the timestamp and its own
   *   bookkeeping.
   * @param postId - The post to read.
   * @returns A comparable snapshot of every content and media row.
   */
  async contentSnapshot(postId: string): Promise<unknown> {
    const contents = await this.base.postContent.findMany({
      where: { postId },
      orderBy: { revision: "asc" },
      select: { locale: true, title: true, body: true, tags: true, revision: true },
    });
    const media = await this.base.postMedia.findMany({
      where: { postId },
      orderBy: { url: "asc" },
      select: { url: true, type: true, width: true, height: true, alt: true },
    });
    return { contents, media };
  }

  /** Creates one channel whose credentials envelope is really encrypted. */
  private async seedChannel(handle: string): Promise<string> {
    // Real envelopes, not inert columns: the promotion resolves each published
    // channel to its provider through the repository, which reconstitutes the
    // whole Channel and decrypts on the way. The id is minted up front because
    // it is bound as AAD.
    const crypto = new ChannelCredentialsCrypto(new EncryptionService());
    const id = randomUUID();
    const row = await this.base.channel.create({
      data: {
        id,
        accountId: this.accountId,
        projectId: this.projectId,
        provider: "X" as const,
        handle,
        ...crypto.encrypt(
          { accessToken: `${this.tag}-token`, tokenType: "bearer" },
          { recordId: id, caller: "sagaPublishNowPromotion fixture" }
        ),
      },
    });
    return row.id;
  }
}
