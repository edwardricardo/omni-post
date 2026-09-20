/**
 * Test Helpers for PostCommandHandlers
 *
 * Provides mock implementations of use cases, repositories, and Redis
 * for testing CQRS command handlers that delegate to Application Layer.
 *
 * @file PostCommandHandlers.test-helpers.ts
 * @description Test helpers for post command handlers test helpers
 * @layer infrastructure
 */

// Suppress noisy logger output during tests
console.log = () => {};
console.error = () => {};
console.warn = () => {};

import { ok, err, type Result } from "@shared/types";
import { randomUUID } from "crypto";
import type { CreatePostOutput } from "@core/posts/CreatePostUseCase.js";
import type { CompletePostPublishingOutput } from "@core/posts/CompletePostPublishingUseCase.js";
import type { OpenPublicationEpisodeOutput } from "@core/posts/OpenPublicationEpisodeUseCase.js";
import type { PostDTO } from "@core/posts/GetPostUseCase.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/index.js";
import type { PostCommandHandlersConfig } from "../../src/cqrs/handlers/PostCommandHandlers.js";
import type { UpdatePostCommand } from "@shared/types/cqrs.js";

// ---------------------------------------------------------------------------
// Stable UUIDs for deterministic tests
// ---------------------------------------------------------------------------

export const TEST_POST_ID = randomUUID();
export const TEST_PROJECT_ID = randomUUID();
export const TEST_CHANNEL_ID_1 = randomUUID();
export const TEST_CHANNEL_ID_2 = randomUUID();

// ---------------------------------------------------------------------------
// Mock Use Cases
// ---------------------------------------------------------------------------

export class MockCreatePostUseCase {
  public executeCalls: unknown[] = [];
  public shouldFail = false;
  public failMessage = "Validation failed";
  public failCode = USE_CASE_ERRORS.VALIDATION_FAILED;

  async execute(input: unknown): Promise<Result<CreatePostOutput, UseCaseError>> {
    this.executeCalls.push(input);
    if (this.shouldFail) {
      return err(new UseCaseError(this.failMessage, this.failCode));
    }
    const now = new Date();
    return ok({
      id: TEST_POST_ID,
      projectId: TEST_PROJECT_ID,
      body: (input as Record<string, string>).body ?? "Test body",
      tags: [],
      locale: "en",
      status: "DRAFT",
      createdAt: now,
    });
  }

  reset(): void {
    this.executeCalls = [];
    this.shouldFail = false;
    this.failMessage = "Validation failed";
    this.failCode = USE_CASE_ERRORS.VALIDATION_FAILED;
  }
}

export class MockUpdatePostUseCase {
  public executeCalls: unknown[] = [];
  public shouldFail = false;
  public failMessage = "Post not found";
  public failCode = USE_CASE_ERRORS.NOT_FOUND;

