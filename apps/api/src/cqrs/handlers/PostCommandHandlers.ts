/**
 * @file PostCommandHandlers.ts
 * @description CQRS command handlers for Post aggregate operations (create, update, publish) that delegate to application use cases and handle schema validation, cache invalidation, and integration events.
 * @layer infrastructure
 */

import {
  type Command,
  type CommandHandler,
  type CommandResult,
  type CreatePostCommand,
  type UpdatePostCommand,
  type PublishPostCommand,
  type CompletePostPublishingCommand,
  type OpenPublicationEpisodeCommand,
  POST_COMMANDS,
  validateCommand,
  CreatePostCommandSchema,
  UpdatePostCommandSchema,
  PublishPostCommandSchema,
  CompletePostPublishingCommandSchema,
  OpenPublicationEpisodeCommandSchema,
} from "@shared/types/cqrs.js";
import { createPostEvent, createUserActionEvent, EVENT_TYPES } from "@shared/types/events.js";
import type { CreatePostUseCase } from "@core/posts/CreatePostUseCase.js";
import type { UpdatePostUseCase } from "@core/posts/UpdatePostUseCase.js";
import type { DeletePostUseCase } from "@core/posts/DeletePostUseCase.js";
import type { CompletePostPublishingUseCase } from "@core/posts/CompletePostPublishingUseCase.js";
import type {
  OpenPublicationEpisodeUseCase,
  OpenPublicationEpisodeOutput,
} from "@core/posts/OpenPublicationEpisodeUseCase.js";
import {
  PostId,
  ChannelId,
  type PostRepository,
  type ChannelRepository,
} from "@core/domain/index.js";
import { invalidateQueryCache } from "../CQRSBus.js";
import type { Redis } from "ioredis";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("cqrs:post-commands");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PostCommandHandlersConfig {
  createPostUseCase: CreatePostUseCase;
  updatePostUseCase: UpdatePostUseCase;
  deletePostUseCase: DeletePostUseCase;
  completePostPublishingUseCase: CompletePostPublishingUseCase;
  openPublicationEpisodeUseCase: OpenPublicationEpisodeUseCase;
  postRepository: PostRepository;
  channelRepository: ChannelRepository;
  redis: Redis;
}

/**
 * What an accepted episode opening reports back: the channels the run is about
 * with the ordinal each was opened at, whether the answer was the episode that
 * was already open, and the word the post carries after the write.
 */