  async execute(input: unknown): Promise<Result<PostDTO, UseCaseError>> {
    this.executeCalls.push(input);
    if (this.shouldFail) {
      return err(new UseCaseError(this.failMessage, this.failCode));
    }
    const now = new Date();
    return ok({
      id: (input as Record<string, string>).postId ?? TEST_POST_ID,
      projectId: TEST_PROJECT_ID,
      body: (input as Record<string, string>).body ?? "Updated body",
      tags: (input as Record<string, string[]>).tags ?? [],
      locale: "en",
      status: "DRAFT",
      mediaCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  reset(): void {
    this.executeCalls = [];
    this.shouldFail = false;
    this.failMessage = "Post not found";
    this.failCode = USE_CASE_ERRORS.NOT_FOUND;
  }
}

export class MockDeletePostUseCase {
  public executeCalls: unknown[] = [];
  public shouldFail = false;
  public failMessage = "Post not found";
  public failCode = USE_CASE_ERRORS.NOT_FOUND;

  async execute(input: unknown): Promise<Result<void, UseCaseError>> {
    this.executeCalls.push(input);
    if (this.shouldFail) {
      return err(new UseCaseError(this.failMessage, this.failCode));
    }
    return ok(undefined);
  }

  reset(): void {
    this.executeCalls = [];
    this.shouldFail = false;
    this.failMessage = "Post not found";
    this.failCode = USE_CASE_ERRORS.NOT_FOUND;
  }
}

/**
 * Double for the promotion writer. `applied` and `version` are settable per
 * test because the handler's whole job is to report what the use case decided —
 * a double that always answers the same thing could not tell a real version
 * from a constant.
 */
export class MockCompletePostPublishingUseCase {
  public executeCalls: unknown[] = [];
  public shouldFail = false;
  public failMessage = "Promotion refused";
  public failCode = USE_CASE_ERRORS.NOT_IMPLEMENTED;
  public applied = true;
  public version = 1;
  public publishedAt = new Date("2024-01-01T00:00:00.000Z");
  public unresolvedChannelIds: string[] = [];

  async execute(input: unknown): Promise<Result<CompletePostPublishingOutput, UseCaseError>> {
    this.executeCalls.push(input);
    if (this.shouldFail) {
      return err(new UseCaseError(this.failMessage, this.failCode));
    }
    return ok({
      postId: (input as Record<string, string>).postId ?? TEST_POST_ID,
      projectId: TEST_PROJECT_ID,
      status: "PUBLISHED",
      publishedAt: this.publishedAt,
      version: this.version,
      applied: this.applied,
      unresolvedChannelIds: this.unresolvedChannelIds,
    });
  }

  reset(): void {
    this.executeCalls = [];
    this.shouldFail = false;
    this.failMessage = "Promotion refused";
    this.failCode = USE_CASE_ERRORS.NOT_IMPLEMENTED;
    this.applied = true;
    this.version = 1;
    this.publishedAt = new Date("2024-01-01T00:00:00.000Z");
    this.unresolvedChannelIds = [];
  }
}

/**
 * Double for the episode writer. `opened`, `alreadyOpen` and `status` are settable
 * per test because the handler's whole job is to report what the use case answered:
 * a double that always returned the same channel set could not tell a mapped answer
 * from a fabricated one. `failCode` is settable for the same reason — the code is
 * the discriminator the caller switches on, so it has to be observable end to end.
 */
export class MockOpenPublicationEpisodeUseCase {
  public executeCalls: unknown[] = [];
  public shouldFail = false;
  // Distinct from `shouldFail`: a refusal is a `Result` the use case RETURNS, a
  // throw is a failure that escapes the Result discipline entirely — a driver
  // fault, a null dereference. The handler must convert the second into the same
  // shaped result as the first, and only a double that can do both proves it.
  public shouldThrow = false;
  public throwMessage = "connection terminated unexpectedly";
  public failMessage = "Episode refused";
  // Typed as the `string` a `UseCaseError` actually carries, not narrowed to the
  // initializer's literal: the point of the field is that a test can plant a
  // DIFFERENT code and watch it cross, and a literal type makes that assignment
  // a compile error instead.
  public failCode: string = USE_CASE_ERRORS.CONFLICT;
  public opened: Array<{ channelId: string; episode: number }> = [
    { channelId: TEST_CHANNEL_ID_1, episode: 1 },
  ];
  public alreadyOpen = false;
  public status = "PUBLISHING";

  async execute(input: unknown): Promise<Result<OpenPublicationEpisodeOutput, UseCaseError>> {
    this.executeCalls.push(input);
    if (this.shouldThrow) {
      throw new Error(this.throwMessage);
    }
    if (this.shouldFail) {
      return err(new UseCaseError(this.failMessage, this.failCode));
    }
    return ok({
      postId: (input as Record<string, string>).postId ?? TEST_POST_ID,
      projectId: TEST_PROJECT_ID,
      opened: this.opened,
      alreadyOpen: this.alreadyOpen,
      status: this.status as OpenPublicationEpisodeOutput["status"],
    });
  }

  reset(): void {
    this.executeCalls = [];
    this.shouldFail = false;
    this.shouldThrow = false;
    this.throwMessage = "connection terminated unexpectedly";
    this.failMessage = "Episode refused";
    this.failCode = USE_CASE_ERRORS.CONFLICT;
    this.opened = [{ channelId: TEST_CHANNEL_ID_1, episode: 1 }];
    this.alreadyOpen = false;
    this.status = "PUBLISHING";
  }
}

// ---------------------------------------------------------------------------
// Mock Repositories
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock PostAggregate-like object that satisfies the
 * properties accessed by the command handlers.
 */
export function createMockPostAggregate(overrides?: {
  id?: string;
  projectId?: string;
  status?: string;
  media?: unknown[];
  scheduledAt?: Date;
}) {
  const postId = overrides?.id ?? TEST_POST_ID;
  const projectId = overrides?.projectId ?? TEST_PROJECT_ID;
  const statusVal = overrides?.status ?? "DRAFT";

  return {
    id: { value: postId },
    projectId: { value: projectId },
    content: {
      body: "Test body content",
      title: "Test Title",
      tags: ["tag1"],
    },
    status: {
      value: statusVal,
      isDraft: () => statusVal === "DRAFT",
      isPublished: () => statusVal === "PUBLISHED",
      isCancelled: () => statusVal === "CANCELLED",
    },
    media: overrides?.media ?? [],
    scheduledAt: overrides?.scheduledAt ?? undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export class MockPostRepository {
  public findByIdCalls: unknown[] = [];
  public shouldFail = false;
  public mockAggregate = createMockPostAggregate();

  async findById(_id: unknown): Promise<Result<unknown, EntityNotFoundError>> {
    this.findByIdCalls.push(_id);
    if (this.shouldFail) {
      return err(new EntityNotFoundError("Post", TEST_POST_ID));
    }
    return ok(this.mockAggregate);
  }

  async save(): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async savePublication(): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async delete(): Promise<Result<void, EntityNotFoundError>> {
    return ok(undefined);
  }

  async exists(): Promise<boolean> {
    return !this.shouldFail;
  }

  reset(): void {
    this.findByIdCalls = [];
    this.shouldFail = false;
    this.mockAggregate = createMockPostAggregate();
  }
}

/**
 * Creates a minimal mock Channel entity that satisfies the properties
 * accessed by the PublishPostCommandHandler (id.value, provider.type).
 */
export function createMockChannel(channelId: string, providerType: string) {
  return {
    id: { value: channelId },
    provider: { type: providerType },
    projectId: { value: TEST_PROJECT_ID },
    handle: `@test-${providerType.toLowerCase()}`,
    status: "CONNECTED",
  };
}

export class MockChannelRepository {
  public findByIdCalls: unknown[] = [];
  public validChannelIds: Map<string, { id: string; provider: string }> = new Map();

  constructor() {
    // Default: both test channels are valid
    this.validChannelIds.set(TEST_CHANNEL_ID_1, {
      id: TEST_CHANNEL_ID_1,
      provider: "X",
    });
    this.validChannelIds.set(TEST_CHANNEL_ID_2, {
      id: TEST_CHANNEL_ID_2,
      provider: "INSTAGRAM",
    });
  }

  async findById(channelId: unknown): Promise<Result<unknown, EntityNotFoundError>> {
    this.findByIdCalls.push(channelId);
    // Extract string value from ChannelId value object
    const idStr = (channelId as { value: string }).value;
    const entry = this.validChannelIds.get(idStr);
    if (!entry) {
      return err(new EntityNotFoundError("Channel", idStr));
    }
    return ok(createMockChannel(entry.id, entry.provider));
  }

  async findByProjectId(): Promise<unknown[]> {
    return [];
  }

  async save(): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  async delete(): Promise<Result<void, EntityNotFoundError>> {
    return ok(undefined);
  }

  async hardDelete(): Promise<Result<void, EntityNotFoundError>> {
    return ok(undefined);
  }

  reset(): void {
    this.findByIdCalls = [];
    this.validChannelIds = new Map();
    this.validChannelIds.set(TEST_CHANNEL_ID_1, {
      id: TEST_CHANNEL_ID_1,
      provider: "X",
    });
    this.validChannelIds.set(TEST_CHANNEL_ID_2, {
      id: TEST_CHANNEL_ID_2,
      provider: "INSTAGRAM",
    });
  }
}

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

export class MockRedis {
  private deletedKeys: string[] = [];

  async keys(_pattern: string): Promise<string[]> {
    return [`cqrs:query:${_pattern}`];
  }

  async del(...keys: string[]): Promise<number> {
    this.deletedKeys.push(...keys);
    return keys.length;
  }

  getDeletedKeys(): string[] {
    return this.deletedKeys;
  }

  reset(): void {
    this.deletedKeys = [];
  }
}

// ---------------------------------------------------------------------------
// Test Config Factory
// ---------------------------------------------------------------------------

export interface TestContext {
  config: PostCommandHandlersConfig;
  createPostUseCase: MockCreatePostUseCase;
  updatePostUseCase: MockUpdatePostUseCase;
  deletePostUseCase: MockDeletePostUseCase;
  completePostPublishingUseCase: MockCompletePostPublishingUseCase;
  openPublicationEpisodeUseCase: MockOpenPublicationEpisodeUseCase;
  postRepository: MockPostRepository;
  channelRepository: MockChannelRepository;
  redis: MockRedis;
}

export function createTestConfig(): TestContext {
  const createPostUseCase = new MockCreatePostUseCase();
  const updatePostUseCase = new MockUpdatePostUseCase();
  const deletePostUseCase = new MockDeletePostUseCase();
  const completePostPublishingUseCase = new MockCompletePostPublishingUseCase();
  const openPublicationEpisodeUseCase = new MockOpenPublicationEpisodeUseCase();
  const postRepository = new MockPostRepository();
  const channelRepository = new MockChannelRepository();
  const redis = new MockRedis();

  const config: PostCommandHandlersConfig = {
    createPostUseCase:
      createPostUseCase as unknown as PostCommandHandlersConfig["createPostUseCase"],
    updatePostUseCase:
      updatePostUseCase as unknown as PostCommandHandlersConfig["updatePostUseCase"],
    deletePostUseCase:
      deletePostUseCase as unknown as PostCommandHandlersConfig["deletePostUseCase"],
    completePostPublishingUseCase:
      completePostPublishingUseCase as unknown as PostCommandHandlersConfig["completePostPublishingUseCase"],
    openPublicationEpisodeUseCase:
      openPublicationEpisodeUseCase as unknown as PostCommandHandlersConfig["openPublicationEpisodeUseCase"],
    postRepository: postRepository as unknown as PostCommandHandlersConfig["postRepository"],
    channelRepository:
      channelRepository as unknown as PostCommandHandlersConfig["channelRepository"],
    redis: redis as unknown as PostCommandHandlersConfig["redis"],
  };

  return {
    config,
    createPostUseCase,
    updatePostUseCase,
    deletePostUseCase,
    completePostPublishingUseCase,
    openPublicationEpisodeUseCase,
    postRepository,
    channelRepository,
    redis,
  };
}

// ---------------------------------------------------------------------------
// Command Builders
// ---------------------------------------------------------------------------

export function buildCreatePostCommand(
  overrides?: Partial<{
    id: string;
    aggregateId: string;
    projectId: string;
    body: string;
    title: string;
    locale: string;
    tags: string[];
    mediaIds: string[];
    channelIds: string[];
    scheduledAt: Date;
    userId: string;
    correlationId: string;
    source: string;
  }>
) {
  return {
    id: overrides?.id ?? `cmd-${Date.now()}`,
    type: "post.create" as const,
    aggregateId: overrides?.aggregateId ?? TEST_POST_ID,
    aggregateType: "Post" as const,
    data: {
      projectId: overrides?.projectId ?? TEST_PROJECT_ID,
      body: overrides?.body ?? "Test post content",
      ...(overrides?.title && { title: overrides.title }),
      locale: overrides?.locale ?? "en",
      ...(overrides?.tags && { tags: overrides.tags }),
      ...(overrides?.mediaIds && { mediaIds: overrides.mediaIds }),
      channelIds: overrides?.channelIds ?? [TEST_CHANNEL_ID_1],
      ...(overrides?.scheduledAt && { scheduledAt: overrides.scheduledAt }),
    },
    metadata: {
      correlationId: overrides?.correlationId ?? "corr-1",
      source: overrides?.source ?? "test",
      ...(overrides?.userId && { userId: overrides.userId }),
    },
    timestamp: new Date(),
  };
}

/**
 * Builds a content-update command. There is deliberately NO `status` override:
 * the contract no longer declares that field, so a builder that could still
 * produce one would let a positive test drift back into treating the
 * content-update command as a status-transition command. The one test that
 * needs the removed shape adds the key explicitly at its own call site, where
 * it reads as the violation it is.
 *
 * `data` is typed as the command's own schema type rather than widened to
 * `Record<string, unknown>`: a widened `data` would silently re-open that drift
 * for every call site at once, since any key would type-check again. The two
 * negative tests widen it themselves, each at its own line.
 */
export function buildUpdatePostCommand(
  overrides?: Partial<{
    id: string;
    aggregateId: string;
    title: string;
    body: string;
    tags: string[];
    mediaIds: string[];
    userId: string;
    correlationId: string;
    source: string;
  }>
) {
  return {
    id: overrides?.id ?? `cmd-${Date.now()}`,
    type: "post.update" as const,
    aggregateId: overrides?.aggregateId ?? TEST_POST_ID,
    aggregateType: "Post" as const,
    data: {
      ...(overrides?.title && { title: overrides.title }),
      ...(overrides?.body && { body: overrides.body }),
      ...(overrides?.tags && { tags: overrides.tags }),
      ...(overrides?.mediaIds && { mediaIds: overrides.mediaIds }),
    } satisfies UpdatePostCommand["data"],
    metadata: {
      correlationId: overrides?.correlationId ?? "corr-1",
      source: overrides?.source ?? "test",
      ...(overrides?.userId && { userId: overrides.userId }),
    },
    timestamp: new Date(),
  };
}

export function buildDeletePostCommand(
  overrides?: Partial<{
    id: string;
    aggregateId: string;
    userId: string;
    correlationId: string;
    source: string;
  }>
) {
  return {
    id: overrides?.id ?? `cmd-${Date.now()}`,
    type: "post.delete" as const,
    aggregateId: overrides?.aggregateId ?? TEST_POST_ID,
    aggregateType: "Post" as const,
    data: {},
    metadata: {
      correlationId: overrides?.correlationId ?? "corr-1",
      source: overrides?.source ?? "test",
      ...(overrides?.userId && { userId: overrides.userId }),
    },
    timestamp: new Date(),
  };
}

export function buildCompletePostPublishingCommand(
  overrides?: Partial<{
    id: string;
    aggregateId: string;
    channels: Array<{
      channelId: string;
      success: boolean;
      externalId?: string;
      error?: string;
      reasonCode?: string;
    }>;
    expectedVersion: number;
    userId: string;
    correlationId: string;
    source: string;
  }>
) {
  return {
    id: overrides?.id ?? `cmd-${Date.now()}`,
    type: "post.complete-publishing" as const,
    aggregateId: overrides?.aggregateId ?? TEST_POST_ID,
    aggregateType: "Post" as const,
    data: {
      outcome: {
        channels: overrides?.channels ?? [{ channelId: TEST_CHANNEL_ID_1, success: true }],
      },
      ...(overrides?.expectedVersion !== undefined && {
        expectedVersion: overrides.expectedVersion,
      }),
    } as Record<string, unknown>,
    metadata: {
      correlationId: overrides?.correlationId ?? "corr-1",
      source: overrides?.source ?? "test",
      ...(overrides?.userId && { userId: overrides.userId }),
    },
    timestamp: new Date(),
  };
}

/**
 * Builds an episode-opening command. `channelIds` is omitted unless a test names
 * one, because "name no channel" and "name an empty set" mean opposite things to
 * the use case and a builder that defaulted the key would make the first shape
 * unreachable from here.
 */
export function buildOpenPublicationEpisodeCommand(
  overrides?: Partial<{
    id: string;
    aggregateId: string;
    channelIds: string[];
    enterPublishing: boolean;
    userId: string;
    correlationId: string;
    source: string;
  }>
) {
  return {
    id: overrides?.id ?? `cmd-${Date.now()}`,
    type: "post.open-publication-episode" as const,
    aggregateId: overrides?.aggregateId ?? TEST_POST_ID,
    aggregateType: "Post" as const,
    data: {
      ...(overrides?.channelIds !== undefined && { channelIds: overrides.channelIds }),
      enterPublishing: overrides?.enterPublishing ?? true,
    } as Record<string, unknown>,
    metadata: {
      correlationId: overrides?.correlationId ?? "corr-1",
      source: overrides?.source ?? "test",
      ...(overrides?.userId && { userId: overrides.userId }),
    },
    timestamp: new Date(),
  };
}

export function buildPublishPostCommand(
  overrides?: Partial<{
    id: string;
    aggregateId: string;
    channelIds: string[];
    publishAt: Date;
    priority: "LOW" | "NORMAL" | "HIGH";
    userId: string;
    correlationId: string;
    source: string;
  }>
) {
  return {
    id: overrides?.id ?? `cmd-${Date.now()}`,
    type: "post.publish" as const,
    aggregateId: overrides?.aggregateId ?? TEST_POST_ID,
    aggregateType: "Post" as const,
    data: {
      channelIds: overrides?.channelIds ?? [TEST_CHANNEL_ID_1],
      priority: overrides?.priority ?? ("NORMAL" as const),
      ...(overrides?.publishAt && { publishAt: overrides.publishAt }),
    },
    metadata: {
      correlationId: overrides?.correlationId ?? "corr-1",
      source: overrides?.source ?? "test",
      ...(overrides?.userId && { userId: overrides.userId }),
    },
    timestamp: new Date(),
  };
}