export interface OpenPublicationEpisodeResult {
  postId: string;
  opened: OpenPublicationEpisodeOutput["opened"];
  alreadyOpen: boolean;
  status: OpenPublicationEpisodeOutput["status"];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a list of channel IDs by looking each one up through the
 * ChannelRepository port. Returns an error message when any ID is invalid
 * or not found, or `null` when all channels are valid.
 */
async function validateChannels(
  channelIds: string[],
  channelRepository: ChannelRepository
): Promise<string | null> {
  for (const rawId of channelIds) {
    const channelIdResult = ChannelId.fromString(rawId);
    if (!channelIdResult.ok) {
      return `Invalid channel ID format: ${rawId}`;
    }

    const findResult = await channelRepository.findById(channelIdResult.value);
    if (!findResult.ok) {
      return `Channel not found: ${rawId}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CreatePostCommandHandler
// ---------------------------------------------------------------------------

export class CreatePostCommandHandler implements CommandHandler<
  Command<unknown>,
  { postId: string; version: number }
> {
  readonly commandType = POST_COMMANDS.CREATE_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(
    command: Command<unknown>
  ): Promise<CommandResult<{ postId: string; version: number }>> {
    try {
      // 1. Validate CQRS command schema
      const validation = validateCommand(command, CreatePostCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as CreatePostCommand;
      const { data, metadata } = validatedCommand;

      // Delegate to use case. Post is platform-agnostic: no channels, no
      // media, no schedule. Those are owned by downstream saga steps.
      const result = await this.config.createPostUseCase.execute({
        projectId: data.projectId,
        body: data.body,
        ...(data.title && { title: data.title }),
        ...(data.tags && { tags: data.tags }),
        ...(data.locale && {
          locale: data.locale as import("@core/domain/value-objects/Content.js").ContentLocale,
        }),
      });

      if (!result.ok) {
        return { success: false, error: result.error.message };
      }

      const postId = result.value.id;

      const events = [
        createPostEvent(
          EVENT_TYPES.POST_CREATED,
          postId,
          data.projectId,
          {
            title: data.title,
            body: data.body,
            locale: data.locale,
            tags: data.tags,
            status: result.value.status,
          },
          {
            ...(metadata.userId && { userId: metadata.userId }),
            source: metadata.source,
          }
        ),
        createUserActionEvent(
          metadata.userId || "system",
          "CREATE_POST",
          "Post",
          postId,
          {
            source: metadata.source || "API",
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.sessionId && { sessionId: metadata.sessionId }),
          },
          {
            projectId: data.projectId,
          }
        ),
      ];

      // 5. Invalidate caches
      await this.invalidateCaches(data.projectId);

      return {
        success: true,
        // version: 0 — every freshly-created Post starts at version 0 (the
        // schema default + AggregateRoot default). The saga's promotion step no
        // longer forwards it as an OCC token: a create-time version never
        // refreshes, so seeding one made every retry of a still-editable DRAFT
        // conflict. Concurrency is guarded by the repository's in-transaction
        // compare-and-swap, which re-reads on each attempt.
        data: { postId, version: 0 },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "CreatePostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// UpdatePostCommandHandler
// ---------------------------------------------------------------------------

export class UpdatePostCommandHandler implements CommandHandler<
  Command<unknown>,
  { version: number }
> {
  readonly commandType = POST_COMMANDS.UPDATE_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(command: Command<unknown>): Promise<CommandResult<{ version: number }>> {
    try {
      // 1. Validate CQRS command schema
      const validation = validateCommand(command, UpdatePostCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as UpdatePostCommand;
      const { data, metadata, aggregateId } = validatedCommand;

      // Warn about unsupported fields. There is no `status` branch here, and
      // there cannot be one: the schema declares no such field and rejects it,
      // so a status can no longer reach this handler to be logged and dropped.
      if (data.mediaIds) {
        log.warn(
          { postId: aggregateId, mediaIds: data.mediaIds },
          "UpdatePostCommand contains mediaIds which are not supported by the use case — ignored"
        );
      }

      // 2. Delegate to use case (propagating OCC token if caller supplied one)
      const result = await this.config.updatePostUseCase.execute({
        postId: aggregateId,
        ...(data.body && { body: data.body }),
        ...(data.title && { title: data.title }),
        ...(data.tags && { tags: data.tags }),
        ...(data.expectedVersion !== undefined && { expectedVersion: data.expectedVersion }),
      });

      if (!result.ok) {
        return { success: false, error: result.error.message };
      }

      const updatedPost = result.value;

      // 3. Build change tracking for events
      const changes: Record<string, unknown> = {};
      if (data.body) {
        changes.body = data.body;
      }
      if (data.title) {
        changes.title = data.title;
      }
      if (data.tags) {
        changes.tags = data.tags;
      }

      // 4. Create CQRS integration events (only if there were actual fields to update)
      const events = [];

      if (Object.keys(changes).length > 0) {
        const postUpdatedEvent = createPostEvent(
          EVENT_TYPES.POST_UPDATED,
          aggregateId,
          updatedPost.projectId,
          {
            changes,
            previousVersion: 1,
            newVersion: 2,
          },
          {
            source: metadata.source,
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.correlationId && { correlationId: metadata.correlationId }),
          }
        );
        events.push(postUpdatedEvent);

        const userActionEvent = createUserActionEvent(
          metadata.userId || "system",
          "UPDATE_POST",
          "Post",
          aggregateId,
          {
            source: metadata.source || "API",
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.sessionId && { sessionId: metadata.sessionId }),
          },
          {
            changes: Object.keys(changes),
            changeCount: Object.keys(changes).length,
          }
        );
        events.push(userActionEvent);

        // Invalidate caches
        await this.invalidateCaches(updatedPost.projectId, aggregateId);
      }

      return {
        success: true,
        data: { version: 2 },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "UpdatePostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      `post.analytics:${postId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// PublishPostCommandHandler
// ---------------------------------------------------------------------------

export class PublishPostCommandHandler implements CommandHandler<
  Command<unknown>,
  { jobIds: string[] }
> {
  readonly commandType = POST_COMMANDS.PUBLISH_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(command: Command<unknown>): Promise<CommandResult<{ jobIds: string[] }>> {
    try {
      // 1. Validate CQRS command schema
      const validation = validateCommand(command, PublishPostCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as PublishPostCommand;
      const { data, metadata, aggregateId } = validatedCommand;

      // 2. Load post via repository
      const postIdResult = PostId.fromString(aggregateId);
      if (!postIdResult.ok) {
        return { success: false, error: `Invalid post ID: ${aggregateId}` };
      }

      const postResult = await this.config.postRepository.findById(postIdResult.value);
      if (!postResult.ok) {
        return { success: false, error: "Post not found" };
      }

      const post = postResult.value;

      // 3. Validate status
      if (post.status.value === "PUBLISHED") {
        return { success: false, error: "Post is already published" };
      }

      // 4. Validate channels
      const channelError = await validateChannels(data.channelIds, this.config.channelRepository);
      if (channelError) {
        return { success: false, error: channelError };
      }

      // 5. Build resolved channel data for events
      const resolvedChannels: Array<{ id: string; provider: string }> = [];
      for (const rawId of data.channelIds) {
        const chIdResult = ChannelId.fromString(rawId);
        if (chIdResult.ok) {
          const chResult = await this.config.channelRepository.findById(chIdResult.value);
          if (chResult.ok) {
            resolvedChannels.push({
              id: chResult.value.id.value,
              provider: chResult.value.provider.type,
            });
          }
        }
      }

      // 6. Create job metadata
      const jobIds: string[] = [];
      const events = [];

      for (const channel of resolvedChannels) {
        const jobId = `publish-${aggregateId}-${channel.id}-${Date.now()}`;
        jobIds.push(jobId);

        const publishJobEvent = createPostEvent(
          EVENT_TYPES.POST_SCHEDULED,
          aggregateId,
          post.projectId.value,
          {
            channelId: channel.id,
            provider: channel.provider,
            jobId,
            priority: data.priority,
            publishAt: data.publishAt || new Date(),
            estimatedDuration: this.estimatePublishDuration(channel.provider),
          },
          {
            source: metadata.source,
            ...(metadata.userId && { userId: metadata.userId }),
            ...(metadata.correlationId && { correlationId: metadata.correlationId }),
          }
        );
        events.push(publishJobEvent);
      }

      // 7. User action event
      const userActionEvent = createUserActionEvent(
        metadata.userId || "system",
        "PUBLISH_POST",
        "Post",
        aggregateId,
        {
          source: metadata.source || "API",
          ...(metadata.userId && { userId: metadata.userId }),
          ...(metadata.sessionId && { sessionId: metadata.sessionId }),
        },
        {
          channelCount: data.channelIds.length,
          priority: data.priority,
          scheduledPublish: !!data.publishAt,
        }
      );
      events.push(userActionEvent);

      // 8. Invalidate caches
      await this.invalidateCaches(post.projectId.value, aggregateId);

      return {
        success: true,
        data: { jobIds },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "PublishPostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private estimatePublishDuration(provider: string): number {
    const durations: Record<string, number> = {
      X: 5000,
      INSTAGRAM: 15000,
      FACEBOOK: 10000,
      LINKEDIN: 8000,
      YOUTUBE: 20000,
      TIKTOK: 12000,
    };
    return durations[provider] || 10000;
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// CompletePostPublishingCommandHandler
// ---------------------------------------------------------------------------

/**
 * Promotes a post whose every scheduled channel published. It chooses no status
 * and writes no field itself: the outcome goes to the use case verbatim and the
 * aggregate decides, which is what keeps the persisted state and the providers'
 * reality in agreement.
 */
export class CompletePostPublishingCommandHandler implements CommandHandler<
  Command<unknown>,
  { postId: string; version: number; applied: boolean }
> {
  readonly commandType = POST_COMMANDS.COMPLETE_PUBLISHING;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(
    command: Command<unknown>
  ): Promise<CommandResult<{ postId: string; version: number; applied: boolean }>> {
    try {
      const validation = validateCommand(command, CompletePostPublishingCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as CompletePostPublishingCommand;
      const { data, metadata, aggregateId } = validatedCommand;

      const result = await this.config.completePostPublishingUseCase.execute({
        postId: aggregateId,
        outcome: {
          // Same values, key for key. The spread is not a reshape: Zod types an
          // absent `.optional()` as `string | undefined`, and under
          // `exactOptionalPropertyTypes` an absent key and a key holding
          // `undefined` are different things. Omitting rather than assigning is
          // what keeps them different.
          channels: data.outcome.channels.map((channel) => ({
            channelId: channel.channelId,
            success: channel.success,
            ...(channel.externalId !== undefined && { externalId: channel.externalId }),
            ...(channel.error !== undefined && { error: channel.error }),
          })),
        },
        ...(data.expectedVersion !== undefined && { expectedVersion: data.expectedVersion }),
      });

      if (!result.ok) {
        return { success: false, error: result.error.message };
      }

      const promotion = result.value;

      if (promotion.unresolvedChannelIds.length > 0) {
        log.warn(
          { postId: aggregateId, unresolvedChannelIds: promotion.unresolvedChannelIds },
          "Promotion could not resolve every channel to a provider; the publishing-started event names fewer providers than channels published"
        );
      }

      // No POST_PUBLISHED integration event here: its payload requires the
      // provider's externalId, which this capability does not yet carry, and a
      // fabricated one would be worse than none. The aggregate's own events
      // reach consumers through the outbox, written by the same transaction.
      const events = [];

      if (promotion.applied) {
        events.push(
          createUserActionEvent(
            metadata.userId || "system",
            "COMPLETE_POST_PUBLISHING",
            "Post",
            aggregateId,
            {
              source: metadata.source || "API",
              ...(metadata.userId && { userId: metadata.userId }),
              ...(metadata.sessionId && { sessionId: metadata.sessionId }),
            },
            {
              channelCount: data.outcome.channels.length,
              publishedAt: promotion.publishedAt,
            }
          )
        );

        await this.invalidateCaches(promotion.projectId, aggregateId);
      }

      return {
        success: true,
        data: {
          postId: promotion.postId,
          // The version the repository actually persisted, read back off the
          // aggregate — never a literal.
          version: promotion.version,
          applied: promotion.applied,
        },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "CompletePostPublishingCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      `post.analytics:${postId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// OpenPublicationEpisodeCommandHandler
// ---------------------------------------------------------------------------

/**
 * Opens an attempt episode over the post's per-channel publication record and
 * reports the channels it opened, so the caller can enqueue one job per channel
 * against an ordinal the record already holds.
 *
 * It decides nothing about WHICH channels are admissible: the request travels to
 * the use case as it arrived and the aggregate refuses what it must, by name.
 * The handler's own contribution is the crossing — validating the command shape,
 * mapping the aggregate id onto the input, and carrying the refusal's code back
 * so the caller branches on a value rather than on a message.
 */
export class OpenPublicationEpisodeCommandHandler implements CommandHandler<
  Command<unknown>,
  OpenPublicationEpisodeResult
> {
  readonly commandType = POST_COMMANDS.OPEN_PUBLICATION_EPISODE;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(command: Command<unknown>): Promise<CommandResult<OpenPublicationEpisodeResult>> {
    try {
      const validation = validateCommand(command, OpenPublicationEpisodeCommandSchema);
      if (!validation.success) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
          ...(validation.validationErrors && { validationErrors: validation.validationErrors }),
        };
      }

      const validatedCommand = validation.data as OpenPublicationEpisodeCommand;
      const { data, aggregateId } = validatedCommand;

      const result = await this.config.openPublicationEpisodeUseCase.execute({
        postId: aggregateId,
        // Omitted rather than assigned when the caller named no channel: under
        // `exactOptionalPropertyTypes` an absent key and a key holding
        // `undefined` are different things, and the use case reads the absence
        // as "every recorded channel" — a meaning an explicit `undefined` would
        // still carry today but only by accident of how the check is written.
        ...(data.channelIds !== undefined && { channelIds: data.channelIds }),
        enterPublishing: data.enterPublishing,
      });

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
          code: result.error.code,
        };
      }

      const episode = result.value;

      // Invalidated on every accepted open, including one that answered
      // `alreadyOpen`. The use case writes when the target set was REPLACED even
      // though the episode did not move, and it does not report that separately —
      // so the handler cannot tell a true no-op from a rewritten record set. An
      // extra DEL costs a round trip; a missed one serves a reader the channels
      // this run just abandoned.
      await this.invalidateCaches(episode.projectId, episode.postId);

      return {
        success: true,
        data: {
          postId: episode.postId,
          opened: episode.opened,
          alreadyOpen: episode.alreadyOpen,
          status: episode.status,
        },
        // No audit event: the caller is the publishing saga rather than a person,
        // and the record's own domain events are written by the same transaction
        // and delivered once by the outbox relay after it commits.
        events: [],
      };
    } catch (error) {
      log.error({ err: error }, "OpenPublicationEpisodeCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      `post.analytics:${postId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// DeletePostCommandHandler
// ---------------------------------------------------------------------------

export class DeletePostCommandHandler implements CommandHandler<Command, { deleted: boolean }> {
  readonly commandType = POST_COMMANDS.DELETE_POST;

  constructor(private config: PostCommandHandlersConfig) {}

  async handle(command: Command): Promise<CommandResult<{ deleted: boolean }>> {
    try {
      const { aggregateId, metadata } = command;

      // 1. Load post via repository (needed for event data)
      const postIdResult = PostId.fromString(aggregateId);
      if (!postIdResult.ok) {
        return { success: false, error: `Invalid post ID: ${aggregateId}` };
      }

      const postResult = await this.config.postRepository.findById(postIdResult.value);
      if (!postResult.ok) {
        return { success: false, error: "Post not found" };
      }

      const post = postResult.value;
      const projectId = post.projectId.value;
      const previousStatus = post.status.value;
      const mediaCount = post.media.length;
      const hadSchedule = !!post.scheduledAt;

      // 2. Delegate to use case. This dispatcher is system-internal (the sole
      // production caller is the PostPublishingSaga compensation deleting the
      // post the saga itself created), so it passes an explicit, auditable
      // system caller that skips the customer ownership gate (CWE-639).
      const result = await this.config.deletePostUseCase.execute({
        postId: aggregateId,
        caller: { type: "system", source: "PostPublishingSaga:Compensation" },
      });

      if (!result.ok) {
        return { success: false, error: result.error.message };
      }

      // 3. Create CQRS integration events
      const events = [];

      const postDeletedEvent = createPostEvent(
        EVENT_TYPES.POST_DELETED,
        aggregateId,
        projectId,
        {
          previousStatus,
          hadSchedule,
          mediaCount,
        },
        {
          ...(metadata.userId && { userId: metadata.userId }),
          source: metadata.source,
        }
      );
      events.push(postDeletedEvent);

      const userActionEvent = createUserActionEvent(
        metadata.userId || "system",
        "DELETE_POST",
        "Post",
        aggregateId,
        {
          source: metadata.source || "API",
          ...(metadata.userId && { userId: metadata.userId }),
          ...(metadata.sessionId && { sessionId: metadata.sessionId }),
        },
        {
          previousStatus,
        }
      );
      events.push(userActionEvent);

      // 4. Invalidate caches
      await this.invalidateCaches(projectId, aggregateId);

      return {
        success: true,
        data: { deleted: true },
        events,
      };
    } catch (error) {
      log.error({ err: error }, "DeletePostCommand failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private async invalidateCaches(projectId: string, postId: string): Promise<void> {
    await invalidateQueryCache(this.config.redis, [
      `post.get:${postId}`,
      `post.list:${projectId}`,
      `post.search:${projectId}`,
      "dashboard:stats",
    ]);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function to create all post command handlers
 */
export function createPostCommandHandlers(
  config: PostCommandHandlersConfig
): CommandHandler<Command, unknown>[] {
  return [
    new CreatePostCommandHandler(config),
    new UpdatePostCommandHandler(config),
    new PublishPostCommandHandler(config),
    new CompletePostPublishingCommandHandler(config),
    new OpenPublicationEpisodeCommandHandler(config),
    new DeletePostCommandHandler(config),
  ];
}
